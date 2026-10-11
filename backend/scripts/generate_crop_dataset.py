"""Stage 0: generate the Maharashtra crop-recommendation dataset (7 crops).

Run from backend/:  python -m scripts.generate_crop_dataset

Why a generated dataset
-----------------------
The previous public dataset (Crop_recommendation.csv, 22 crops) contains none of the 7 crops
this project prices, and has no location or timing columns. No public, row-level dataset links
soil tests + weather + city + planting/selling month to these crops, so this script SIMULATES
one from documented agronomic knowledge. It is a synthetic dataset and is labelled as such
everywhere it is used.

How a row is produced
---------------------
1. Pick a crop (balanced classes).
2. Pick a city, weighted by where the crop is commonly grown in Maharashtra (every city keeps
   a small base weight so no city/crop pair is impossible).
3. Pick a planting month from the crop's documented planting windows
   (crop_season_calendar.csv) and a growing duration within its harvest window; with some
   probability, storable crops are held for a few months before sale -> selling month.
4. Weather = average of the city's climatological normals over the growing months
   (city_climate_normals.csv), blended with the crop's preferred conditions (farmers grow a
   crop where/when it does well, and irrigate) plus year-to-year noise.
5. Soil N, P, K, pH = crop-specific nutrient management targets (fertiliser recommendations
   differ per crop) adjusted for the city's dominant soil (black cotton soils of Vidarbha /
   Marathwada are alkaline and K-rich; Konkan laterite and Western-Ghat soils are more
   acidic) plus field-to-field noise, truncated to the dataset bounds.

All values stay inside the ranges in app/ml/common/reference.py::FEATURE_BOUNDS.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from app.ml.common import paths
from app.ml.common.reference import CROPS, FEATURE_BOUNDS, STATE, calendar, cities, city_climate

SEED = 42
ROWS_PER_CROP = 650

# Crop-specific soil-management targets (mean, sd) and preferred growing conditions.
# Sources: typical ICAR / state agricultural university package-of-practice ranges
# (nutrient doses, optimum pH and temperature); rounded, indicative values.
PROFILES = {
    "Brinjal":     {"N": (100, 15), "P": (55, 12), "K": (55, 12), "ph": (6.5, 0.45),
                    "temperature": (27.0, 3.0), "humidity": (65, 10), "rainfall": (100, 40)},
    "Cabbage":     {"N": (115, 13), "P": (60, 12), "K": (75, 15), "ph": (6.3, 0.40),
                    "temperature": (18.5, 2.5), "humidity": (75, 8), "rainfall": (80, 30)},
    "Cauliflower": {"N": (120, 12), "P": (70, 12), "K": (60, 14), "ph": (6.4, 0.40),
                    "temperature": (20.0, 2.5), "humidity": (72, 8), "rainfall": (90, 30)},
    "Onion":       {"N": (80, 14), "P": (45, 10), "K": (85, 15), "ph": (6.8, 0.45),
                    "temperature": (23.0, 3.5), "humidity": (58, 12), "rainfall": (70, 35)},
    "Potato":      {"N": (122, 11), "P": (85, 14), "K": (140, 25), "ph": (5.6, 0.45),
                    "temperature": (18.0, 2.5), "humidity": (70, 10), "rainfall": (60, 25)},
    "Tomato":      {"N": (100, 14), "P": (75, 12), "K": (95, 18), "ph": (6.3, 0.40),
                    "temperature": (24.0, 3.0), "humidity": (65, 10), "rainfall": (95, 35)},
    "Wheat":       {"N": (90, 14), "P": (45, 10), "K": (40, 10), "ph": (7.3, 0.50),
                    "temperature": (20.0, 2.5), "humidity": (48, 10), "rainfall": (40, 18)},
}

# Relative weight of each city for each crop (major growing belts get higher weight).
CITY_WEIGHTS = {
    "Brinjal": {"Jalgaon": 3, "Nagpur": 2, "Pune": 2, "Kolhapur": 2, "Solapur": 2, "Nashik": 1,
                "Mumbai": 1, "Amravati": 1, "Satara": 1, "Chhatrapati Sambhajinagar": 1},
    "Cabbage": {"Pune": 3, "Nashik": 3, "Satara": 2, "Kolhapur": 1, "Ahilyanagar": 1,
                "Nagpur": 1, "Mumbai": 1, "Chhatrapati Sambhajinagar": 1},
    "Cauliflower": {"Pune": 3, "Nashik": 3, "Satara": 2, "Kolhapur": 1, "Ahilyanagar": 1,
                    "Nagpur": 1, "Mumbai": 1, "Jalgaon": 1},
    "Onion": {"Nashik": 5, "Ahilyanagar": 3, "Pune": 2, "Solapur": 2,
              "Chhatrapati Sambhajinagar": 2, "Satara": 1, "Jalgaon": 1},
    "Potato": {"Pune": 4, "Satara": 3, "Nashik": 1, "Ahilyanagar": 1, "Kolhapur": 1,
               "Chhatrapati Sambhajinagar": 1},
    "Tomato": {"Nashik": 4, "Pune": 3, "Ahilyanagar": 2, "Satara": 2, "Solapur": 1,
               "Kolhapur": 1, "Nagpur": 1},
    "Wheat": {"Nagpur": 3, "Amravati": 3, "Jalgaon": 3, "Chhatrapati Sambhajinagar": 2,
              "Ahilyanagar": 2, "Nashik": 2, "Solapur": 1, "Pune": 1},
}
BASE_CITY_WEIGHT = 0.3

# Dominant-soil adjustments per city: (pH shift, K shift, N shift)
CITY_SOIL = {
    "Nagpur": (0.35, 15, 0), "Amravati": (0.35, 15, 0), "Jalgaon": (0.30, 12, 0),
    "Chhatrapati Sambhajinagar": (0.30, 10, -3), "Solapur": (0.35, 12, -5),
    "Ahilyanagar": (0.25, 10, -3), "Nashik": (0.10, 5, 0), "Pune": (0.0, 0, 0),
    "Satara": (-0.20, -5, 3), "Kolhapur": (-0.30, -8, 5), "Mumbai": (-0.60, -12, 3),
}

WEATHER_BLEND = 0.55          # share of the city climate in the growing-period weather
STORAGE_PROBABILITY = {"Onion": 0.45, "Potato": 0.35, "Wheat": 0.5}


def truncated_normal(rng, mean, sd, lo, hi):
    for _ in range(100):
        v = rng.normal(mean, sd)
        if lo <= v <= hi:
            return v
    return float(np.clip(mean, lo, hi))


def soft_cap(v, lo, hi, knee=0.85):
    """Compress values approaching the upper bound instead of piling them up at it."""
    start = lo + knee * (hi - lo)
    if v > start:
        span = hi - start
        v = start + span * np.tanh((v - start) / span)
    return float(np.clip(v, lo, hi))


def growing_climate(clim: pd.DataFrame, city: str, plant: int, months: int) -> dict:
    span = [((plant - 1 + k) % 12) + 1 for k in range(months)]
    c = clim[(clim["city"] == city) & (clim["month"].isin(span))]
    return {"temperature": c["temperature_c"].mean(), "humidity": c["humidity_pct"].mean(),
            "rainfall": c["rainfall_mm"].mean()}


def make_row(rng, crop: str, clim: pd.DataFrame, city_list: list[str]) -> dict:
    cal = calendar()[crop]
    prof = PROFILES[crop]

    w = np.array([CITY_WEIGHTS[crop].get(c, 0) + BASE_CITY_WEIGHT for c in city_list], float)
    city = str(rng.choice(city_list, p=w / w.sum()))

    plant = int(rng.choice(cal.planting_months))
    grow = int(rng.integers(cal.growth_months_min, cal.growth_months_max + 1))
    stored = 0
    if cal.storable and rng.random() < STORAGE_PROBABILITY.get(crop, 0):
        stored = int(rng.integers(1, cal.max_storage_months + 1))
    sell = ((plant - 1 + grow + stored) % 12) + 1

    climate = growing_climate(clim, city, plant, grow)
    row = {"state": STATE, "city": city, "planting_month": plant, "selling_month": sell}
    noise = {"temperature": 1.6, "humidity": 6.0, "rainfall": 0.18}
    for f in ("temperature", "humidity", "rainfall"):
        lo, hi = FEATURE_BOUNDS[f]
        mean, sd = prof[f]
        v = WEATHER_BLEND * climate[f] + (1 - WEATHER_BLEND) * rng.normal(mean, sd * 0.6)
        v = v * (1 + rng.normal(0, noise[f])) if f == "rainfall" else v + rng.normal(0, noise[f])
        row[f] = round(soft_cap(max(v, lo), lo, hi), 2)

    ph_shift, k_shift, n_shift = CITY_SOIL[city]
    for f, shift in (("N", n_shift), ("P", 0), ("K", k_shift), ("ph", ph_shift)):
        lo, hi = FEATURE_BOUNDS[f]
        mean, sd = prof[f]
        v = truncated_normal(rng, mean + shift, sd, lo, hi)
        row[f] = round(v, 2) if f == "ph" else int(round(v))
    row["label"] = crop
    return row


def main() -> None:
    rng = np.random.default_rng(SEED)
    clim = city_climate()
    city_list = list(cities())
    missing = set(city_list) - set(CITY_SOIL)
    assert not missing, f"no soil profile for {missing}"

    rows = [make_row(rng, crop, clim, city_list) for crop in CROPS for _ in range(ROWS_PER_CROP)]
    df = pd.DataFrame(rows)[["N", "P", "K", "temperature", "humidity", "ph", "rainfall",
                             "state", "city", "planting_month", "selling_month", "label"]]
    df = df.sample(frac=1, random_state=SEED).reset_index(drop=True)

    for f, (lo, hi) in FEATURE_BOUNDS.items():
        assert df[f].between(lo, hi).all(), f
    paths.REC_DATASET_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(paths.REC_DATASET_PATH, index=False)

    summary = {"rows": len(df), "seed": SEED, "class_counts": df["label"].value_counts().to_dict(),
               "per_crop_means": df.groupby("label")[list(FEATURE_BOUNDS)].mean().round(1)
               .to_dict(orient="index"),
               "ranges": {f: [float(df[f].min()), float(df[f].max())] for f in FEATURE_BOUNDS}}
    paths.REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    (paths.REPORTS_DIR / "crop_dataset_summary.json").write_text(json.dumps(summary, indent=2),
                                                                 encoding="utf-8")
    print(f"wrote {len(df)} rows -> {paths.REC_DATASET_PATH}")
    print(json.dumps(summary["ranges"], indent=1))


if __name__ == "__main__":
    main()
