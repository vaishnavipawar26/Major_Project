"""Growing-period weather for a city, from the Open-Meteo historical archive.

Inputs are a city, a planting month and a selling month. The window runs from the first day of the planting
month to the last day of the selling month; when the selling month is earlier than the planting month the
window crosses the year end (Oct to Feb ends in the next year), and equal months give a 1-month window.

For the last 3 COMPLETED seasons of that window (a window that ended less than 7 days ago is skipped because
archive data lags) the service takes, per season: the mean daily temperature, the mean hourly relative
humidity and the total rainfall divided by the number of months in the window. The three seasons are then
averaged: {"temperature": °C, "humidity": %, "rainfall": mm per month}. Rainfall is per month, the same unit
the crop model was trained on.

Coordinates come from dataset/crop_recommendation/city_coordinates.csv (the cities of the City dropdown);
any other city is geocoded with the Open-Meteo Geocoding API. If OPEN_METEO_API_KEY is set (optional,
commercial use) the customer archive endpoint is used with the key; the key is only sent to Open-Meteo and
is never logged or returned. Successful results are cached in memory per (city, months, day).
"""
from __future__ import annotations

import calendar
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from statistics import fmean

import httpx

from app.config.settings import get_settings
from app.ml.common.reference import STATE, city_coordinates

log = logging.getLogger("smartcrop.weather")

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
FREE_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
PAID_ARCHIVE_URL = "https://customer-archive-api.open-meteo.com/v1/archive"
SEASONS = 3                 # completed seasons averaged
MAX_LOOKBACK_YEARS = 8      # how far back to look for those seasons
LAG_DAYS = 7                # a window that ended less than this many days ago is not complete in the archive
TIMEOUT_SECONDS = 20.0
UNAVAILABLE = "Weather data unavailable"

# city (lower case) -> (latitude, longitude), built from the cities of the City dropdown
CITY_COORDS: dict[str, tuple[float, float]] = {c: ll for (_, c), ll in city_coordinates().items()}

_cache: dict[tuple, dict] = {}


class WeatherError(Exception):
    """`status_code` is the HTTP status the API answers with; `message` is safe to show to the user."""

    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def months_in_window(planting_month: int, selling_month: int) -> int:
    """Calendar months from planting to selling, both included (wraps over the year end, 1 to 12)."""
    return ((selling_month - planting_month) % 12) + 1


def season_windows(planting_month: int, selling_month: int, today: date,
                   seasons: int = SEASONS) -> list[tuple[date, date]]:
    """The last `seasons` completed (start, end) windows, newest first. A window that ends within
    LAG_DAYS of today (or later) is skipped."""
    out: list[tuple[date, date]] = []
    for year in range(today.year, today.year - MAX_LOOKBACK_YEARS, -1):
        end_year = year if selling_month >= planting_month else year + 1
        start = date(year, planting_month, 1)
        end = date(end_year, selling_month, calendar.monthrange(end_year, selling_month)[1])
        if end > today - timedelta(days=LAG_DAYS):
            continue
        out.append((start, end))
        if len(out) == seasons:
            break
    return out


def _archive_url() -> str:
    return PAID_ARCHIVE_URL if get_settings().OPEN_METEO_API_KEY else FREE_ARCHIVE_URL


def _get_json(url: str, params: dict) -> dict:
    """GET + decode. Errors become WeatherError without leaking the URL parameters (they may hold the key)."""
    try:
        r = httpx.get(url, params=params, timeout=TIMEOUT_SECONDS)
    except httpx.TimeoutException:
        log.warning("Open-Meteo request timed out (%s)", url)
        raise WeatherError(502, UNAVAILABLE) from None
    except httpx.HTTPError as e:
        log.warning("Open-Meteo request failed (%s): %s", url, type(e).__name__)
        raise WeatherError(502, UNAVAILABLE) from None
    if r.status_code != 200:
        log.warning("Open-Meteo %s answered %s", url, r.status_code)
        raise WeatherError(502, UNAVAILABLE)
    try:
        return r.json()
    except ValueError:
        log.warning("Open-Meteo %s returned unreadable JSON", url)
        raise WeatherError(502, UNAVAILABLE) from None


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


def _search(name: str) -> tuple[float, float] | None:
    data = _get_json(GEOCODE_URL, {"name": name, "count": 10, "language": "en", "format": "json",
                                   "countryCode": "IN"})
    results = data.get("results") or []
    if not results:
        return None
    in_state = [r for r in results if (r.get("admin1") or "").lower() == STATE.lower()]
    best = (in_state or results)[0]
    return float(best["latitude"]), float(best["longitude"])


def locate(city: str) -> tuple[float, float]:
    """Stored coordinates win (no geocoding); otherwise the name is geocoded, then each alias."""
    stored = CITY_COORDS.get(city.lower())
    if stored:
        return stored
    for name in [city, *CITY_ALIASES.get(city.lower(), [])]:
        found = _search(name)
        if found:
            return found
    raise WeatherError(404, f"Could not find '{city}'. Try the nearest bigger city or enter weather manually.")


def _season(lat: float, lon: float, start: date, end: date, months: int) -> tuple[float, float, float] | None:
    """(mean temperature, mean humidity, rainfall per month) of one season, or None when it has no data."""
    params = {"latitude": lat, "longitude": lon, "start_date": start.isoformat(), "end_date": end.isoformat(),
              "daily": "temperature_2m_mean,precipitation_sum", "hourly": "relative_humidity_2m",
              "timezone": "auto"}
    key = get_settings().OPEN_METEO_API_KEY
    if key:
        params["apikey"] = key
    data = _get_json(_archive_url(), params)
    daily, hourly = data.get("daily") or {}, data.get("hourly") or {}
    temps = [v for v in daily.get("temperature_2m_mean") or [] if v is not None]
    rain = [v for v in daily.get("precipitation_sum") or [] if v is not None]
    hums = [v for v in hourly.get("relative_humidity_2m") or [] if v is not None]
    if not temps or not hums or not rain:
        return None
    return fmean(temps), fmean(hums), sum(rain) / months


def growing_period_weather(city: str, planting_month: int, selling_month: int,
                           today: date | None = None) -> dict:
    """{"temperature", "humidity", "rainfall"} averaged over the last 3 completed seasons."""
    city = " ".join(city.split())
    today = today or date.today()
    key = (city.lower(), planting_month, selling_month, today.isoformat())
    if key in _cache:                       # only successful results are cached, so Retry really retries
        return _cache[key]

    lat, lon = locate(city)
    months = months_in_window(planting_month, selling_month)
    windows = season_windows(planting_month, selling_month, today)
    with ThreadPoolExecutor(max_workers=SEASONS) as pool:
        seasons = [s for s in pool.map(lambda w: _season(lat, lon, w[0], w[1], months), windows) if s]
    if not seasons:
        log.warning("No usable archive data for %r (%s to %s months)", city, planting_month, selling_month)
        raise WeatherError(502, UNAVAILABLE)
    out = {"temperature": round(fmean(s[0] for s in seasons), 2),
           "humidity": round(fmean(s[1] for s in seasons), 2),
           "rainfall": round(fmean(s[2] for s in seasons), 2)}
    _cache[key] = out
    return out


def clear_cache() -> None:
    _cache.clear()
