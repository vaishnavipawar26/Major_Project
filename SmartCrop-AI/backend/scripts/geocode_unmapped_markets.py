"""Second geocoding pass for the markets that build_market_locations.py could not place.

Run from backend/:  python -m scripts.geocode_unmapped_markets

Why: the first pass looks each market's town name up exactly as the price file spells it, but GeoNames often spells Marathi town names
differently (Akkalkot / Akalkot, Ambejogai / Ambajogai ...), so about 30% of the markets the form offers had no coordinates and could never
show weather or soil. This pass tries a bounded set of spelling variants, and accepts a result only if ALL of these hold:
  * it lies in Maharashtra and is a town (population >= MIN_POPULATION), exactly as in the first pass;
  * every accepted variant points at the same place (within AMBIGUOUS_KM), otherwise the market stays unmapped ("ambiguous");
  * the place is not already the place of a DIFFERENT, already mapped town. A one-letter spelling change that lands on another real town
    (Akole -> Akola) would silently give a market the wrong weather, so such matches are rejected.
Before the spelling variants, a market whose town is one of the project's own cities (dataset/crop_recommendation/city_coordinates.csv,
the coordinates the crop-weather feature already uses) takes those coordinates. GeoNames has no entry at all for some renamed cities
(Ahilyanagar, formerly Ahmednagar), so no spelling could ever find them.
Nothing is guessed: unmapped markets simply stay unmapped.

Output: dataset/crop_price/market_locations_extra.csv (the original market_locations.csv is never modified), with the variant that matched,
so every row can be reviewed.
"""
from __future__ import annotations

import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import pandas as pd

from app.ml.common import paths
from scripts._http import make_client
from scripts.build_market_locations import AMBIGUOUS_KM, GEOCODE_URL, MIN_POPULATION, km, town_name

# Rejected after manual review of the automatic matches (2026-10-28). A rerun keeps them rejected, so the output is reproducible.
REVIEW_REJECT = {
    "APMC Manora": "matched Manor (Palghar district); Manora is a different town in Washim district",
    "APMC Vani": "ambiguous: Wani (Yavatmal) and Vani (Dindori, Nashik) are both market towns",
}

# one-step spelling changes that are common between Marathi town names and their GeoNames spellings
SWAPS = [("kk", "k"), ("k", "kk"), ("ai", "ay"), ("ai", "e"), ("ee", "i"), ("i", "ee"), ("oo", "u"), ("u", "oo"), ("aa", "a"), ("a", "aa"),
         ("sh", "s"), ("s", "sh"), ("v", "w"), ("w", "v"), ("j", "g"), ("g", "j"), ("th", "t"), ("t", "th"), ("dh", "d"), ("d", "dh"),
         ("bh", "b"), ("b", "bh"), ("ph", "p"), ("p", "ph"), ("kh", "k"), ("k", "kh"), ("ch", "c"), ("y", "i"), ("i", "y"), ("e", "i"),
         ("i", "e"), ("o", "a"), ("a", "o"), ("u", "o"), ("o", "u"), ("ed", "ad"), ("ad", "ed"), ("ah", "a"), ("n", "nn"), ("nn", "n")]


def variants(name: str) -> list[str]:
    low = name.lower()
    out: list[str] = []
    for a, b in SWAPS:
        start = 0
        while True:
            i = low.find(a, start)
            if i < 0:
                break
            out.append((low[:i] + b + low[i + len(a):]).title())
            start = i + 1
    if low.endswith("a"):
        out.append(low[:-1].title())
    else:
        out.append((low + "a").title())
    seen, uniq = {low}, []
    for v in out:
        if v.lower() not in seen:
            seen.add(v.lower())
            uniq.append(v)
    return uniq[:40]


def lookup(client, name: str) -> list[dict]:
    for attempt in range(3):
        try:
            r = client.get(GEOCODE_URL, params={"name": name, "count": 10, "country_code": "IN", "language": "en"})
            r.raise_for_status()
            return [x for x in (r.json().get("results") or [])
                    if x.get("admin1") == "Maharashtra" and (x.get("population") or 0) >= MIN_POPULATION]
        except Exception:
            time.sleep(0.5 * (attempt + 1))
    return []


def main() -> None:
    base = pd.read_csv(paths.CROP_PRICE_DIR / "market_locations.csv")
    mapped = base[base["status"] == "mapped"]
    owners = {(round(r.latitude, 3), round(r.longitude, 3)): str(r.query).lower() for r in mapped.itertuples()}   # place -> the town name that owns it
    todo = base[base["status"] != "mapped"]
    cities = pd.read_csv(paths.CROP_REC_DIR / "city_coordinates.csv")
    city_xy = {c.lower(): (c, la, lo) for c, la, lo in zip(cities["city"], cities["latitude"], cities["longitude"])}
    print(f"{len(todo)} markets to retry; {len(mapped)} already mapped")
    rows = []
    with make_client(20.0) as client, ThreadPoolExecutor(max_workers=5) as pool:
        for r in todo.itertuples():
            town = town_name(r.market)
            raw = re.sub(r"^(APMC|A\.P\.M\.C\.?)\s+", "", r.market.strip(), flags=re.I).split("(")[0].strip().lower()
            known = city_xy.get(raw) or city_xy.get(town.lower())
            if known:                     # the market's town is one of the project's own cities: use those documented coordinates
                rows.append({"market": r.market, "query": known[0], "matched_name": known[0], "admin1": "Maharashtra",
                             "latitude": known[1], "longitude": known[2], "status": "mapped", "variant": None,
                             "source": "project city_coordinates.csv", "review_note": None})
                print(f"  {r.market:26s} -> {known[0]} (project city coordinates)")
                continue
            vs = variants(town)
            hits = []
            for v, res in zip(vs, pool.map(lambda v: lookup(client, v), vs)):
                for h in res:
                    hits.append((v, h))
            if not hits:
                continue
            pts = {(round(h["latitude"], 3), round(h["longitude"], 3)): (v, h) for v, h in hits}
            keys = list(pts)
            if max(km(a, b) for a in keys for b in keys) > AMBIGUOUS_KM:
                rows.append({"market": r.market, "query": town, "matched_name": None, "admin1": None, "latitude": None, "longitude": None,
                             "status": "ambiguous", "variant": None, "source": "open-meteo geocoding (variant pass)"})
                continue
            best_key = max(keys, key=lambda k: pts[k][1].get("population") or 0)
            v, h = pts[best_key]
            owner = owners.get(best_key)
            if owner is not None and owner != town.lower():      # lands on a different, already mapped town: reject
                continue
            rejected = REVIEW_REJECT.get(r.market)
            rows.append({"market": r.market, "query": town, "matched_name": h["name"], "admin1": h["admin1"], "latitude": h["latitude"],
                         "longitude": h["longitude"], "status": "rejected" if rejected else "mapped", "variant": v,
                         "source": "open-meteo geocoding (variant pass)", "review_note": rejected})
            print(f"  {r.market:26s} -> {h['name']} ({v})")
    out = pd.DataFrame(rows)
    out["retrieved_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    out.to_csv(paths.CROP_PRICE_DIR / "market_locations_extra.csv", index=False)
    print(f"mapped {int((out['status'] == 'mapped').sum())} more markets; {int((out['status'] == 'ambiguous').sum())} ambiguous and "
          f"{int((out['status'] == 'rejected').sum())} rejected on review (left unmapped)")


if __name__ == "__main__":
    main()
