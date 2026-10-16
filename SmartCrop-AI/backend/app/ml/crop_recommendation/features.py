"""Feature construction for the crop classifier — identical in training and serving."""
from __future__ import annotations

import numpy as np
import pandas as pd

from app.ml.common.reference import months_between

NUMERIC_INPUTS = ["N", "P", "K", "temperature", "humidity", "ph", "rainfall"]
# Soil type is categorical (one-hot encoded inside the model pipeline). "unknown" = skipped / not sure.
SOIL_TYPES = ["sandy_loam", "loam", "clay_loam", "alluvial", "unknown"]
SOIL_LABELS = {"sandy_loam": "Sandy loam", "loam": "Loam", "clay_loam": "Clay loam",
               "alluvial": "Alluvial", "unknown": "Not specified"}
FEATURES = [*NUMERIC_INPUTS, "soil_type", "city_code", "planting_month", "selling_month", "growing_months"]

FEATURE_GROUPS = {
    "N": "soil", "P": "soil", "K": "soil", "ph": "soil", "soil_type": "soil",
    "temperature": "weather", "humidity": "weather", "rainfall": "weather",
    "city_code": "location",
    "planting_month": "timing", "selling_month": "timing", "growing_months": "timing",
}
GROUP_LABELS = {"soil": "Soil health", "weather": "Weather compatibility",
                "timing": "Planting & selling timing", "location": "Location (city)"}


def build_features(df: pd.DataFrame, cities: list[str]) -> pd.DataFrame:
    """``df`` needs the 7 numeric inputs plus city, planting_month and selling_month."""
    codes = {c: i for i, c in enumerate(cities)}
    X = df[NUMERIC_INPUTS].astype(float).copy()
    X["soil_type"] = (df["soil_type"] if "soil_type" in df else pd.Series("unknown", index=df.index)
                      ).fillna("unknown").astype(str)
    X["city_code"] = df["city"].map(codes).astype(float)
    X["planting_month"] = df["planting_month"].astype(float)
    X["selling_month"] = df["selling_month"].astype(float)
    X["growing_months"] = [float(months_between(int(p), int(s)))
                           for p, s in zip(df["planting_month"], df["selling_month"])]
    return X[FEATURES]


def collapse_shap(sv: np.ndarray, columns: list[str]) -> np.ndarray:
    """SHAP values over the pipeline's columns (soil_type is one-hot encoded: ``soil_type_loam`` ...)
    -> values per original feature in ``FEATURES`` order, summing the one-hot columns of soil_type.
    ``columns`` indexes axis -2 of ``sv`` (``(..., columns, classes)``)."""
    out = []
    for f in FEATURES:
        idx = [i for i, c in enumerate(columns) if c == f or (f == "soil_type" and c.startswith("soil_type_"))]
        out.append(np.take(sv, idx, axis=-2).sum(axis=-2))
    return np.stack(out, axis=-2)


_SOIL_ALIASES = {"alluvial_soil": "alluvial", "not_sure": "unknown", "not_sure_skip": "unknown",
                 "skip": "unknown", "none": "unknown", "other": "unknown"}


def normalize_soil_type(value) -> str:
    """Map UI text ("Sandy loam", "Alluvial soil", "Not sure / skip", empty ...) to a SOIL_TYPES value.
    Missing / skipped -> "unknown". Anything unrecognised is returned as-is (the API then rejects it)."""
    if value is None:
        return "unknown"
    v = "_".join(str(value).strip().lower().replace("/", " ").replace("-", " ").split())
    return _SOIL_ALIASES.get(v, v or "unknown")
