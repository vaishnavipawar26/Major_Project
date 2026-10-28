"""Background weather and soil for a price prediction's growing location (or, for older requests without one, its selling market) and
selling date. Shown to farmers as context only: the price model does not
use them (its 29 inputs are price, arrivals, calendar and crop/market codes).

Weather status, never mixed:
  observed     the day has passed: values the Open-Meteo archive (or, for the last few days, its recent-weather service) reports
  forecast     the day is today or up to 15 days ahead: Open-Meteo's forecast for that day
  typical      no observation or forecast could be used for that day: the average of the same time of year (+-3 days) from the project's
               stored market weather. An estimate, never presented as a measurement for the selected date.
  unavailable  nothing trustworthy exists; ``reason`` says why (no_coordinates, ambiguous_location, state_series, service_unreachable,
               beyond_forecast_range, no_data)
Soil status: estimate (regional SoilGrids map values, not farm measurements) or unavailable (with ``reason``).

Every answer says where it came from: ``served_from`` is live (just fetched), cache (stored earlier in the environmental_records table;
``retrieved_at`` says when) or stored_history (the project's own weather file). Valid answers are kept in the database
(app/services/environment_store.py), so the same place and day give every user of this database the same values, the backend can restart
without losing them, and a later provider outage can still be answered.

Places: the growing location the farmer chose on the price form (coordinates from app/services/geocoding_service.py). Requests without
one (older clients, predictions saved before the field existed) use the selling market's town centre from
dataset/crop_price/market_locations.csv plus market_locations_extra.csv, labelled as the market town, and report the growing location as not
provided. A growing location that cannot be resolved makes the factors unavailable; the selling market is never used in its place.
Stored records are keyed by coordinates and date, so two growing locations never share a record just because they sell at one market.
"""
from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from datetime import date, timedelta
from functools import lru_cache

import pandas as pd

from app.config.settings import get_settings
from app.ml.common import paths
from app.services import environment_store as store
from app.services import geocoding_service
from app.services.http_client import get_json

log = logging.getLogger("smartcrop.price_weather")

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
PAID_ARCHIVE_URL = "https://customer-archive-api.open-meteo.com/v1/archive"
PAID_FORECAST_URL = "https://customer-api.open-meteo.com/v1/forecast"
DAILY = "temperature_2m_mean,precipitation_sum,relative_humidity_2m_mean"
TIMEZONE = "Asia/Kolkata"     # every "day" is a calendar day in India, the same zone the price data uses
TIMEOUT = 8.0
FORECAST_DAYS = 15
ARCHIVE_LAG_DAYS = 6          # archive data is complete up to about this many days ago
RECENT_DAYS = 90              # the forecast service can also return this many past days
STATE_SERIES = "All markets (state median)"
# how long a stored answer counts as current (a past day's archive record never changes)
TTL_FORECAST = timedelta(hours=3)
TTL_RECENT = timedelta(hours=6)
TTL_SOIL = timedelta(days=30)
UNREACHABLE = {"timeout", "network", "rate_limited", "server_error", "rejected", "bad_response", "unknown", "backoff"}
FACTOR_BUDGET_SECONDS = 8.0   # the prediction response never waits longer than this for environmental data


def today() -> date:
    return date.today()


def _url(kind: str) -> tuple[str, dict]:
    """Free endpoints, or the customer endpoints with the key when OPEN_METEO_API_KEY is set (commercial use). The key is only sent to
    Open-Meteo and never logged or returned."""
    key = get_settings().OPEN_METEO_API_KEY
    if key:
        return (PAID_ARCHIVE_URL if kind == "archive" else PAID_FORECAST_URL), {"apikey": key}
    return (ARCHIVE_URL if kind == "archive" else FORECAST_URL), {}


@lru_cache(maxsize=1)
def _location_tables() -> tuple[pd.DataFrame, set[str]]:
    """Mapped markets (first geocoding pass plus the reviewed second pass) and the markets whose name matched several towns."""
    frames, ambiguous = [], set()
    for name in ("market_locations.csv", "market_locations_extra.csv"):
        p = paths.CROP_PRICE_DIR / name
        if p.exists():
            df = pd.read_csv(p)
            frames.append(df[df["status"] == "mapped"][["market", "latitude", "longitude", "matched_name"]])
            ambiguous |= set(df.loc[df["status"].isin(["ambiguous", "rejected"]), "market"])
    mapped = (pd.concat(frames, ignore_index=True).drop_duplicates("market", keep="first") if frames
              else pd.DataFrame(columns=["market", "latitude", "longitude", "matched_name"]))
    return mapped, ambiguous - set(mapped["market"])


def _locations() -> pd.DataFrame:
    return _location_tables()[0]


@lru_cache(maxsize=1)
def _stored() -> pd.DataFrame | None:
    p = paths.DATASET_DIR / "weather" / "market_weather_daily.parquet"
    if not p.exists():
        return None
    df = pd.read_parquet(p, columns=["date", "market", "temperature_mean", "precipitation", "relative_humidity"])
    df["date"] = pd.to_datetime(df["date"])
    return df


def _place(market: str) -> tuple[float, float, str] | None:
    loc = _locations()
    r = loc[loc["market"] == market]
    if r.empty:
        return None
    r = r.iloc[0]
    return float(r["latitude"]), float(r["longitude"]), str(r["matched_name"])


def _no_place_reason(market: str) -> tuple[str, str]:
    if market in _location_tables()[1]:
        return "ambiguous_location", "This market's name matches more than one town, so no single place can be used for it."
    return "no_coordinates", "No location is configured for this market yet."


# ----------------------------------------------------------------------------------------------------------------------- weather
def _out(status: str, market: str, day: date, **kw) -> dict:
    base = {"status": status, "market": market, "date": day.isoformat(), "temperature_c": None, "rainfall_mm": None,
            "humidity_pct": None, "source": None, "place": None, "latitude": None, "longitude": None, "note": None,
            "served_from": None, "retrieved_at": None, "reason": None, "place_kind": None}
    return {**base, **kw}


def _fetch(url: str, lat: float, lon: float, day: date, extra: dict | None = None) -> tuple[dict | None, str | None]:
    """One day of weather, or (None, reason). A day with any missing value counts as no data, never as 0."""
    data, err = get_json(url, {"latitude": lat, "longitude": lon, "start_date": day.isoformat(), "end_date": day.isoformat(),
                               "daily": DAILY, "timezone": TIMEZONE, **(extra or {})}, TIMEOUT)
    if err:
        return None, err
    try:
        d = data["daily"]
        vals = (d["temperature_2m_mean"][0], d["precipitation_sum"][0], d["relative_humidity_2m_mean"][0])
    except (KeyError, IndexError, TypeError):
        return None, "bad_response"
    if any(v is None for v in vals):
        return None, "no_data"
    return {"temperature_c": round(float(vals[0]), 1), "rainfall_mm": round(float(vals[1]), 1), "humidity_pct": round(float(vals[2]))}, None


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


def _from_store(e: dict, market: str, day: date, where: dict) -> dict:
    vals = {k: e[k] for k in ("temperature_c", "humidity_pct", "rainfall_mm")}
    if vals["humidity_pct"] is not None:
        vals["humidity_pct"] = round(vals["humidity_pct"])
    return _out(e["data_type"], market, day, **vals, **where, source=e["source"], served_from="cache", retrieved_at=e["retrieved_at"])


def _growing_where(place: dict) -> tuple[float, float, str, dict]:
    lat, lon, name = float(place["latitude"]), float(place["longitude"]), str(place["label"])
    return lat, lon, name, {"place": name, "latitude": lat, "longitude": lon, "place_kind": "growing_location"}


def weather_context(market: str, day: date, place: dict | None = None) -> dict:
    """Weather for ``place`` ({label, latitude, longitude}: the growing location) when given, else for the selling market's town."""
    market = (market or "").strip()
    typical_market = None          # typical values exist only for markets (the project's stored market weather), never for other places
    if place is not None:
        lat, lon, name, where = _growing_where(place)
    else:
        if not market or market == STATE_SERIES:
            return _out("unavailable", market, day, reason="state_series",
                        note="This price covers many markets, so there is no single place to show weather for.")
        found = _place(market)
        if found is None:
            reason, note = _no_place_reason(market)
            return _out("unavailable", market, day, reason=reason, note=note)
        lat, lon, name = found
        where = {"place": f"{name} (town centre)", "latitude": lat, "longitude": lon, "place_kind": "selling_market_town"}
        typical_market = market
    t = today()
    age = (t - day).days
    if 0 <= -age <= FORECAST_DAYS:
        kind, data_type, src, ttl = "forecast", "forecast", "Open-Meteo weather forecast", TTL_FORECAST
    elif age > ARCHIVE_LAG_DAYS:
        kind, data_type, src, ttl = "archive", "observed", "Open-Meteo historical archive", None
    elif 0 < age <= RECENT_DAYS:
        kind, data_type, src, ttl = "forecast", "observed", "Open-Meteo recent weather", TTL_RECENT
    else:
        kind = None       # further ahead than any forecast reaches: only typical conditions can be given

    reason = "beyond_forecast_range" if kind is None else None
    if kind is not None:
        stored = store.get("weather", lat, lon, day.isoformat(), data_type)
        if stored and stored["is_fresh"]:
            return _from_store(stored, market, day, where)
        url, extra = _url(kind)
        v, err = _fetch(url, lat, lon, day, extra)
        if v:
            e = store.put("weather", data_type, market, name, lat, lon, day.isoformat(), day, v, src, ttl)
            return _out(data_type, market, day, **v, **where, source=src, served_from="live", retrieved_at=e["retrieved_at"])
        if stored:       # the provider failed: an earlier valid answer for the same place and day is better than nothing, and says so
            return _from_store(stored, market, day, where)
        reason = "service_unreachable" if err in UNREACHABLE else "no_data"

    ty = _typical(typical_market, day) if typical_market else None
    if ty:
        yrs = ty.pop("years")
        return _out("typical", market, day, **ty, **where, source=f"Stored market weather, same time of year, {yrs[0]}-{yrs[-1]}",
                    served_from="stored_history", reason=reason,
                    note="No observation or forecast could be used for this date. These are typical values for this time of year.")
    return _out("unavailable", market, day, **where, reason=reason or "no_data", note="Weather information unavailable.")


# ----------------------------------------------------------------------------------------------------------------------- soil
# Regional soil-map estimates (SoilGrids 2.0, ISRIC World Soil Information, CC BY 4.0; 250 m grid). pH is "phh2o" (pH in water) stored by the
# service as pH x 10; the 0-5 cm layer is used (5-15 cm if empty). The soil type is the most likely WRB reference soil group, kept as the
# source names it. Shown as background only: map estimates for the market's area, not measurements from any farm.
SOILGRIDS_PROPS = "https://rest.isric.org/soilgrids/v2.0/properties/query"
SOILGRIDS_CLASS = "https://rest.isric.org/soilgrids/v2.0/classification/query"
SOIL_TIMEOUT = 6.0
SOIL_SOURCE = "SoilGrids (ISRIC), regional soil map"
SOIL_NOTE = "These are regional soil-map estimates for this area, not measurements from your farm."
# SoilGrids leaves built-up land empty, and a market's coordinates are its town centre, so the centre often has no pH. The map is then read
# at four points about 2 km around the town (farmland) and the median of the real values is used, labelled as the surrounding area.
RING_DEG = 0.02            # about 2.2 km north-south, about 2.1 km east-west at Maharashtra's latitude
RING_KM = 2


def _soil_ph_at(lat: float, lon: float, depth: str) -> tuple[float | None, str | None]:
    """Soil pH (water) at one depth, or (None, reason). A missing map value (for example a built-up area) is 'no_data', not a failure."""
    data, err = get_json(SOILGRIDS_PROPS, {"lon": lon, "lat": lat, "property": "phh2o", "depth": depth, "value": "mean"}, SOIL_TIMEOUT)
    if err:
        return None, err
    try:
        layer = data["properties"]["layers"][0]
        v = layer["depths"][0]["values"]["mean"]
    except (KeyError, IndexError, TypeError):
        return None, "bad_response"
    if v is None:
        return None, "no_data"
    ph = float(v) / (layer.get("unit_measure", {}).get("d_factor") or 10)
    return (round(ph, 1), None) if 2.0 <= ph <= 11.0 else (None, "no_data")   # outside this range it is not a plausible soil pH


def _soil_class(lat: float, lon: float) -> tuple[str | None, str | None]:
    """Most likely soil class (World Reference Base group), or (None, reason)."""
    data, err = get_json(SOILGRIDS_CLASS, {"lon": lon, "lat": lat, "number_classes": 1}, SOIL_TIMEOUT)
    if err:
        return None, err
    name = data.get("wrb_class_name") if isinstance(data, dict) else None
    return (str(name), None) if name else (None, "no_data")


def _soil_out(out: dict, e: dict, served_from: str, ph_reason: str | None) -> dict:
    return {**out, "ph": e["soil_ph"], "soil_type": e["soil_type"], "ph_scope": e["soil_ph_scope"], "status": "estimate",
            "served_from": served_from, "retrieved_at": e["retrieved_at"],
            "ph_reason": None if e["soil_ph"] is not None else ph_reason}


def soil_context(market: str, place: dict | None = None) -> dict:
    """Soil-map estimate for ``place`` ({label, latitude, longitude}: the growing location) when given, else for the selling market's town."""
    market = (market or "").strip()
    out = {"status": "unavailable", "market": market, "place": None, "latitude": None, "longitude": None, "ph": None, "soil_type": None,
           "source": SOIL_SOURCE, "note": SOIL_NOTE, "served_from": None, "retrieved_at": None, "reason": None, "ph_reason": None,
           "ph_scope": None, "ph_area_km": RING_KM, "ph_depth": "0-5 cm", "classification": "WRB reference soil group", "place_kind": None}
    if place is not None:
        lat, lon, name, where = _growing_where(place)
        out.update(where)
    else:
        if not market or market == STATE_SERIES:
            return {**out, "reason": "state_series", "note": "This price covers many markets, so there is no single place to look up soil for."}
        found = _place(market)
        if found is None:
            reason, note = _no_place_reason(market)
            return {**out, "reason": reason, "note": note}
        lat, lon, name = found
        out.update(place=f"{name} (town centre)", latitude=lat, longitude=lon, place_kind="selling_market_town")

    stored = store.get("soil", lat, lon, "static", "soil_estimate")
    if stored and stored["is_fresh"]:
        return _soil_out(out, stored, "cache", "not_in_map")

    with ThreadPoolExecutor(max_workers=3) as pool:      # the three lookups are independent, so they run at the same time
        top, deeper, cls_f = (pool.submit(_soil_ph_at, lat, lon, "0-5cm"), pool.submit(_soil_ph_at, lat, lon, "5-15cm"),
                              pool.submit(_soil_class, lat, lon))
        (ph, ph_err), (ph2, ph2_err), (cls, cls_err) = top.result(), deeper.result(), cls_f.result()
    if ph is None:
        ph, ph_err = ph2, (ph2_err if ph2 is None else None)
    ph_scope = "town_centre" if ph is not None else None
    if ph is None and ph_err == "no_data":          # the centre is masked (built-up): read the farmland around the town instead
        ring = [(lat + RING_DEG, lon), (lat - RING_DEG, lon), (lat, lon + RING_DEG), (lat, lon - RING_DEG)]
        with ThreadPoolExecutor(max_workers=4) as pool:
            vals = sorted(v for v, _ in pool.map(lambda pt: _soil_ph_at(pt[0], pt[1], "0-5cm"), ring) if v is not None)
        if vals:
            mid = len(vals) // 2
            ph = round(vals[mid] if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2, 1)
            ph_scope = "surrounding_area"

    if ph is not None or cls is not None:
        e = store.put("soil", "soil_estimate", market, name, lat, lon, "static", None,
                      {"soil_ph": ph, "soil_ph_scope": ph_scope, "soil_type": cls}, SOIL_SOURCE, TTL_SOIL)
        return _soil_out(out, e, "live", "not_in_map" if ph_err == "no_data" else "service_unreachable")
    if stored:          # the provider failed: an earlier valid estimate for the same place, labelled with its retrieval time
        return _soil_out(out, stored, "cache", "not_in_map")
    failed = {ph_err, cls_err} & UNREACHABLE
    return {**out, "reason": "service_unreachable" if failed else "no_data"}


# ----------------------------------------------------------------------------------------------------------------------- prediction
def _factor(value, unit, available_reason, data_type, w_or_s, **extra) -> dict:
    return {"value": value, "unit": unit, "available": value is not None, "data_type": data_type if value is not None else None,
            "reason": None if value is not None else available_reason, "source": w_or_s.get("source") if value is not None else None,
            "served_from": w_or_s.get("served_from") if value is not None else None,
            "retrieved_at": w_or_s.get("retrieved_at") if value is not None else None, **extra}


def resolve_growing(growing: dict | None) -> tuple[dict | None, str | None]:
    """{label, latitude, longitude, source} for the request's growing location, or (None, reason). Coordinates sent with the request (the
    place the farmer picked from the search) are used as they are; a label without coordinates (a re-opened saved prediction) is searched
    again."""
    if not growing:
        return None, None
    name = " ".join(str(growing.get("name") or "").split())
    if growing.get("latitude") is not None and growing.get("longitude") is not None:
        return {"label": name, "latitude": round(float(growing["latitude"]), 4), "longitude": round(float(growing["longitude"]), 4),
                "source": geocoding_service.SOURCE}, None
    found, err = geocoding_service.resolve(name)
    if found is None:
        return None, ("location_not_found" if err in ("not_found", "too_short") else "service_unreachable")
    return {"label": found["label"], "latitude": found["latitude"], "longitude": found["longitude"], "source": found["source"]}, None


def environmental_factors(market: str, selling_date: date, growing: dict | None = None) -> dict:
    """The six environmental factors for a prediction, with units, dates, sources and availability. ``growing`` is the request's growing
    location ({name, latitude, longitude}); weather and soil are looked up there. Without it, the selling market's town is used and labelled
    as such. Never raises and never waits longer than FACTOR_BUDGET_SECONDS: a slow or failing provider makes the factors 'unavailable', it
    never breaks the price prediction. A lookup still running when the budget ends keeps going in the background and is stored for the next
    request."""
    deadline = time.monotonic() + FACTOR_BUDGET_SECONDS
    left = lambda: max(0.1, deadline - time.monotonic())   # noqa: E731
    pool = ThreadPoolExecutor(max_workers=3)
    place, place_reason = None, None
    if growing:
        try:
            place, place_reason = pool.submit(resolve_growing, growing).result(timeout=left())
        except FutureTimeout:
            place_reason = "service_unreachable"
        except Exception:
            log.exception("growing location lookup failed")
            place_reason = "service_unreachable"

    if growing and place is None:     # the farmer's place could not be found: unavailable, never the selling market instead
        pool.shutdown(wait=False)
        w = _out("unavailable", market, selling_date, reason=place_reason, note="The growing location could not be found.")
        s = {"status": "unavailable", "reason": place_reason, "ph": None, "soil_type": None}
    else:
        wf, sf = pool.submit(weather_context, market, selling_date, place), pool.submit(soil_context, market, place)
        pool.shutdown(wait=False)
        try:
            w = wf.result(timeout=left())
        except FutureTimeout:
            w = _out("unavailable", market, selling_date, reason="service_unreachable", note="The weather service did not answer in time.")
        except Exception:    # never let context data break a prediction
            log.exception("weather context failed")
            w = _out("unavailable", market, selling_date, reason="no_data")
        try:
            s = sf.result(timeout=left())
        except FutureTimeout:
            s = {"status": "unavailable", "reason": "service_unreachable", "ph": None, "soil_type": None}
        except Exception:
            log.exception("soil context failed")
            s = {"status": "unavailable", "reason": "no_data", "ph": None, "soil_type": None}

    wdt = w.get("status") if w.get("status") in ("observed", "forecast", "typical") else None
    w_reason = w.get("reason") or "no_data"
    s_reason = s.get("reason") or s.get("ph_reason") or "no_data"
    if place is not None:
        growing_factor = {"value": place["label"], "unit": None, "available": True, "data_type": "chosen_by_farmer", "reason": None,
                          "source": place["source"], "served_from": None, "retrieved_at": None,
                          "latitude": place["latitude"], "longitude": place["longitude"]}
        location = {"name": place["label"], "latitude": place["latitude"], "longitude": place["longitude"], "kind": "growing_location"}
    elif growing:
        growing_factor = {"value": None, "unit": None, "available": False, "data_type": None, "reason": place_reason,
                          "entered": growing.get("name"), "note": "The growing location could not be found, so no weather or soil is shown."}
        location = {"name": None, "latitude": None, "longitude": None, "kind": "growing_location"}
    else:
        growing_factor = {"value": None, "unit": None, "available": False, "data_type": None, "reason": "not_provided",
                          "note": "No growing location was given with this request, so the selling market's town is used for weather and "
                                  "soil; it is not assumed to be where the crop was grown."}
        location = {"name": w.get("place") or s.get("place"), "latitude": w.get("latitude") or s.get("latitude"),
                    "longitude": w.get("longitude") or s.get("longitude"), "kind": "selling_market_town"}
    return {
        "selling_date": selling_date.isoformat(),
        "market": market,
        "location": location,
        "used_by_price_model": False,
        "note": "Environmental conditions shown for context; these factors are not inputs to the current price prediction model.",
        "temperature": _factor(w.get("temperature_c"), "°C", w_reason, wdt, w, measure="daily mean", date=w.get("date")),
        "humidity": _factor(w.get("humidity_pct"), "%", w_reason, wdt, w, measure="daily mean relative humidity", date=w.get("date")),
        "rainfall": _factor(w.get("rainfall_mm"), "mm", w_reason, wdt, w, period="daily total", date=w.get("date")),
        "soil_ph": _factor(s.get("ph"), "pH", s.get("ph_reason") or s_reason, "soil_estimate", s, depth="0-5 cm",
                           scope=s.get("ph_scope")),
        "soil_type": _factor(s.get("soil_type"), None, s_reason, "soil_estimate", s, classification="WRB reference soil group"),
        "growing_location": growing_factor,
        "weather": w,
        "soil": s,
    }
