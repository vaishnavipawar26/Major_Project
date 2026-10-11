"""Monthly price panel and features for the selling-month forecaster.

Shared by scripts/train_monthly_price_model.py and the API so features are identical.

Representation
--------------
* One monthly series per (city, crop): median modal price of all mandi reports in the city's
  markets that month (city_market_map.csv), plus one state-wide series per crop
  ("Maharashtra (all markets)"). A month needs at least MIN_REPORTS reports, otherwise it is
  missing — never interpolated.
* Prices are converted to REAL terms with an assumed constant annual inflation rate
  (deflator (1 + r)^(months / 12) from January 2023). The model learns seasonal and
  mean-reverting behaviour on real prices; inflation is added back explicitly for the target
  month, so it is visible to the user as its own component.
* Target: log(real price[t + h] / real price[t]) for h = 1..H_MAX months (direct
  multi-horizon model: the horizon is a feature).
* Every feature at origin t uses data up to month t only (no look-ahead), including the
  seasonal priors, which are rebuilt from the history available at t.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

STATE_SERIES = "Maharashtra (all markets)"
H_MAX = 24
MIN_REPORTS = 4
DEFAULT_INFLATION = 0.05   # assumed annual rate; stored in model metadata
BASE_PERIOD = pd.Period("2023-01", freq="M")

FEATURES = [
    "horizon", "origin_month", "target_month", "crop_code", "city_code",
    "mom_1", "mom_3", "level_vs_3m", "level_vs_12m", "volatility_6",
    "arrivals_vs_12m", "city_premium", "seasonal_prior", "seasonal_supply_prior",
]

# Farmer-facing grouping for SHAP explanations
FACTOR_OF = {
    "target_month": "season", "origin_month": "season", "seasonal_prior": "season",
    "seasonal_supply_prior": "supply", "arrivals_vs_12m": "supply",
    "mom_1": "momentum", "mom_3": "momentum",
    "level_vs_3m": "level", "level_vs_12m": "level",
    "volatility_6": "volatility",
    "horizon": "horizon",
    "city_code": "local", "city_premium": "local",
    "crop_code": "crop",
}
FACTOR_LABELS = {
    "season": "Seasonal price pattern", "supply": "Market supply (arrivals)",
    "momentum": "Recent price movement", "level": "Current price vs. normal",
    "volatility": "Price volatility", "horizon": "Months until selling",
    "local": "Your city's market", "crop": "Crop-specific behaviour",
}


def month_index(period: pd.Period) -> int:
    return (period - BASE_PERIOD).n


def deflator(t: np.ndarray | int, inflation: float) -> np.ndarray:
    return np.power(1 + inflation, np.asarray(t, dtype=float) / 12.0)


# ----------------------------------------------------------------------------- panel
def build_monthly_panel(clean: pd.DataFrame, city_markets: dict[str, list[str]]) -> pd.DataFrame:
    """Long table: series, Commodity, period (YYYY-MM), price, arrivals, reports."""
    df = clean[["Date", "Market", "Commodity", "Modal_Price", "Arrivals"]].copy()
    df["period"] = df["Date"].dt.to_period("M")
    market_city = {m: c for c, ms in city_markets.items() for m in ms}
    df["series"] = df["Market"].map(market_city)

    def agg(g):
        return g.agg(price=("Modal_Price", "median"), arrivals=("Arrivals", "sum"),
                     reports=("Modal_Price", "size")).reset_index()

    city = agg(df.dropna(subset=["series"]).groupby(["series", "Commodity", "period"]))
    state = agg(df.groupby(["Commodity", "period"]))
    state["series"] = STATE_SERIES
    panel = pd.concat([city, state], ignore_index=True)
    panel = panel[panel["reports"] >= MIN_REPORTS]
    panel["period"] = panel["period"].astype(str)
    return panel.sort_values(["series", "Commodity", "period"]).reset_index(drop=True)


def series_frame(panel: pd.DataFrame, series: str, crop: str, end: pd.Period) -> pd.DataFrame:
    """Continuous monthly frame (t = months since Jan 2023) up to ``end``; gaps stay NaN."""
    s = panel[(panel["series"] == series) & (panel["Commodity"] == crop)]
    idx = pd.period_range(BASE_PERIOD, end, freq="M")
    s = s.assign(period=pd.PeriodIndex(s["period"], freq="M")).set_index("period")
    s = s.reindex(idx)
    return pd.DataFrame({"period": idx, "t": np.arange(len(idx)),
                         "price": s["price"].to_numpy(float),
                         "arrivals": s["arrivals"].to_numpy(float)})


# ----------------------------------------------------------------------------- features
def _seasonal_profile(values: np.ndarray, months: np.ndarray, upto: int) -> np.ndarray | None:
    """Mean deviation per calendar month from the overall mean, using values[0..upto].
    None until every calendar month has been observed at least once."""
    v, m = values[:upto + 1], months[:upto + 1]
    ok = ~np.isnan(v)
    if ok.sum() < 12:
        return None
    overall = v[ok].mean()
    prof = np.full(13, np.nan)
    for k in range(1, 13):
        sel = ok & (m == k)
        if not sel.any():
            return None
        prof[k] = v[sel].mean() - overall
    return prof


def _window(a: np.ndarray, t: int, n: int) -> np.ndarray:
    return a[max(0, t - n + 1):t + 1]


def origin_features(lr: np.ndarray, larr: np.ndarray, lr_state: np.ndarray, t: int) -> dict:
    """State-of-the-market features at origin t (real log price ``lr``)."""
    def nanmean_min(x, k):
        x = x[~np.isnan(x)]
        return x.mean() if len(x) >= k else np.nan

    w12, w3 = _window(lr, t, 12), _window(lr, t, 3)
    diffs = np.diff(_window(lr, t, 7))
    diffs = diffs[~np.isnan(diffs)]
    a12 = _window(larr, t, 12)
    return {
        "mom_1": lr[t] - lr[t - 1] if t >= 1 else np.nan,
        "mom_3": lr[t] - lr[t - 3] if t >= 3 else np.nan,
        "level_vs_3m": lr[t] - nanmean_min(w3, 2),
        "level_vs_12m": lr[t] - nanmean_min(w12, 6),
        "volatility_6": diffs.std() if len(diffs) >= 4 else np.nan,
        "arrivals_vs_12m": larr[t] - nanmean_min(a12, 6) if not np.isnan(larr[t]) else np.nan,
        "city_premium": lr[t] - lr_state[t] if not np.isnan(lr_state[t]) else np.nan,
    }


class SeriesContext:
    """Pre-computed arrays for one (series, crop) used for both training rows and serving."""

    def __init__(self, frame: pd.DataFrame, state_frame: pd.DataFrame, inflation: float,
                 crop_code: int, city_code: int) -> None:
        self.frame = frame
        self.t = frame["t"].to_numpy()
        self.months = frame["period"].dt.month.to_numpy()
        defl = deflator(self.t, inflation)
        self.lr = np.log(frame["price"].to_numpy() / defl)
        self.larr = np.log1p(frame["arrivals"].to_numpy())
        self.lr_state = np.log(state_frame["price"].to_numpy() / defl)
        self.larr_state = np.log1p(state_frame["arrivals"].to_numpy())
        self.crop_code, self.city_code = crop_code, city_code
        self._prof_cache: dict[int, tuple] = {}

    def profiles(self, t: int) -> tuple:
        if t not in self._prof_cache:
            self._prof_cache[t] = (_seasonal_profile(self.lr_state, self.months, t),
                                   _seasonal_profile(self.larr_state, self.months, t))
        return self._prof_cache[t]

    def last_observed(self, upto: int | None = None) -> int | None:
        idx = np.where(~np.isnan(self.lr[:None if upto is None else upto + 1]))[0]
        return int(idx[-1]) if len(idx) else None

    def rows(self, t: int, horizons) -> pd.DataFrame:
        base = origin_features(self.lr, self.larr, self.lr_state, t)
        price_prof, supply_prof = self.profiles(t)
        om = int(self.months[t])
        out = []
        for h in horizons:
            tm = (om - 1 + h) % 12 + 1
            out.append({
                **base, "horizon": h, "origin_month": om, "target_month": tm,
                "crop_code": self.crop_code, "city_code": self.city_code,
                "seasonal_prior": np.nan if price_prof is None else price_prof[tm] - price_prof[om],
                "seasonal_supply_prior": (np.nan if supply_prof is None
                                          else supply_prof[tm] - supply_prof[om]),
            })
        return pd.DataFrame(out)[FEATURES]


def training_rows(ctx: SeriesContext, h_max: int = H_MAX) -> pd.DataFrame:
    parts = []
    n = len(ctx.lr)
    for t in range(n):
        if np.isnan(ctx.lr[t]):
            continue
        hs = [h for h in range(1, h_max + 1) if t + h < n and not np.isnan(ctx.lr[t + h])]
        if not hs:
            continue
        rows = ctx.rows(t, hs)
        rows["y"] = [ctx.lr[t + h] - ctx.lr[t] for h in hs]
        rows["origin_t"] = t
        rows["target_t"] = [t + h for h in hs]
        rows["origin_price"] = math.exp(ctx.lr[t])            # real
        rows["target_price_nominal"] = [float(ctx.frame["price"].iloc[t + h]) for h in hs]
        rows["origin_price_nominal"] = float(ctx.frame["price"].iloc[t])
        # seasonal-naive baseline: latest same-calendar-month real price at or before t
        sn = []
        for h in hs:
            k = t + h - 12 * math.ceil(h / 12)
            while k >= 0 and np.isnan(ctx.lr[k]):
                k -= 12
            sn.append(ctx.lr[k] - ctx.lr[t] if k >= 0 else np.nan)
        rows["seasonal_naive_y"] = sn
        parts.append(rows)
    return pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()
