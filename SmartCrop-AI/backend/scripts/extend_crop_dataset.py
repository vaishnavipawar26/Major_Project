"""Build dataset/crop_recommendation/crop_dataset_extended.csv: original rows + synthetic rows that
cover the FULL input ranges of the app, including soil type.

Run from backend/:  python -m scripts.extend_crop_dataset

The original file (maharashtra_crop_recommendation.csv) is never modified. Note that the "original"
rows are themselves simulated by generate_crop_dataset.py; "original" means "the dataset the project
had before this extension". They have no soil type, so soil_type = "unknown" for them.

Columns: N, P, K, temperature, humidity, ph, rainfall, soil_type, label, source, plus
state, city, planting_month, selling_month - the model also uses location and timing, so synthetic
rows carry them too.

Synthetic rows per crop (all from truncated normal distributions, fixed seed):
  core   - inside the crop's ideal agronomic ranges (CROP_CONFIG below)
  edge   - wider spread: 1-2 inputs per row are drawn across the WHOLE app range (dry, cold, hot,
           humid, low/high nutrients), the others stay in the ideal zone
  anchor - one row at the app minimum and one at the app maximum of every input, so the dataset
           min/max equal the app's accepted range exactly
Soil type of synthetic rows: ~70 % the crop's preferred soils, ~15 % other soils, ~15 % "unknown".

THE CROP RANGES BELOW ARE AGRONOMIC ASSUMPTIONS (indicative package-of-practice style values),
NOT measurements. They must be reviewed by an agronomist before the results are relied on.
"""
from __future__ import annotations

import json
import sys

import numpy as np
import pandas as pd
from scipy.stats import truncnorm

from app.ml.common import paths
from app.ml.common.reference import CROPS, STATE, calendar, cities
from app.ml.crop_recommendation.features import SOIL_TYPES
from scripts.generate_crop_dataset import BASE_CITY_WEIGHT, CITY_WEIGHTS, STORAGE_PROBABILITY

SEED = 2025
SYNTHETIC_PER_CROP = 550
EDGE_SHARE = 0.20             # of the synthetic rows per crop
SOIL_SHARE = {"preferred": 0.70, "other": 0.15, "unknown": 0.15}
MIN_ROWS_PER_CROP = 400

# ------------------------------------------------------------------------------------------------
# The ranges the app accepts. The dataset must cover all of them (checked below).
# ------------------------------------------------------------------------------------------------
BOUNDS = {"N": (1, 140), "P": (5, 145), "K": (5, 205), "ph": (4.5, 9.0),
          "temperature": (8, 45), "humidity": (14, 100), "rainfall": (0, 300)}
NUMERIC = list(BOUNDS)
INTEGER = {"N", "P", "K"}

# ------------------------------------------------------------------------------------------------
# EDIT HERE: ideal agronomic ranges per crop (lo, hi). Core rows are truncated normals centred in the
# range (sd = width / 4). Weather depends on the season of planting: rabi = Oct-Feb (dry, cool),
# kharif = Jun-Sep (monsoon). `soils` = preferred soil types.
# ------------------------------------------------------------------------------------------------
CROP_CONFIG = {
    "Wheat": {
        "N": (70, 120), "P": (35, 60), "K": (25, 55), "ph": (6.5, 8.0),
        "temperature": {"rabi": (10, 25)}, "humidity": {"rabi": (30, 65)},
        "rainfall": {"rabi": (2, 40)}, "soils": ["loam", "clay_loam", "alluvial"]},
    "Potato": {
        "N": (100, 135), "P": (60, 110), "K": (90, 190), "ph": (4.8, 6.5),
        "temperature": {"rabi": (10, 25), "kharif": (16, 28)},
        "humidity": {"rabi": (45, 80), "kharif": (65, 90)},
        "rainfall": {"rabi": (2, 40), "kharif": (80, 220)}, "soils": ["sandy_loam", "loam"]},
    "Cabbage": {
        "N": (90, 135), "P": (40, 80), "K": (45, 105), "ph": (5.8, 7.0),
        "temperature": {"rabi": (12, 26), "kharif": (18, 30)},
        "humidity": {"rabi": (55, 85), "kharif": (70, 92)},
        "rainfall": {"rabi": (2, 45), "kharif": (80, 220)}, "soils": ["loam", "clay_loam"]},
    "Cauliflower": {
        "N": (100, 140), "P": (50, 90), "K": (35, 85), "ph": (5.8, 7.0),
        "temperature": {"rabi": (12, 27), "kharif": (20, 32)},
        "humidity": {"rabi": (55, 85), "kharif": (70, 92)},
        "rainfall": {"rabi": (2, 45), "kharif": (80, 220)}, "soils": ["loam", "sandy_loam", "clay_loam"]},
    "Onion": {
        "N": (55, 105), "P": (30, 60), "K": (55, 115), "ph": (6.0, 7.8),
        "temperature": {"rabi": (12, 32), "kharif": (20, 34)},
        "humidity": {"rabi": (35, 75), "kharif": (60, 88)},
        "rainfall": {"rabi": (1, 35), "kharif": (60, 200)}, "soils": ["loam", "sandy_loam", "alluvial"]},
    "Tomato": {
        "N": (75, 125), "P": (55, 95), "K": (65, 125), "ph": (5.8, 7.2),
        "temperature": {"rabi": (14, 32), "kharif": (20, 34)},
        "humidity": {"rabi": (45, 80), "kharif": (65, 88)},
        "rainfall": {"rabi": (2, 40), "kharif": (70, 210)}, "soils": ["loam", "sandy_loam", "clay_loam"]},
    "Brinjal": {
        "N": (75, 125), "P": (35, 75), "K": (35, 75), "ph": (5.8, 7.2),
        "temperature": {"rabi": (16, 36), "kharif": (22, 38)},
        "humidity": {"rabi": (45, 80), "kharif": (65, 90)},
        "rainfall": {"rabi": (2, 40), "kharif": (70, 210)}, "soils": ["loam", "clay_loam", "alluvial"]},
}

# Small effect of soil type on the sampled K and pH (added to the value).
SOIL_EFFECT = {"sandy_loam": {"ph": -0.25, "K": -10}, "loam": {}, "clay_loam": {"ph": 0.2, "K": 10},
               "alluvial": {"ph": 0.1, "K": 5}, "unknown": {}}
WEATHER = ("temperature", "humidity", "rainfall")


def tnorm(rng, lo, hi, mean=None, sd=None):
    mean = (lo + hi) / 2 if mean is None else mean
    sd = (hi - lo) / 4 if sd is None else sd
    return float(truncnorm.rvs((lo - mean) / sd, (hi - mean) / sd, loc=mean, scale=sd, random_state=rng))


def finish(f, v):
    lo, hi = BOUNDS[f]
    v = float(np.clip(v, lo, hi))
    return int(round(v)) if f in INTEGER else round(v, 2)


def pick_soil(rng, preferred):
    u = rng.random()
    if u < SOIL_SHARE["preferred"]:
        return str(rng.choice(preferred))
    if u < SOIL_SHARE["preferred"] + SOIL_SHARE["other"]:
        others = [s for s in SOIL_TYPES if s != "unknown" and s not in preferred]
        return str(rng.choice(others))
    return "unknown"


def timing(rng, crop, city_list):
    cal = calendar()[crop]
    w = np.array([CITY_WEIGHTS[crop].get(c, 0) + BASE_CITY_WEIGHT for c in city_list], float)
    city = str(rng.choice(city_list, p=w / w.sum()))
    plant = int(rng.choice(cal.planting_months))
    grow = int(rng.integers(cal.growth_months_min, cal.growth_months_max + 1))
    stored = 0
    if cal.storable and rng.random() < STORAGE_PROBABILITY.get(crop, 0):
        stored = int(rng.integers(1, cal.max_storage_months + 1))
    return city, plant, ((plant - 1 + grow + stored) % 12) + 1


def make_row(rng, crop, city_list, kind, anchor=None) -> dict:
    cfg = CROP_CONFIG[crop]
    city, plant, sell = timing(rng, crop, city_list)
    season = "rabi" if plant in (10, 11, 12, 1, 2) else "kharif"
    soil = pick_soil(rng, cfg["soils"])
    # which inputs leave the ideal zone in an edge row
    wide = set(rng.choice(NUMERIC, size=int(rng.integers(1, 3)), replace=False)) if kind == "edge" else set()
    row = {}
    for f in NUMERIC:
        lo, hi = cfg[f][season] if f in WEATHER else cfg[f]
        if f in wide:       # wide spread across the whole app range, centred on the ideal zone
            blo, bhi = BOUNDS[f]
            v = tnorm(rng, blo, bhi, mean=(lo + hi) / 2, sd=(bhi - blo) / 3)
        else:
            v = tnorm(rng, lo, hi)
        if f in ("K", "ph"):
            v += SOIL_EFFECT[soil].get(f, 0)
        row[f] = v
    if anchor:              # pin one input to its app minimum or maximum
        f, side = anchor
        row[f] = BOUNDS[f][side]
    row = {f: finish(f, v) for f, v in row.items()}
    return {**row, "soil_type": soil, "state": STATE, "city": city, "planting_month": plant,
            "selling_month": sell, "label": crop, "source": "synthetic"}


def coverage(df, bins=10):
    return {f: np.histogram(df[f], bins=bins, range=(lo, hi))[0].tolist() for f, (lo, hi) in BOUNDS.items()}


def run_checks(df):
    problems = []
    if df[[*NUMERIC, "soil_type", "label", "source"]].isna().any().any():
        problems.append("NaN values present")
    key = [*NUMERIC, "soil_type", "city", "planting_month", "selling_month", "label"]
    if df.duplicated(key).any():
        problems.append(f"{int(df.duplicated(key).sum())} duplicate rows")
    for f, (lo, hi) in BOUNDS.items():
        if df[f].min() < lo or df[f].max() > hi:
            problems.append(f"{f} outside {lo}-{hi}")
        if df[f].min() > lo or df[f].max() < hi:
            problems.append(f"{f} does not reach the app range {lo}-{hi} (dataset {df[f].min()}-{df[f].max()})")
    counts = df["label"].value_counts()
    if counts.min() < MIN_ROWS_PER_CROP:
        problems.append(f"a crop has only {counts.min()} rows (< {MIN_ROWS_PER_CROP})")
    if counts.max() != counts.min():
        problems.append(f"classes not balanced: {counts.to_dict()}")
    cov = coverage(df)
    for f, c in cov.items():
        if 0 in c:
            problems.append(f"{f}: empty bin(s) in 10-bin coverage {c}")
    for crop, g in df.groupby("label"):
        missing = set(SOIL_TYPES) - set(g["soil_type"])
        if missing:
            problems.append(f"{crop}: soil types never used: {sorted(missing)}")
    return problems, cov


def main() -> None:
    rng = np.random.default_rng(SEED)
    city_list = list(cities())

    orig = pd.read_csv(paths.REC_DATASET_PATH)
    print("== existing dataset ==")
    print(orig[NUMERIC].agg(["min", "max", "mean"]).round(2).T.to_string())
    print(orig["label"].value_counts().to_string(), "\n")
    orig["source"], orig["soil_type"] = "original", "unknown"
    clipped = {f: int(((orig[f] < lo) | (orig[f] > hi)).sum()) for f, (lo, hi) in BOUNDS.items()}
    for f, (lo, hi) in BOUNDS.items():
        orig[f] = orig[f].clip(lo, hi)

    anchors = [(f, side) for f in NUMERIC for side in (0, 1)]
    n_edge = int(SYNTHETIC_PER_CROP * EDGE_SHARE)
    n_core = SYNTHETIC_PER_CROP - n_edge - len(anchors)
    rows = []
    for crop in CROPS:
        rows += [make_row(rng, crop, city_list, "edge") for _ in range(n_edge + 20)]       # +20 spare for de-dup
        rows += [make_row(rng, crop, city_list, "anchor", a) for a in anchors]
        rows += [make_row(rng, crop, city_list, "core") for _ in range(n_core + 20)]
    synth = pd.DataFrame(rows)

    key = [*NUMERIC, "soil_type", "city", "planting_month", "selling_month", "label"]
    orig = orig.drop_duplicates(key)
    synth = synth.drop_duplicates(key)
    synth = synth.merge(orig[key], on=key, how="left", indicator=True)
    synth = synth[synth["_merge"] == "left_only"].drop(columns="_merge")

    # exactly SYNTHETIC_PER_CROP per crop; rows at an input's min/max (the anchors) are always kept
    parts = []
    for _, g in synth.groupby("label"):
        at_edge = np.zeros(len(g), bool)
        for f, (lo, hi) in BOUNDS.items():
            at_edge |= (g[f] == lo).to_numpy() | (g[f] == hi).to_numpy()
        parts.append(pd.concat([g[at_edge], g[~at_edge].sample(frac=1, random_state=SEED)]).head(SYNTHETIC_PER_CROP))
    synth = pd.concat(parts)

    cols = [*NUMERIC, "soil_type", "state", "city", "planting_month", "selling_month", "label", "source"]
    df = pd.concat([orig, synth], ignore_index=True)[cols]
    n = int(df["label"].value_counts().min())       # originals can lose a row to de-duplication
    df = pd.concat([pd.concat([g[g.source == "original"], g[g.source == "synthetic"]]).head(n)
                    for _, g in df.groupby("label")])
    df = df.sample(frac=1, random_state=SEED).reset_index(drop=True)

    problems, cov = run_checks(df)

    print("== quality report ==")
    print(f"rows {len(df)}  sources {df['source'].value_counts().to_dict()}")
    print(f"original values clipped to the app ranges: {({k: v for k, v in clipped.items() if v}) or 'none'}")
    print("\ncoverage: rows per bin (10 equal-width bins over the app range)")
    for f, c in cov.items():
        print(f"  {f:<12}{BOUNDS[f]}  {c}")
    print("\nsoil_type rows per crop")
    print(pd.crosstab(df["label"], df["soil_type"])[SOIL_TYPES].to_string())
    print("\nper-crop min/max")
    pc = df.groupby("label")[NUMERIC].agg(["min", "max"]).round(1)
    print(pc.to_string())
    print("\nrows with rainfall <= 50 mm per crop:", df[df.rainfall <= 50].groupby("label").size().to_dict())

    if problems:
        print("\nQUALITY CHECKS FAILED:\n  - " + "\n  - ".join(problems), file=sys.stderr)
        raise SystemExit(1)
    print("\nall quality checks passed")

    paths.REC_EXTENDED_DATASET_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(paths.REC_EXTENDED_DATASET_PATH, index=False)
    summary = {"rows": len(df), "seed": SEED, "source_counts": df["source"].value_counts().to_dict(),
               "class_counts": df["label"].value_counts().to_dict(),
               "soil_type_counts": df["soil_type"].value_counts().to_dict(),
               "original_values_clipped": clipped, "bounds": BOUNDS, "coverage_10_bins": cov,
               "per_crop_min_max": {c: {f: [float(pc.loc[c, (f, "min")]), float(pc.loc[c, (f, "max")])]
                                        for f in NUMERIC} for c in pc.index}}
    (paths.REPORTS_DIR / "crop_dataset_extended_summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8")
    print(f"wrote {paths.REC_EXTENDED_DATASET_PATH}")


if __name__ == "__main__":
    main()
