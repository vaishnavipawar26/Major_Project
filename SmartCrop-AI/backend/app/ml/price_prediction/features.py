"""Time-series feature engineering for the price forecaster.

Used by both the training script and the API so that features are computed
identically in both places.

Representation
--------------
Each series (state, market, commodity, variety) is re-indexed to a continuous
daily calendar. Markets do not trade every day, so the price is carried forward
for at most PRICE_FFILL_LIMIT days; longer gaps stay missing and any row whose
lag window touches such a gap is not used. A forecast origin must be a day on
which the market actually reported a price (``observed``).

All price features are expressed relative to the current price (log ratios) so
one pooled model can learn across crops whose price levels differ by 3x.
The target is the log change between the origin price and the price h days later.

Daily multi-horizon forecasting
-------------------------------
One *direct* model predicts every horizon h = 1 .. MAX_HORIZON days: each training row is
an (origin, h) pair whose inputs are the origin's features (data <= t only) plus
PAIR_FEATURES (h and the calendar position of the target day t+h). The model is never fed
its own predictions (no recursion), so it needs no forecast of future prices or arrivals.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from app.ml.common.seasons import SEASON_CODE, season_for_month

MAX_HORIZON = 60
HORIZONS = tuple(range(1, MAX_HORIZON + 1))
REPORT_HORIZONS = (1, 7, 14, 21, 30, 45, 60)  # horizons summarised in reports
LAGS = (1, 3, 7, 14, 30)
ROLL_WINDOWS = (7, 14, 30)
PRICE_FFILL_LIMIT = 7     # max days a price is carried forward across non-trading days
TARGET_FFILL_LIMIT = 3    # target must be a price reported within 3 days of t+h
STATE_MARKET = "All markets (state median)"
STATE_VARIETY = "All varieties"
SERIES_KEY = ["State", "Market", "Commodity", "Variety"]

FEATURE_COLUMNS = [
    "log_price",
    *[f"lag_{k}_change" for k in LAGS],
    *[f"roll_mean_{w}_gap" for w in ROLL_WINDOWS],
    "volatility_30",
    "momentum_7_30",
    "pct_change_7",
    "spread_ratio",
    "log_arrivals",
    "arrivals_vs_30d",
    "state_price_gap",
    "state_change_7",
    "month",
    "week_of_year",
    "day_of_week",
    "season_code",
    "doy_sin",
    "doy_cos",
    "commodity_code",
    "market_code",
    "variety_code",
]
CATEGORICAL_ENCODED = ("commodity_code", "market_code", "variety_code")
PAIR_FEATURES = ["horizon_days", "target_doy_sin", "target_doy_cos"]
MODEL_FEATURES = FEATURE_COLUMNS + PAIR_FEATURES


def _state_level_series(clean: pd.DataFrame) -> pd.DataFrame:
    """Daily state-wide reference series per commodity: median modal price across all
    reporting markets and total arrivals. It is far more complete than individual
    markets and lets every crop be forecast even where a single market is sparse."""
    g = clean.groupby(["State", "Commodity", "Date"], observed=True)
    state = g.agg(Modal_Price=("Modal_Price", "median"), Min_Price=("Min_Price", "median"),
                  Max_Price=("Max_Price", "median"), Arrivals=("Arrivals", "sum")).reset_index()
    state["Market"] = STATE_MARKET
    state["Variety"] = STATE_VARIETY
    return state


def build_daily_panel(clean: pd.DataFrame) -> pd.DataFrame:
    """Continuous daily panel for every series plus the state-level reference series."""
    base = clean[["Date", *SERIES_KEY, "Arrivals", "Min_Price", "Max_Price", "Modal_Price"]]
    data = pd.concat([base, _state_level_series(clean)], ignore_index=True)
    for col in SERIES_KEY:
        data[col] = data[col].astype(str)

    parts = []
    for key, grp in data.groupby(SERIES_KEY, sort=True):
        grp = grp.set_index("Date").sort_index()
        idx = pd.date_range(grp.index.min(), grp.index.max(), freq="D")
        g = grp.reindex(idx)
        out = pd.DataFrame({"Date": idx})
        for col, val in zip(SERIES_KEY, key):
            out[col] = val
        out["observed"] = g["Modal_Price"].notna().to_numpy()
        out["price"] = g["Modal_Price"].to_numpy()
        out["price_ffill"] = g["Modal_Price"].ffill(limit=PRICE_FFILL_LIMIT).to_numpy()
        out["arrivals"] = g["Arrivals"].to_numpy()
        out["spread"] = (np.log(g["Max_Price"]) - np.log(g["Min_Price"])).to_numpy()
        parts.append(out)
    panel = pd.concat(parts, ignore_index=True)

    state_ref = (panel[panel["Market"] == STATE_MARKET]
                 [["State", "Commodity", "Date", "price_ffill"]]
                 .rename(columns={"price_ffill": "state_price"}))
    panel = panel.merge(state_ref, on=["State", "Commodity", "Date"], how="left")
    return panel.sort_values([*SERIES_KEY, "Date"]).reset_index(drop=True)


def fit_encoders(panel: pd.DataFrame) -> dict[str, dict[str, int]]:
    return {
        "commodity": {v: i for i, v in enumerate(sorted(panel["Commodity"].unique()))},
        "market": {v: i for i, v in enumerate(sorted(panel["Market"].unique()))},
        "variety": {v: i for i, v in enumerate(sorted(panel["Variety"].unique()))},
    }


def compute_features(panel: pd.DataFrame, encoders: dict[str, dict[str, int]],
                     with_targets: bool = True) -> pd.DataFrame:
    """Feature frame for every row of a (possibly single-series) daily panel.

    Each series is contiguous in daily steps, so a within-series shift(k) is exactly
    k calendar days back.
    """
    df = panel.sort_values([*SERIES_KEY, "Date"]).reset_index(drop=True).copy()
    grp = df.groupby(SERIES_KEY, sort=False)
    lp = np.log(df["price_ffill"])
    df["log_price"] = lp

    for k in LAGS:
        df[f"lag_{k}_change"] = lp - grp["price_ffill"].shift(k).pipe(np.log)

    for w in ROLL_WINDOWS:
        rm = grp["price_ffill"].transform(lambda s: s.rolling(w, min_periods=max(3, w // 2)).mean())
        df[f"roll_mean_{w}_gap"] = lp - np.log(rm)
        df[f"_rm{w}"] = rm

    daily_ret = lp - grp["price_ffill"].shift(1).pipe(np.log)
    df["_ret"] = daily_ret
    df["volatility_30"] = df.groupby(SERIES_KEY, sort=False)["_ret"].transform(
        lambda s: s.rolling(30, min_periods=10).std())
    df["momentum_7_30"] = np.log(df["_rm7"]) - np.log(df["_rm30"])
    df["pct_change_7"] = np.exp(df["lag_7_change"]) - 1.0

    df["spread_ratio"] = grp["spread"].transform(lambda s: s.ffill(limit=PRICE_FFILL_LIMIT))

    la = np.log1p(df["arrivals"])
    df["_la"] = la
    la_ff = df.groupby(SERIES_KEY, sort=False)["_la"].transform(
        lambda s: s.ffill(limit=PRICE_FFILL_LIMIT))
    la_mean30 = df.groupby(SERIES_KEY, sort=False)["_la"].transform(
        lambda s: s.rolling(30, min_periods=5).mean())
    df["log_arrivals"] = la_ff
    df["arrivals_vs_30d"] = la_ff - la_mean30

    sp = np.log(df["state_price"])
    df["state_price_gap"] = lp - sp
    df["_sp"] = sp
    df["state_change_7"] = sp - df.groupby(SERIES_KEY, sort=False)["_sp"].shift(7)

    d = df["Date"]
    df["month"] = d.dt.month
    df["week_of_year"] = d.dt.isocalendar().week.astype(int).to_numpy()
    df["day_of_week"] = d.dt.dayofweek
    df["season_code"] = df["month"].map(lambda m: SEASON_CODE[season_for_month(int(m))])
    doy = d.dt.dayofyear
    df["doy_sin"] = np.sin(2 * np.pi * doy / 365.25)
    df["doy_cos"] = np.cos(2 * np.pi * doy / 365.25)

    df["commodity_code"] = df["Commodity"].map(encoders["commodity"]).fillna(-1).astype(int)
    df["market_code"] = df["Market"].map(encoders["market"]).fillna(-1).astype(int)
    df["variety_code"] = df["Variety"].map(encoders["variety"]).fillna(-1).astype(int)

    if with_targets:
        # price reported on (or at most TARGET_FFILL_LIMIT days before) each day
        df["target_price"] = grp["price"].transform(lambda s: s.ffill(limit=TARGET_FFILL_LIMIT))

    return df.drop(columns=[c for c in df.columns if c.startswith("_")])


def target_log_change(feat: pd.DataFrame, h: int) -> pd.Series:
    """log(price[t+h] / price[t]) for every row of a frame built with ``with_targets=True``."""
    later = feat.groupby(SERIES_KEY, sort=False)["target_price"].shift(-h)
    return np.log(later) - feat["log_price"]


def with_pair_features(origins: pd.DataFrame, horizons) -> pd.DataFrame:
    """Model input rows: one per (origin row, horizon). ``horizons`` is a scalar or an array
    aligned with ``origins``; the origin features are copied unchanged."""
    X = origins[FEATURE_COLUMNS].astype("float32").reset_index(drop=True)
    h = np.broadcast_to(np.asarray(horizons, dtype="float32"), (len(X),))
    target = pd.to_datetime(origins["Date"].to_numpy()) + pd.to_timedelta(h, unit="D")
    doy = target.dayofyear.to_numpy()
    X["horizon_days"] = h
    X["target_doy_sin"] = np.sin(2 * np.pi * doy / 365.25).astype("float32")
    X["target_doy_cos"] = np.cos(2 * np.pi * doy / 365.25).astype("float32")
    return X


def usable_origin_mask(feat: pd.DataFrame) -> pd.Series:
    """A row can be a forecast origin if the market reported that day and every
    feature is available (all lag windows are free of long gaps)."""
    return feat["observed"] & feat[FEATURE_COLUMNS].notna().all(axis=1)
