"""Weather features for the price forecaster (pure functions, no network).

What a forecast origin t may know
---------------------------------
* Observed/reanalysis weather up to and including day t   -> trailing summaries (``*_7``, ``*_30``).
* Climatological normals computed ONLY from years <= CLIMATOLOGY_END_YEAR (2022), i.e. before
  every price observation (2023+) -> anomalies relative to normal.
Nothing after day t is ever read, so a historical backtest sees exactly what a live forecast
made on that day would have seen. Archived *forecasts* are deliberately not used: the
Open-Meteo "historical forecast" archive stitches the first hours of each model run and is
not what was known several days ahead, so using it would overstate skill.

Features (units; all NaN when the market has no mapped location or the window has gaps):
  temp_mean_7      mean daily temperature of the last 7 days            (degC)
  temp_anom_7      temp_mean_7 minus the normal for the same 7 days     (degC)
  precip_sum_7     rainfall of the last 7 days                          (mm)
  precip_sum_30    rainfall of the last 30 days                         (mm)
  precip_ratio_30  precip_sum_30 / (normal 30-day rainfall + 10 mm)     (ratio, 1 = normal)
  humidity_mean_7  mean relative humidity of the last 7 days            (%)
Missing values are left as NaN (never 0); the tree models handle NaN natively and are trained
with the same convention.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

CLIMATOLOGY_END_YEAR = 2022
STATE_MARKET = "All markets (state median)"
WEATHER_FEATURES = ["temp_mean_7", "temp_anom_7", "precip_sum_7", "precip_sum_30",
                    "precip_ratio_30", "humidity_mean_7"]
RATIO_EPS_MM = 10.0   # stops the rainfall ratio exploding in dry months


def _circular_smooth(a: np.ndarray, half: int) -> np.ndarray:
    ext = np.concatenate([a[-half:], a, a[:half]])
    k = np.ones(2 * half + 1) / (2 * half + 1)
    return np.convolve(ext, k, mode="valid")


def add_state_series(w: pd.DataFrame) -> pd.DataFrame:
    """Append a state-level pseudo market: the plain mean over all mapped markets each day."""
    cols = [c for c in ("temperature_mean", "precipitation", "relative_humidity") if c in w.columns]
    agg = w.groupby("date", as_index=False)[cols].mean()
    agg["market"] = STATE_MARKET
    return pd.concat([w[["market", "date", *cols]], agg], ignore_index=True)


def normals(w: pd.DataFrame) -> dict[str, dict[str, np.ndarray]]:
    """Per market: normal daily temperature and rainfall by day of year (length 365), from
    years <= CLIMATOLOGY_END_YEAR only."""
    out = {}
    base = w[w["date"].dt.year <= CLIMATOLOGY_END_YEAR].copy()
    base["doy"] = np.minimum(base["date"].dt.dayofyear, 365) - 1
    for m, g in base.groupby("market"):
        t = g.groupby("doy")["temperature_mean"].mean().reindex(range(365)).interpolate(limit_direction="both")
        p = g.groupby("doy")["precipitation"].mean().reindex(range(365)).interpolate(limit_direction="both")
        if t.isna().all() or p.isna().all():
            continue
        out[m] = {"temp": _circular_smooth(t.to_numpy(float), 7),
                  "precip": _circular_smooth(p.to_numpy(float), 15)}
    return out


def build_weather_features(w: pd.DataFrame) -> pd.DataFrame:
    """Daily feature table (market, date, WEATHER_FEATURES) from a daily weather table with
    columns market, date, temperature_mean, precipitation, relative_humidity. ``w`` should
    already include the state pseudo-market (see add_state_series)."""
    nrm = normals(w)
    parts = []
    for m, g in w.groupby("market"):
        if m not in nrm:
            continue
        g = g.sort_values("date").set_index("date")
        g = g.reindex(pd.date_range(g.index.min(), g.index.max(), freq="D"))  # gaps stay NaN
        doy = np.minimum(g.index.dayofyear.to_numpy(), 365) - 1
        n_temp, n_prec = nrm[m]["temp"][doy], nrm[m]["precip"][doy]
        f = pd.DataFrame(index=g.index)
        f["temp_mean_7"] = g["temperature_mean"].rolling(7, min_periods=7).mean()
        f["temp_anom_7"] = f["temp_mean_7"] - pd.Series(n_temp, g.index).rolling(7, min_periods=7).mean()
        f["precip_sum_7"] = g["precipitation"].rolling(7, min_periods=7).sum()
        f["precip_sum_30"] = g["precipitation"].rolling(30, min_periods=30).sum()
        norm30 = pd.Series(n_prec, g.index).rolling(30, min_periods=30).sum()
        f["precip_ratio_30"] = f["precip_sum_30"] / (norm30 + RATIO_EPS_MM)
        f["humidity_mean_7"] = g["relative_humidity"].rolling(7, min_periods=7).mean()
        f["market"] = m
        parts.append(f.rename_axis("date").reset_index())
    out = pd.concat(parts, ignore_index=True)
    return out[["market", "date", *WEATHER_FEATURES]].astype({c: "float32" for c in WEATHER_FEATURES})


def attach(df: pd.DataFrame, feats: pd.DataFrame | None) -> pd.DataFrame:
    """Left-join weather features onto a frame with ``Market`` and ``Date`` columns. Rows whose
    market has no weather get NaN. With ``feats=None`` every weather feature is NaN."""
    if feats is None or feats.empty:
        out = df.copy()
        for c in WEATHER_FEATURES:
            out[c] = np.float32(np.nan)
        return out
    f = feats.rename(columns={"market": "Market", "date": "Date"})
    f["Market"] = f["Market"].astype(str)
    out = df.merge(f, on=["Market", "Date"], how="left", validate="m:1")
    return out
