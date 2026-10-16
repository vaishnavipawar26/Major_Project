"""Reference tables for the 7 supported crops and the Maharashtra cities.

Shared by the dataset generator, the training scripts and the API so the crop list, the
cropping calendar and the city list are defined in exactly one place (the CSV files in
dataset/crop_recommendation/).
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import pandas as pd

from app.ml.common import paths

STATE = "Maharashtra"
CROPS = ("Brinjal", "Cabbage", "Cauliflower", "Onion", "Potato", "Tomato", "Wheat")

# Input ranges of the crop-recommendation dataset (also the generator's hard bounds).
FEATURE_BOUNDS = {
    "N": (0.0, 140.0), "P": (5.0, 145.0), "K": (5.0, 205.0), "ph": (3.5, 9.9),
    "temperature": (8.8, 43.7), "humidity": (14.0, 100.0), "rainfall": (20.0, 299.0),
}


@dataclass(frozen=True)
class CropCalendar:
    crop: str
    planting_months: tuple[int, ...]
    growth_months_min: int
    growth_months_max: int
    max_storage_months: int
    storable: bool
    notes: str


@dataclass(frozen=True)
class CropEconomics:
    crop: str
    yield_q_per_acre: float
    cost_per_acre_inr: float
    cost_reference_year: int
    post_harvest_loss_pct: float
    storage_loss_pct_per_month: float
    storage_cost_per_q_month: float
    marketing_cost_pct: float


@lru_cache(maxsize=1)
def calendar() -> dict[str, CropCalendar]:
    df = pd.read_csv(paths.CROP_SEASON_PATH)
    return {r.crop: CropCalendar(r.crop, tuple(int(m) for m in str(r.planting_months).split(";")),
                                 int(r.growth_months_min), int(r.growth_months_max),
                                 int(r.max_storage_months), bool(r.storable),
                                 "" if pd.isna(r.notes) else str(r.notes))
            for r in df.itertuples()}


@lru_cache(maxsize=1)
def economics() -> dict[str, CropEconomics]:
    df = pd.read_csv(paths.CROP_ECONOMICS_PATH)
    return {r.crop: CropEconomics(r.crop, float(r.yield_q_per_acre), float(r.cost_per_acre_inr),
                                  int(r.cost_reference_year), float(r.post_harvest_loss_pct),
                                  float(r.storage_loss_pct_per_month),
                                  float(r.storage_cost_per_q_month), float(r.marketing_cost_pct))
            for r in df.itertuples()}


@lru_cache(maxsize=1)
def city_climate() -> pd.DataFrame:
    return pd.read_csv(paths.CITY_CLIMATE_PATH)


@lru_cache(maxsize=1)
def cities() -> tuple[str, ...]:
    return tuple(sorted(city_climate()["city"].unique()))


@lru_cache(maxsize=1)
def city_markets() -> dict[str, list[str]]:
    df = pd.read_csv(paths.CITY_MARKET_MAP_PATH)
    return df.groupby("city")["market"].apply(list).to_dict()


@lru_cache(maxsize=1)
def city_coordinates() -> dict[tuple[str, str], tuple[float, float]]:
    """(state, city) lower-cased -> (latitude, longitude), for the weather lookup (no geocoding needed)."""
    df = pd.read_csv(paths.CITY_COORDS_PATH)
    return {(r.state.lower(), r.city.lower()): (float(r.latitude), float(r.longitude)) for r in df.itertuples()}


def months_between(start_month: int, end_month: int) -> int:
    """Whole months from start_month to the NEXT occurrence of end_month (1..12)."""
    d = (end_month - start_month) % 12
    return 12 if d == 0 else d


def add_months(year: int, month: int, k: int) -> tuple[int, int]:
    idx = year * 12 + (month - 1) + k
    return idx // 12, idx % 12 + 1


def month_label(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"
