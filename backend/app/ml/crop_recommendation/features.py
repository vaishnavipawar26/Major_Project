"""Feature construction for the crop classifier — identical in training and serving."""
from __future__ import annotations

import pandas as pd

from app.ml.common.reference import months_between

NUMERIC_INPUTS = ["N", "P", "K", "temperature", "humidity", "ph", "rainfall"]
FEATURES = [*NUMERIC_INPUTS, "city_code", "planting_month", "selling_month", "growing_months"]

FEATURE_GROUPS = {
    "N": "soil", "P": "soil", "K": "soil", "ph": "soil",
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
    X["city_code"] = df["city"].map(codes).astype(float)
    X["planting_month"] = df["planting_month"].astype(float)
    X["selling_month"] = df["selling_month"].astype(float)
    X["growing_months"] = [float(months_between(int(p), int(s)))
                           for p, s in zip(df["planting_month"], df["selling_month"])]
    return X[FEATURES]
