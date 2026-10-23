"""Evidence features for the candidate price model (v2). Pure functions, no I/O.

Every feature is a function of data available on the origin date t:

  arr_vs_month_prior  log( mean arrivals of the last 30 days / mean daily arrivals in the SAME
                      calendar month of EARLIER YEARS )                       (supply vs usual)
  market_premium_30d  mean over the last 30 days of log(market price / Maharashtra median price)
  lag_90_change       log( price[t] / price[t-90] )
  yoy_gap             log( price[t] / price[t-365] )                          (vs same date last year)
  season_change       (pair feature, depends on the horizon h) mean over EARLIER YEARS of the
                      log price change h days after an origin in the same calendar month, for the
                      same crop. Only pairs whose target lies in the same year as their origin are
                      used, so the value for year Y never touches a date on or after 1 Jan of Y.

Missing values stay NaN (never 0); both RandomForest (scikit-learn >= 1.4) and XGBoost handle them.
"""
from __future__ import annotations

import warnings

import numpy as np
import pandas as pd

from app.ml.price_prediction.features import MODEL_FEATURES, SERIES_KEY

EVIDENCE_ROW_FEATURES = ["arr_vs_month_prior", "market_premium_30d", "lag_90_change", "yoy_gap"]
PAIR_EVIDENCE = ["season_change"]
V2_FEATURES = MODEL_FEATURES + EVIDENCE_ROW_FEATURES + PAIR_EVIDENCE
FIRST_YEAR = 2023
N_YEARS = 4                      # year index 0..3 = 2023..2026
MIN_DAYS_IN_MONTH = 5            # a month's arrivals mean needs this many reporting days
SEASON_MIN_PAIRS = 50


def year_index(year) -> np.ndarray:
    return np.clip(np.asarray(year) - FIRST_YEAR, 0, N_YEARS - 1).astype(int)


def add_evidence_features(feat: pd.DataFrame) -> pd.DataFrame:
    """Row-level evidence features. ``feat`` is the output of features.compute_features
    (sorted by series and date, one row per calendar day)."""
    df = feat.copy()
    grp = df.groupby(SERIES_KEY, sort=False)
    df["lag_90_change"] = df["log_price"] - grp["log_price"].shift(90)
    df["yoy_gap"] = df["log_price"] - grp["log_price"].shift(365)
    df["market_premium_30d"] = grp["state_price_gap"].transform(lambda s: s.rolling(30, min_periods=10).mean())

    df["_sid"] = grp.ngroup()
    a30 = df.groupby("_sid", sort=False)["arrivals"].transform(lambda s: s.rolling(30, min_periods=5).mean())
    year, month = df["Date"].dt.year.to_numpy(), df["Date"].dt.month.to_numpy()
    tmp = pd.DataFrame({"_sid": df["_sid"].to_numpy(), "y": year, "m": month, "a": df["arrivals"].to_numpy()})
    mm = tmp[tmp["a"].notna()].groupby(["_sid", "y", "m"])["a"].agg(["mean", "count"])
    mm = mm.loc[mm["count"] >= MIN_DAYS_IN_MONTH, "mean"]
    total = np.zeros(len(df))
    count = np.zeros(len(df))
    for back in range(1, N_YEARS):            # earlier years only: year - 1, year - 2, ...
        idx = pd.MultiIndex.from_arrays([df["_sid"].to_numpy(), year - back, month])
        v = mm.reindex(idx).to_numpy(float)
        ok = np.isfinite(v)
        total[ok] += v[ok]
        count[ok] += 1
    with np.errstate(all="ignore"):
        prior = np.where(count > 0, total / np.maximum(count, 1), np.nan)
        df["arr_vs_month_prior"] = np.log(a30.to_numpy(float) / prior)
    df["arr_vs_month_prior"] = df["arr_vs_month_prior"].replace([np.inf, -np.inf], np.nan)
    return df.drop(columns=["_sid"])


def season_table(crop_code: np.ndarray, year: np.ndarray, month: np.ndarray, origin_day: np.ndarray,
                 Y: np.ndarray, n_crops: int) -> tuple[np.ndarray, np.ndarray]:
    """S[crop, year_idx, month-1, h-1] = mean over EARLIER years of the h-day log change after
    an origin in that month (targets inside the origin's own year only), and N = number of
    earlier years that contributed. ``Y`` is (n_origins, H) of log(price[t+h]/price[t])."""
    H = Y.shape[1]
    yi = year_index(year)
    key = (crop_code.astype(int) * N_YEARS + yi) * 12 + (month.astype(int) - 1)
    nk = n_crops * N_YEARS * 12
    A = np.full((nk, H), np.nan)
    for h in range(1, H + 1):
        tgt_year = (origin_day + np.timedelta64(h, "D")).astype("datetime64[Y]").astype(int) + 1970
        ok = np.isfinite(Y[:, h - 1]) & (tgt_year == year)
        s = np.bincount(key[ok], weights=Y[ok, h - 1].astype(float), minlength=nk)
        c = np.bincount(key[ok], minlength=nk)
        A[:, h - 1] = np.where(c >= SEASON_MIN_PAIRS, s / np.maximum(c, 1), np.nan)
    A = A.reshape(n_crops, N_YEARS, 12, H)
    S = np.full_like(A, np.nan)
    N = np.zeros(A.shape, dtype=np.int8)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        for y in range(1, N_YEARS):
            S[:, y] = np.nanmean(A[:, :y], axis=1)
            N[:, y] = np.isfinite(A[:, :y]).sum(axis=1)
    return S.astype("float32"), N


def add_pair_evidence(X: pd.DataFrame, origins: pd.DataFrame, horizons: np.ndarray, S: np.ndarray) -> pd.DataFrame:
    """Append the v2 columns (row features from ``origins``, season_change looked up in ``S``) to
    the production pair features ``X`` so the result has exactly V2_FEATURES as columns."""
    out = X.copy()
    for c in EVIDENCE_ROW_FEATURES:
        out[c] = origins[c].astype("float32").to_numpy()
    d = pd.to_datetime(origins["Date"])
    out["season_change"] = S[origins["commodity_code"].to_numpy(int), year_index(d.dt.year.to_numpy()),
                             d.dt.month.to_numpy(int) - 1, np.asarray(horizons, int) - 1]
    return out[V2_FEATURES]
