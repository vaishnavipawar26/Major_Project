"""Soil features for the price forecaster (pure functions, no network).

Soil is looked up for the SELLING MARKET's town only (the training data has prices per market and no growing location). The values are
regional soil-map estimates (SoilGrids), never measurements, and they do not change over time, so they can only describe the market, not
a season. The table is built by ``scripts.build_market_soil`` into dataset/soil/market_soil.csv; where it has no value for a market the
feature is NaN (never an average, never a default pH) and the tree models handle NaN natively.

Features:
  soil_ph          regional estimate of topsoil pH (water) at the market's town            (pH units)
  soil_class_code  integer code of the soil group, codes fixed by the sorted class names in the table  (category; NaN if unknown)
"""
from __future__ import annotations

import numpy as np
import pandas as pd

SOIL_FEATURES = ["soil_ph", "soil_class_code"]


def load(path) -> pd.DataFrame | None:
    """The per-market soil table (columns market, soil_ph, soil_class), or None when it has not been built."""
    try:
        df = pd.read_csv(path)
    except FileNotFoundError:
        return None
    return df if {"market", "soil_ph", "soil_class"} <= set(df.columns) else None


def class_codes(table: pd.DataFrame) -> dict[str, int]:
    return {c: i for i, c in enumerate(sorted(table["soil_class"].dropna().unique()))}


def attach(df: pd.DataFrame, table: pd.DataFrame | None) -> pd.DataFrame:
    """Add SOIL_FEATURES to a frame with a ``Market`` column. A market with no soil value, and every column when ``table`` is None, is NaN."""
    out = df.copy()
    if table is None or table.empty:
        for c in SOIL_FEATURES:
            out[c] = np.float32(np.nan)
        return out
    codes = class_codes(table)
    t = table.drop_duplicates("market").set_index("market")
    out["soil_ph"] = out["Market"].map(t["soil_ph"]).astype("float32")
    out["soil_class_code"] = out["Market"].map(t["soil_class"].map(codes)).astype("float32")
    return out
