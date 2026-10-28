"""Growing-location search for the price form: a village, town or district typed by the farmer ("Nashik, Maharashtra, India") resolved to
coordinates with the Open-Meteo geocoding service (GeoNames places). The farmer picks one of the returned places, so the coordinates used for
weather and soil are always a real, named place that the farmer has seen; nothing is guessed from the selling market.

Typed text is split at commas: the first part is the place name, the rest (district, state, country) must each match the place's district,
state or country. Without a country, or with "India", only places in India are searched (the price data covers Maharashtra).
Requests go through app/services/http_client.py (OS certificates, retries, back-off). Successful answers are kept in memory for a while.

Popular places: the project's own Maharashtra cities (dataset/crop_recommendation/city_coordinates.csv, the coordinates the crop-weather
feature already uses) are offered before anything is typed, and come first in every search they match. They need no network call, so they
also work while the geocoding service is down, and they include renamed cities GeoNames does not know (Ahilyanagar, formerly Ahmednagar).
"""
from __future__ import annotations

import time
from functools import lru_cache

import pandas as pd

from app.ml.common import paths
from app.services.http_client import get_json

SEARCH_URL = "https://geocoding-api.open-meteo.com/v1/search"
SOURCE = "Open-Meteo geocoding (GeoNames)"
CITY_SOURCE = "SmartCrop AI city list (verified coordinates)"
# shown first, in this order; the rest of the city list follows alphabetically
POPULAR_FIRST = ("Nashik", "Pune", "Nagpur", "Mumbai", "Ahilyanagar", "Satara", "Dharashiv")
# former names of renamed cities, so a farmer typing the old name still finds the place
FORMER_NAMES = {"ahmednagar": "Ahilyanagar", "ahmadnagar": "Ahilyanagar", "osmanabad": "Dharashiv",
                "aurangabad": "Chhatrapati Sambhajinagar"}
TIMEOUT = 6.0
MAX_RESULTS = 8
CACHE_SECONDS = 24 * 3600
_cache: dict[str, tuple[float, list[dict]]] = {}


def _norm(s: str) -> str:
    return " ".join(str(s or "").lower().split())


def label(p: dict) -> str:
    """"Name, District, State, Country", leaving out parts that repeat the one before (Nashik, Nashik, ... -> Nashik, ...)."""
    parts = []
    for v in (p.get("name"), p.get("admin2"), p.get("admin1"), p.get("country")):
        if v and (not parts or _norm(v) != _norm(parts[-1])):
            parts.append(str(v))
    return ", ".join(parts)[:100]


def _place(r: dict) -> dict:
    p = {"name": r.get("name"), "district": r.get("admin2"), "state": r.get("admin1"), "country": r.get("country"),
         "latitude": round(float(r["latitude"]), 4), "longitude": round(float(r["longitude"]), 4), "source": SOURCE}
    return {**p, "label": label({"name": p["name"], "admin2": p["district"], "admin1": p["state"], "country": p["country"]})}


@lru_cache(maxsize=1)
def popular() -> list[dict]:
    """The project's Maharashtra cities as places, POPULAR_FIRST in that order, then the others alphabetically."""
    df = pd.read_csv(paths.CITY_COORDS_PATH)
    rows = [(str(r.city), float(r.latitude), float(r.longitude)) for r in df.itertuples() if str(r.state).lower() == "maharashtra"]
    order = {c: i for i, c in enumerate(POPULAR_FIRST)}
    rows.sort(key=lambda r: (order.get(r[0], len(order)), r[0]))
    return [{"name": c, "district": None, "state": "Maharashtra", "country": "India", "latitude": round(lat, 4), "longitude": round(lon, 4),
             "source": CITY_SOURCE, "label": f"{c}, Maharashtra, India", "popular": True} for c, lat, lon in rows]


def _city_matches(name: str, qualifiers: list[str]) -> list[dict]:
    """Popular places whose name (or former name) starts with the typed name, if the qualifiers fit Maharashtra, India."""
    if any(not any(h.startswith(q) for h in ("maharashtra", "india", "in", "bharat")) for q in qualifiers):
        return []
    n = _norm(name)
    renamed = {v for k, v in FORMER_NAMES.items() if k.startswith(n)}
    return [p for p in popular() if _norm(p["name"]).startswith(n) or p["name"] in renamed]


def search(text: str) -> tuple[list[dict], str | None]:
    """Places matching the typed text, best first, or ([], reason). reason is None when the search worked (an empty list then means no
    place matched), 'too_short' for less than 2 letters, or the http_client reason when the service could not be reached and no popular
    place matched either."""
    parts = [p.strip() for p in str(text or "").split(",") if p.strip()]
    if not parts or len(parts[0]) < 2:
        return [], "too_short"
    name, qualifiers = parts[0], [_norm(q) for q in parts[1:]]
    key = "|".join([_norm(name), *qualifiers])
    hit = _cache.get(key)
    if hit and hit[0] > time.monotonic():
        return hit[1], None
    cities = _city_matches(name, qualifiers)

    params = {"name": name, "count": 20, "language": "en", "format": "json"}
    if not qualifiers or qualifiers[-1] in ("india", "in", "bharat"):
        params["countryCode"] = "IN"
    data, err = get_json(SEARCH_URL, params, TIMEOUT)
    if err:
        return (cities, None) if cities else ([], err)    # the city list still answers while the service is down (not cached)
    rows = data.get("results") or [] if isinstance(data, dict) else []

    def matches(r: dict) -> bool:
        have = [_norm(r.get(k)) for k in ("admin1", "admin2", "admin3", "admin4", "country", "country_code")]
        return all(any(q == h or (len(q) >= 3 and h.startswith(q)) for h in have if h) for q in qualifiers)

    # the project's verified city first; a GeoNames place with the same label is the same city and is not listed twice
    places, seen = list(cities[:MAX_RESULTS]), {p["label"] for p in cities}
    for r in rows:
        if len(places) >= MAX_RESULTS:
            break
        if r.get("latitude") is None or r.get("longitude") is None or not matches(r):
            continue
        p = _place(r)
        if p["label"] in seen:
            continue
        seen.add(p["label"])
        places.append(p)
    _cache[key] = (time.monotonic() + CACHE_SECONDS, places)
    return places, None


def resolve(text: str) -> tuple[dict | None, str | None]:
    """The single best place for a saved label (used when an older request carries the label but not its coordinates), or (None, reason):
    'not_found', 'too_short' or a service reason."""
    places, err = search(text)
    if err:
        return None, err
    if not places:
        return None, "not_found"
    exact = [p for p in places if _norm(p["label"]) == _norm(text)]
    return (exact or places)[0], None
