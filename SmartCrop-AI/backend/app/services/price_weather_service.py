"""Background weather for a price-prediction market and date. Shown to farmers as context only:
the price model does not use weather (see docs / price model metadata).

Status of the answer, never mixed:
  observed     the day has passed: values the Open-Meteo archive or recent-weather service reports for that day
  forecast     the day is today or up to 15 days ahead: Open-Meteo's weather forecast for that day
  typical      no observation or forecast exists for that day: the average of the same time of year (+-3 days) in
               2023-2025 from the project's stored market weather
  unavailable  nothing reliable could be found (market not mapped to a place, state-wide series, service down)
The place is the market's own town centre from dataset/crop_price/market_locations.csv (never another market's).
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from functools import lru_cache

import httpx
import pandas as pd

from app.ml.common import paths

log = logging.getLogger("smartcrop.price_weather")

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
DAILY = "temperature_2m_mean,precipitation_sum,relative_humidity_2m_mean"
TIMEOUT = 8.0
FORECAST_DAYS = 15
ARCHIVE_LAG_DAYS = 6          # archive data is complete up to about this many days ago
RECENT_DAYS = 90              # the forecast service can also return this many past days
STATE_SERIES = "All markets (state median)"


def today() -> date:
    return date.today()


@lru_cache(maxsize=1)
def _locations() -> pd.DataFrame:
    p = paths.CROP_PRICE_DIR / "market_locations.csv"
    return pd.read_csv(p) if p.exists() else pd.DataFrame()


@lru_cache(maxsize=1)
def _stored() -> pd.DataFrame | None:
    p = paths.DATASET_DIR / "weather" / "market_weather_daily.parquet"
    if not p.exists():
        return None
    df = pd.read_parquet(p, columns=["date", "market", "temperature_mean", "precipitation", "relative_humidity"])
    df["date"] = pd.to_datetime(df["date"])
    return df


def _out(status: str, market: str, day: date, **kw) -> dict:
    base = {"status": status, "market": market, "date": day.isoformat(), "temperature_c": None, "rainfall_mm": None,
            "humidity_pct": None, "source": None, "place": None, "note": None}
    return {**base, **kw}


def _place(market: str) -> tuple[float, float, str] | None:
    loc = _locations()
    if loc.empty:
        return None
    r = loc[(loc["market"] == market) & (loc["status"] == "mapped")]
    if r.empty:
        return None
    r = r.iloc[0]
    return float(r["latitude"]), float(r["longitude"]), str(r["matched_name"])


def _fetch(url: str, lat: float, lon: float, day: date) -> dict | None:
    try:
        r = httpx.get(url, params={"latitude": lat, "longitude": lon, "start_date": day.isoformat(),
                                   "end_date": day.isoformat(), "daily": DAILY, "timezone": "Asia/Kolkata"},
                      timeout=TIMEOUT)
        r.raise_for_status()
        d = r.json()["daily"]
        vals = (d["temperature_2m_mean"][0], d["precipitation_sum"][0], d["relative_humidity_2m_mean"][0])
        if any(v is None for v in vals):
            return None
        return {"temperature_c": round(float(vals[0]), 1), "rainfall_mm": round(float(vals[1]), 1),
                "humidity_pct": round(float(vals[2]))}
    except Exception as exc:   # network, quota or format problems must never break the price page
        log.warning("weather lookup failed: %s", type(exc).__name__)
        return None


def _typical(market: str, day: date) -> dict | None:
    df = _stored()
    if df is None:
        return None
    m = df[df["market"] == market]
    if m.empty:
        return None
    doy = m["date"].dt.dayofyear
    target = pd.Timestamp(day).dayofyear
    diff = (doy - target).abs()
    near = m[(diff <= 3) | (diff >= 362)].dropna()
    if len(near) < 7:
        return None
    return {"temperature_c": round(float(near["temperature_mean"].mean()), 1),
            "rainfall_mm": round(float(near["precipitation"].mean()), 1),
            "humidity_pct": round(float(near["relative_humidity"].mean())),
            "years": sorted({int(y) for y in near["date"].dt.year})}


def weather_context(market: str, day: date) -> dict:
    market = (market or "").strip()
    if not market or market == STATE_SERIES:
        return _out("unavailable", market, day, note="This price covers many markets, so there is no single place to show weather for.")
    place = _place(market)
    if place is None:
        return _out("unavailable", market, day, note="This market could not be matched to a place.")
    lat, lon, name = place
    t = today()
    where = {"place": f"{name} (town centre)"}
    if day >= t and day <= t + timedelta(days=FORECAST_DAYS):
        v = _fetch(FORECAST_URL, lat, lon, day)
        if v:
            return _out("forecast", market, day, **v, **where, source="Open-Meteo weather forecast")
    elif day < t:
        age = (t - day).days
        if age > ARCHIVE_LAG_DAYS:
            v = _fetch(ARCHIVE_URL, lat, lon, day)
            src = "Open-Meteo historical archive"
        elif age <= RECENT_DAYS:
            v = _fetch(FORECAST_URL, lat, lon, day)
            src = "Open-Meteo recent weather"
        else:
            v = None
        if v:
            return _out("observed", market, day, **v, **where, source=src)
    ty = _typical(market, day)
    if ty:
        yrs = ty.pop("years")
        return _out("typical", market, day, **ty, **where, source=f"Stored market weather, same time of year, {yrs[0]}-{yrs[-1]}",
                    note="No observation or forecast exists for this date. These are typical values for this time of year.")
    return _out("unavailable", market, day, **where, note="Weather information unavailable.")


# ---------------------------------------------------------------------------------------------------------------------------------
# Regional soil-map estimates (SoilGrids, ISRIC World Soil Information, CC BY 4.0). Shown to farmers as background only: they are map
# estimates for the market's area, not measurements from any farm, and the price model does not use them.
SOILGRIDS_PROPS = "https://rest.isric.org/soilgrids/v2.0/properties/query"
SOILGRIDS_CLASS = "https://rest.isric.org/soilgrids/v2.0/classification/query"
SOIL_TIMEOUT = 9.0
SOIL_SOURCE = "SoilGrids (ISRIC), regional soil map"
_soil_cache: dict[str, dict] = {}    # soil does not change from day to day; only answers that found something are kept


def _soil_ph_at(lat: float, lon: float, depth: str) -> float | None:
    """Soil pH (water) at one depth from the soil map, or None when the map has no value there (for example built-up areas) or the service fails."""
    try:
        r = httpx.get(SOILGRIDS_PROPS, params={"lon": lon, "lat": lat, "property": "phh2o", "depth": depth, "value": "mean"}, timeout=SOIL_TIMEOUT)
        r.raise_for_status()
        layer = r.json()["properties"]["layers"][0]
        v = layer["depths"][0]["values"]["mean"]
        if v is None:
            return None
        ph = float(v) / (layer.get("unit_measure", {}).get("d_factor") or 10)
        return round(ph, 1) if 2.0 <= ph <= 11.0 else None     # outside this range the value is not a plausible soil pH
    except Exception as exc:   # timeouts, quota and format problems must never break the price page
        log.warning("soil pH lookup failed: %s", type(exc).__name__)
        return None


def _soil_class(lat: float, lon: float) -> str | None:
    """Most likely soil class (World Reference Base group) from the soil map, or None."""
    try:
        r = httpx.get(SOILGRIDS_CLASS, params={"lon": lon, "lat": lat, "number_classes": 1}, timeout=SOIL_TIMEOUT)
        r.raise_for_status()
        name = r.json().get("wrb_class_name")
        return str(name) if name else None
    except Exception as exc:
        log.warning("soil class lookup failed: %s", type(exc).__name__)
        return None


def soil_context(market: str) -> dict:
    market = (market or "").strip()
    out = {"status": "unavailable", "market": market, "place": None, "ph": None, "soil_type": None, "source": SOIL_SOURCE,
           "note": "These are regional soil-map estimates for the market area, not measurements from your farm."}
    if not market or market == STATE_SERIES:
        return {**out, "note": "This price covers many markets, so there is no single place to look up soil for."}
    if market in _soil_cache:
        return _soil_cache[market]
    place = _place(market)
    if place is None:
        return {**out, "note": "This market could not be matched to a place."}
    lat, lon, name = place
    with ThreadPoolExecutor(max_workers=3) as pool:      # the three lookups are independent, so they run at the same time
        top, deeper, cls_f = (pool.submit(_soil_ph_at, lat, lon, "0-5cm"), pool.submit(_soil_ph_at, lat, lon, "5-15cm"), pool.submit(_soil_class, lat, lon))
        ph = top.result()
        ph = ph if ph is not None else deeper.result()
        cls = cls_f.result()
    out.update(place=f"{name} (town centre)", ph=ph, soil_type=cls)
    if ph is not None or cls is not None:
        out["status"] = "estimate"
        _soil_cache[market] = out
    return out
