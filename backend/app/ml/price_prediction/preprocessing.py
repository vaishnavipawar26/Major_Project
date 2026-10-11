"""Cleaning of raw mandi price files.

Every step records how many rows it touched so the data-quality report can show
exactly what happened; nothing is dropped silently.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

REQUIRED_COLUMNS = ["Date", "State", "Market", "Commodity", "Variety",
                    "Arrivals", "Min_Price", "Max_Price", "Modal_Price"]
SERIES_KEY = ["State", "Market", "Commodity", "Variety"]
DAY_KEY = ["Date", *SERIES_KEY]

# Outlier rule: a modal price more than OUTLIER_RATIO times above (or below 1/ratio of)
# the median of the same series' previous OUTLIER_WINDOW observations is treated as a
# probable data-entry error and capped to that bound. The window only looks backwards,
# so the same rule could be applied to live data. Gradual real shocks (e.g. the
# mid-2023 tomato spike) move the trailing median with them and are not capped.
OUTLIER_RATIO = 4.0
OUTLIER_WINDOW = 15
OUTLIER_MIN_PERIODS = 5


@dataclass
class CleaningLog:
    steps: list[dict] = field(default_factory=list)

    def add(self, step: str, rows_affected: int, rows_after: int, note: str) -> None:
        self.steps.append({"step": step, "rows_affected": int(rows_affected),
                           "rows_after": int(rows_after), "note": note})


def find_price_files(raw_dir: Path) -> list[Path]:
    """All CSVs in raw/ whose header matches the mandi price schema."""
    files = []
    for path in sorted(raw_dir.glob("*.csv")):
        header = pd.read_csv(path, nrows=0).columns.str.strip().tolist()
        if all(c in header for c in REQUIRED_COLUMNS):
            files.append(path)
    return files


def load_raw(files: list[Path]) -> pd.DataFrame:
    frames = []
    for path in files:
        df = pd.read_csv(path)
        df.columns = df.columns.str.strip()
        df = df[REQUIRED_COLUMNS].copy()
        df["source_file"] = path.name
        frames.append(df)
    return pd.concat(frames, ignore_index=True)


def clean_prices(raw: pd.DataFrame) -> tuple[pd.DataFrame, CleaningLog]:
    log = CleaningLog()
    df = raw.copy()
    log.add("load", 0, len(df), "Rows read from raw price files")

    for col in ["State", "Market", "Commodity", "Variety"]:
        df[col] = df[col].astype("string").str.strip().str.replace(r"\s+", " ", regex=True)
    df["Commodity"] = df["Commodity"].str.title()

    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    for col in ["Arrivals", "Min_Price", "Max_Price", "Modal_Price"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    bad = df["Date"].isna()
    df = df[~bad]
    log.add("invalid_dates", bad.sum(), len(df), "Rows whose Date could not be parsed were removed")

    missing = df[["State", "Market", "Commodity", "Variety", "Modal_Price"]].isna().any(axis=1)
    df = df[~missing]
    log.add("missing_key_fields", missing.sum(), len(df),
            "Rows missing state/market/commodity/variety/modal price were removed")

    nonpos = df["Modal_Price"] <= 0
    df = df[~nonpos]
    log.add("non_positive_modal_price", nonpos.sum(), len(df),
            "Rows with Modal_Price <= 0 were removed (a price cannot be zero or negative)")

    zero_min = df["Min_Price"] <= 0
    df.loc[zero_min, "Min_Price"] = np.nan
    log.add("non_positive_min_price", zero_min.sum(), len(df),
            "Min_Price <= 0 set to missing; row kept because Modal_Price is valid. "
            "Min_Price is not a model input")

    dup = df.duplicated(subset=REQUIRED_COLUMNS)
    df = df[~dup]
    log.add("exact_duplicates", dup.sum(), len(df), "Exact duplicate rows removed")

    key_dups = df.duplicated(subset=DAY_KEY, keep=False)
    n_groups = df[key_dups].groupby(DAY_KEY).ngroups
    df = (df.groupby(DAY_KEY, as_index=False, observed=True)
            .agg(Arrivals=("Arrivals", "mean"), Min_Price=("Min_Price", "median"),
                 Max_Price=("Max_Price", "median"), Modal_Price=("Modal_Price", "median"),
                 source_file=("source_file", "first")))
    log.add("same_day_duplicates", key_dups.sum(), len(df),
            f"{n_groups} date/market/commodity/variety groups had several rows with different "
            "prices; merged into one row using the median price. Arrivals were averaged, not "
            "summed, because within most groups the arrival figure is repeated identically")

    df = df.sort_values([*SERIES_KEY, "Date"]).reset_index(drop=True)
    trailing_median = (df.groupby(SERIES_KEY, observed=True)["Modal_Price"]
                         .transform(lambda s: s.shift(1).rolling(OUTLIER_WINDOW,
                                                                 min_periods=OUTLIER_MIN_PERIODS)
                                                        .median()))
    upper, lower = trailing_median * OUTLIER_RATIO, trailing_median / OUTLIER_RATIO
    is_out = trailing_median.notna() & ((df["Modal_Price"] > upper) | (df["Modal_Price"] < lower))
    df["Modal_Price_raw"] = df["Modal_Price"]
    df["outlier_capped"] = is_out
    df.loc[is_out, "Modal_Price"] = df.loc[is_out, "Modal_Price"].clip(lower[is_out], upper[is_out])
    log.add("outlier_capping", is_out.sum(), len(df),
            f"Modal prices more than {OUTLIER_RATIO:g}x above or below the median of the "
            f"previous {OUTLIER_WINDOW} observations of the same series were capped to that "
            "bound (rows kept; original value preserved in Modal_Price_raw)")

    return df, log
