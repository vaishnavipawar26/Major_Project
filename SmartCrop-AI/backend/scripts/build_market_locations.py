"""Map every mandi (market) in the price data to a latitude/longitude.

Run from backend/:  python -m scripts.build_market_locations

Method (documented, reproducible, no hand-typed coordinates):
  1. Reduce the market name to a town name ("APMC Rahata" -> "Rahata",
     "Pune(Manjri)" -> "Pune", "Amrawati(Frui & Veg. Market)" -> "Amravati").
  2. Query the Open-Meteo Geocoding API (GeoNames) for that name, restricted to India.
  3. Accept a result only if it lies in Maharashtra and is a town (population >= 10,000). If several such towns share the
     name and are more than AMBIGUOUS_KM apart, the market is left UNMAPPED ("ambiguous")
     instead of guessing. Unmapped markets simply get no weather features.
  4. Cross-check against dataset/crop_recommendation/city_coordinates.csv where both exist.

Output: dataset/crop_price/market_locations.csv with provenance columns
(query, matched name, admin1, source, retrieved_at, status).
"""
from __future__ import annotations

import math
import re
import time
from datetime import datetime, timezone

from scripts._http import make_client
import pandas as pd

from app.ml.common import paths

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
AMBIGUOUS_KM = 40.0
MIN_POPULATION = 10_000  # same-named villages are ignored; a mandi sits in a town
# spelling used in the Agmarknet file -> spelling used by GeoNames (only where they differ)
ALIASES = {"amrawati": "Amravati", "amarawati": "Amravati", "nasik": "Nashik",
           "chattrapati sambhajinagar": "Aurangabad", "chhatrapati sambhajinagar": "Aurangabad",
           "sambhajinagar": "Aurangabad", "ahilyanagar": "Ahmadnagar", "ahmednagar": "Ahmadnagar", "dharashiv": "Osmanabad",
           "jalana": "Jalna", "sinner": "Sinnar", "kalvan": "Kalwan", "vaijpur": "Vaijapur",
           "mangal wedha": "Mangalvedhe", "pimpalgaon baswant": "Pimpalgaon",
           "bhusaval": "Bhusawal", "bhivandi": "Bhiwandi", "kamthi": "Kamptee",
           "shrirampur": "Shrirampur", "rahata": "Rahata", "khed(chakan)": "Chakan"}


def town_name(market: str) -> str:
    base = re.sub(r"^(APMC|A\.P\.M\.C\.?)\s+", "", market.strip(), flags=re.I)
    low = base.lower()
    if low in ALIASES:
        return ALIASES[low]
    base = re.sub(r"\(.*?\)", "", base).strip()
    return ALIASES.get(base.lower(), base.title() if base.isupper() else base)


def km(a: tuple[float, float], b: tuple[float, float]) -> float:
    (la1, lo1), (la2, lo2) = a, b
    p = math.pi / 180
    h = (math.sin((la2 - la1) * p / 2) ** 2
         + math.cos(la1 * p) * math.cos(la2 * p) * math.sin((lo2 - lo1) * p / 2) ** 2)
    return 12742 * math.asin(math.sqrt(h))


def geocode(client, name: str) -> list[dict]:
    for attempt in range(4):
        r = client.get(GEOCODE_URL, params={"name": name, "count": 10, "language": "en",
                                            "format": "json", "countryCode": "IN"})
        if r.status_code == 200:
            return [x for x in (r.json().get("results") or [])
                    if x.get("admin1") == "Maharashtra" and (x.get("population") or 0) >= MIN_POPULATION]
        time.sleep(2 ** attempt)
    raise RuntimeError(f"geocoding failed for {name!r} (HTTP {r.status_code})")


def main() -> None:
    clean = pd.read_parquet(paths.PRICE_CLEAN_PATH, columns=["Market"])
    markets = sorted(clean["Market"].astype(str).unique())
    known = pd.read_csv(paths.CITY_COORDS_PATH)
    known = {c.lower(): (la, lo) for c, la, lo in zip(known["city"], known["latitude"], known["longitude"])}
    rows, cache = [], {}
    with make_client(20.0) as client:
        for m in markets:
            q = town_name(m)
            if q not in cache:
                cache[q] = geocode(client, q)
                time.sleep(0.15)
            hits = cache[q]
            row = {"market": m, "query": q, "matched_name": None, "admin1": None,
                   "latitude": None, "longitude": None, "status": "not_found",
                   "ambiguous_spread_km": None, "crosscheck_km": None,
                   "source": "open-meteo geocoding (GeoNames)",
                   "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
            if hits:
                pts = [(h["latitude"], h["longitude"]) for h in hits]
                spread = max(km(pts[0], p) for p in pts)
                row["ambiguous_spread_km"] = round(spread, 1)
                if spread > AMBIGUOUS_KM:
                    row["status"] = "ambiguous"
                else:
                    h = hits[0]
                    row.update(matched_name=h["name"], admin1=h["admin1"], latitude=h["latitude"],
                               longitude=h["longitude"], status="mapped")
                    if q.lower() in known:
                        row["crosscheck_km"] = round(km(pts[0], known[q.lower()]), 1)
            rows.append(row)
    out = pd.DataFrame(rows)
    out.to_csv(paths.CROP_PRICE_DIR / "market_locations.csv", index=False)
    print(out["status"].value_counts().to_string())
    cc = out["crosscheck_km"].dropna()
    print(f"cross-check vs city_coordinates.csv: n={len(cc)} max={cc.max() if len(cc) else None} km")
    print(out[out["status"] != "mapped"][["market", "query", "status"]].to_string(index=False))


if __name__ == "__main__":
    main()
