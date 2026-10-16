"""Growing-period climate for a city, from Open-Meteo (free, no API key).

Coordinates come from dataset/crop_recommendation/city_coordinates.csv when the city is listed there (no
geocoding at all). Other cities are geocoded with the Open-Meteo Geocoding API, which still knows renamed
cities by their old names, so CITY_ALIASES maps new names to those. Daily temperature, humidity and rainfall of the
last 3 full calendar years come from the Open-Meteo Historical Archive API. For the months between
planting and selling (both included) the service returns the mean temperature, the mean humidity and the
rainfall per month (daily rainfall summed per month, then averaged over months and years) - the same
three quantities the crop model takes as inputs.

Results are cached in memory for 24 hours. No key is needed, so nothing secret is read or returned.
"""
from __future__ import annotations

import logging
import time
from datetime import date
from statistics import fmean

import httpx

from app.ml.common.reference import city_coordinates

log = logging.getLogger("smartcrop.weather")

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
SOURCE = "Open-Meteo"
YEARS = 3
TIMEOUT_SECONDS = 8.0
CACHE_TTL_SECONDS = 24 * 3600

_cache: dict[tuple, tuple[float, dict]] = {}


class WeatherError(Exception):
    """A problem the farmer can understand; `status_code` is the HTTP status the API should answer with."""

    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def growing_months(plant_month: int, sell_month: int) -> list[int]:
    """Calendar months from planting to selling, both included (wraps over the new year, at most 12)."""
    n = ((sell_month - plant_month) % 12) + 1
    return [((plant_month - 1 + i) % 12) + 1 for i in range(n)]


def _get_json(url: str, params: dict) -> dict:
    try:
        r = httpx.get(url, params=params, timeout=TIMEOUT_SECONDS)
    except httpx.TimeoutException:
        raise WeatherError(504, "The weather service took too long to answer. Please try again.")
    except httpx.HTTPError:
        raise WeatherError(502, "The weather service could not be reached. Please try again.")
    if r.status_code != 200:
        log.warning("Open-Meteo %s answered %s", url, r.status_code)
        raise WeatherError(502, "The weather service returned an error. Please try again later.")
    try:
        return r.json()
    except ValueError:
        raise WeatherError(502, "The weather service returned an unreadable answer.")


# New (official) names -> the name Open-Meteo's geocoder (GeoNames) still uses. Lower-case keys.
CITY_ALIASES: dict[str, list[str]] = {
    "chhatrapati sambhajinagar": ["Aurangabad"],
    "sambhajinagar": ["Aurangabad"],
    "dharashiv": ["Osmanabad"],
    "ahilyanagar": ["Ahmednagar"],
    "ahilya nagar": ["Ahmednagar"],
    "gurugram": ["Gurgaon"],
    "prayagraj": ["Allahabad"],
    "kalyan-dombivli": ["Kalyan"],
}


def _search(name: str, state: str) -> tuple[float, float, str] | None:
    data = _get_json(GEOCODE_URL, {"name": name, "count": 10, "language": "en", "format": "json",
                                   "countryCode": "IN"})
    results = data.get("results") or []
    if not results:
        return None
    in_state = [r for r in results if (r.get("admin1") or "").lower() == state.lower()]
    best = (in_state or results)[0]
    return float(best["latitude"]), float(best["longitude"]), best.get("name") or name


def locate(city: str, state: str) -> tuple[float, float, str, str]:
    """(latitude, longitude, name, source) with source = stored | alias | geocoder.

    Stored coordinates win; otherwise the typed name is geocoded first, then each alias."""
    stored = city_coordinates().get((state.lower(), city.lower()))
    if stored:
        return stored[0], stored[1], city, "stored"
    candidates = [(city, "geocoder")] + [(a, "alias") for a in CITY_ALIASES.get(city.lower(), [])]
    for name, source in candidates:
        found = _search(name, state)
        if found:
            return found[0], found[1], found[2], source
    raise WeatherError(404, f"Could not find '{city}'. Try the nearest bigger city or enter weather manually.")


def _climate(lat: float, lon: float, months: list[int], today: date) -> tuple[float, float, float]:
    first, last = today.year - YEARS, today.year - 1
    data = _get_json(ARCHIVE_URL, {
        "latitude": lat, "longitude": lon, "start_date": f"{first}-01-01", "end_date": f"{last}-12-31",
        "daily": "temperature_2m_mean,relative_humidity_2m_mean,precipitation_sum", "timezone": "auto"})
    daily = data.get("daily") or {}
    days = daily.get("time") or []
    temp = daily.get("temperature_2m_mean") or []
    hum = daily.get("relative_humidity_2m_mean") or []
    rain = daily.get("precipitation_sum") or []
    if not days or not (len(days) == len(temp) == len(hum) == len(rain)):
        raise WeatherError(502, "The weather service returned no data for this place.")

    temps, hums = [], []
    rain_by_month: dict[str, float] = {}   # "YYYY-MM" -> total rain of that month
    for d, t, h, p in zip(days, temp, hum, rain):
        if int(d[5:7]) not in months:
            continue
        if t is not None:
            temps.append(t)
        if h is not None:
            hums.append(h)
        if p is not None:
            rain_by_month[d[:7]] = rain_by_month.get(d[:7], 0.0) + p
    if not temps or not hums or not rain_by_month:
        raise WeatherError(502, "The weather service had no data for these months.")
    return fmean(temps), fmean(hums), fmean(rain_by_month.values())


def growing_period_weather(city: str, state: str, plant_month: int, sell_month: int,
                           today: date | None = None) -> dict:
    """Average growing-period weather for `city`; cached for 24 hours."""
    city, state = " ".join(city.split()), " ".join(state.split())
    if not city:
        raise WeatherError(422, "Please choose a city.")
    months = growing_months(plant_month, sell_month)
    lat, lon, name, source = locate(city, state)
    log.info("Weather for %r: coordinates from %s (%.4f, %.4f)", city, source, lat, lon)
    # only successful results are cached (errors raise before this point), so Retry really retries
    key = (round(lat, 4), round(lon, 4), tuple(months))
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < CACHE_TTL_SECONDS:
        return hit[1]

    t, h, r = _climate(lat, lon, months, today or date.today())
    out = {"city": name, "lat": round(lat, 4), "lon": round(lon, 4),
           "avgTemperature": round(t, 2), "avgHumidity": round(h, 2), "avgRainfall": round(r, 2),
           "source": SOURCE, "monthsUsed": months}
    _cache[key] = (time.monotonic(), out)
    return out


def clear_cache() -> None:
    _cache.clear()
