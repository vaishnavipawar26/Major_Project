"""Validate and import additional REAL mandi price records without touching the existing data.

Run from backend/ (a dry run first, then --apply):
    python -m scripts.import_price_data path/to/agmarknet_2018_2022.csv --source agmarknet
    python -m scripts.import_price_data path/to/agmarknet_2018_2022.csv --source agmarknet --apply

What it does
  * maps common source headers (Agmarknet, data.gov.in, CEDA exports) to the project schema
        Date, State, Market, Commodity, Variety, Arrivals, Min_Price, Max_Price, Modal_Price   (Rs per quintal)
  * keeps only Maharashtra rows of the seven crops, with valid dates and prices
  * refuses markets that do not exist in the current dataset unless --allow-new-markets (a market is never silently renamed or substituted;
    a --market-map CSV with columns source_name,project_name maps differently spelled names explicitly)
  * never overwrites, merges or averages with existing rows: a record whose Date/State/Market/Commodity/Variety already exists is skipped when
    its values are identical and written to the conflicts report when they differ
  * checks the price unit against the existing data of the same crop (a per-kg or per-tonne file is rejected unless --price-unit says so)
  * with --apply writes dataset/raw/imported_<source>_<first>_<last>.csv in EXACTLY the existing schema (scripts.prepare_price_data picks any
    schema-matching CSV in dataset/raw/ up automatically) and records the file's SHA-256 so the same file cannot be applied twice

It never invents a record: every output row is a row of the input file. Nothing is written without --apply (the reports are always written).
After applying, follow dataset/IMPORT_PRICE_DATA.md (re-run preparation, retraining and the chronological validation).
"""
from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import pandas as pd

from app.ml.common import paths
from app.ml.price_prediction.preprocessing import REQUIRED_COLUMNS, find_price_files, load_raw

CROPS = ["Brinjal", "Cabbage", "Cauliflower", "Onion", "Potato", "Tomato", "Wheat"]
STATE = "Maharashtra"
EARLIEST = pd.Timestamp("2000-01-01")
KEY = ["Date", "State", "Market", "Commodity", "Variety"]
VALUE_COLS = ["Arrivals", "Min_Price", "Max_Price", "Modal_Price"]
UNIT_FACTORS = {"quintal": 1.0, "kg": 100.0, "tonne": 0.1}     # multiply the source price to get Rs per quintal
MAX_BAD_DATE_SHARE = 0.01
UNIT_RATIO_LIMITS = (0.2, 5.0)

ALIASES = {
    "Date": ["date", "arrival_date", "price_date", "reported_date", "reporting_date", "price date"],
    "State": ["state", "state_name"],
    "Market": ["market", "mandi", "market_name", "apmc"],
    "Commodity": ["commodity", "commodity_name", "crop"],
    "Variety": ["variety", "variety_name"],
    "Arrivals": ["arrivals", "arrival", "arrivals_qtl", "arrival_quantity", "arrivals_in_qtl", "arrivals (qtl)"],
    "Min_Price": ["min_price", "min price", "min_x0020_price", "minimum_price", "min"],
    "Max_Price": ["max_price", "max price", "max_x0020_price", "maximum_price", "max"],
    "Modal_Price": ["modal_price", "modal price", "modal_x0020_price", "modal", "modal_price_rs_quintal"],
}
DATE_FORMATS = ["%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d-%b-%Y", "%d %b %Y"]


class ImportError_(ValueError):
    """The file cannot be imported at all (missing columns, wrong units, unreadable dates)."""


def norm_text(s: pd.Series) -> pd.Series:
    return s.astype("string").str.strip().str.replace(r"\s+", " ", regex=True)


def map_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Rename source headers to the project schema; every required column must be found (Variety defaults are NOT invented)."""
    lowered = {c: c.strip().lower() for c in df.columns}
    rename = {}
    for target, names in ALIASES.items():
        hits = [c for c, low in lowered.items() if low in names or low == target.lower()]
        if hits:
            rename[hits[0]] = target
    out = df.rename(columns=rename)
    missing = [c for c in REQUIRED_COLUMNS if c not in out.columns]
    if missing:
        raise ImportError_(f"Missing columns after header mapping: {missing}. Found: {list(df.columns)}. "
                           "Every record needs all nine fields; see dataset/IMPORT_PRICE_DATA.md.")
    return out[REQUIRED_COLUMNS].copy()


def parse_dates(s: pd.Series, date_format: str | None) -> pd.Series:
    formats = [date_format] if date_format else DATE_FORMATS
    best, best_share = None, 0.0
    for fmt in formats:
        parsed = pd.to_datetime(s, format=fmt, errors="coerce")
        share = parsed.notna().mean() if len(s) else 0.0
        if share > best_share:
            best, best_share = parsed, share
        if share >= 1 - MAX_BAD_DATE_SHARE:
            return parsed
    raise ImportError_(f"Dates could not be parsed (best format parsed {best_share:.1%}). Give --date-format, for example %d/%m/%Y.")


def load_existing(raw_dir: Path | None = None) -> pd.DataFrame:
    """Every record already in dataset/raw (including earlier imports), normalised exactly like the cleaning step does."""
    raw_dir = raw_dir or paths.RAW_DIR
    files = find_price_files(raw_dir)
    ex = load_raw(files).drop(columns="source_file")
    return normalise(ex)


def normalise(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for c in ["State", "Market", "Commodity", "Variety"]:
        df[c] = norm_text(df[c])
    df["Commodity"] = df["Commodity"].str.title()
    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    for c in VALUE_COLS:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def validate_import(src: pd.DataFrame, existing: pd.DataFrame, *, price_unit: str = "quintal", date_format: str | None = None,
                    allow_new_markets: bool = False, market_map: dict[str, str] | None = None,
                    today: date | None = None) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """(rows to add, rejected rows with a reason, report). ``src`` is the file as read; ``existing`` the current raw records."""
    today = pd.Timestamp(today or date.today())
    df = map_columns(src)
    report: dict = {"rows_in": int(len(df))}
    df["Date"] = parse_dates(df["Date"].astype("string").str.strip(), date_format)
    df = normalise(df)
    rejects = []

    def reject(mask: pd.Series, reason: str) -> None:
        nonlocal df
        if mask.any():
            rejects.append(df[mask].assign(reason=reason))
        report[f"rejected_{reason}"] = int(mask.sum())
        df = df[~mask]

    reject(df["Date"].isna(), "unparsable_date")
    reject((df["Date"] < EARLIEST) | (df["Date"] > today), "date_out_of_range")
    reject(df["State"].str.lower() != STATE.lower(), "not_maharashtra")
    df["State"] = STATE
    reject(~df["Commodity"].isin(CROPS), "not_one_of_the_seven_crops")
    if price_unit not in UNIT_FACTORS:
        raise ImportError_(f"--price-unit must be one of {sorted(UNIT_FACTORS)}")
    for c in ["Min_Price", "Max_Price", "Modal_Price"]:
        df[c] = df[c] * UNIT_FACTORS[price_unit]
    reject(df[["Market", "Variety", "Modal_Price"]].isna().any(axis=1) | (df["Modal_Price"] <= 0), "missing_or_non_positive_modal_price")
    reject(df[["Min_Price", "Max_Price"]].notna().all(axis=1) & (df["Min_Price"] > df["Max_Price"]), "min_above_max")

    # unit sanity: the imported median price per crop must be of the same order as the existing data of that crop
    ratios = {}
    for crop, g in df.groupby("Commodity"):
        old = existing.loc[existing["Commodity"] == crop, "Modal_Price"].median()
        if len(g) >= 50 and pd.notna(old):
            ratios[crop] = float(g["Modal_Price"].median() / old)
    report["median_price_ratio_vs_existing"] = {k: round(v, 2) for k, v in ratios.items()}
    bad = {k: v for k, v in ratios.items() if not UNIT_RATIO_LIMITS[0] <= v <= UNIT_RATIO_LIMITS[1]}
    if bad:
        raise ImportError_(f"Median modal prices differ from the existing data by more than {UNIT_RATIO_LIMITS} x for {bad}. "
                           "This usually means the file is not in Rs per quintal: check the unit and pass --price-unit kg|tonne.")

    # markets: only names that exist in the project data (after an explicit mapping); nothing is renamed silently
    mm = {k.strip().lower(): v for k, v in (market_map or {}).items()}
    df["Market"] = df["Market"].map(lambda m: mm.get(str(m).lower(), m))
    known = {m.lower(): m for m in existing["Market"].dropna().unique()}
    canon = df["Market"].str.lower().map(known)
    unknown = sorted(df.loc[canon.isna(), "Market"].unique())
    report["unmatched_markets"] = {m: difflib.get_close_matches(m, list(known.values()), n=3, cutoff=0.6) for m in unknown}
    if allow_new_markets:
        report["new_markets_allowed"] = unknown
    else:
        reject(canon.isna(), "market_not_in_current_dataset")
        canon = canon[canon.notna()]
    df["Market"] = canon.reindex(df.index).fillna(df["Market"]) if allow_new_markets else canon.reindex(df.index)

    # duplicates inside the file
    exact = df.duplicated(subset=REQUIRED_COLUMNS)
    reject(exact, "exact_duplicate_in_file")
    same_key = df.duplicated(subset=KEY, keep=False)
    report["same_key_rows_in_file_kept"] = int(same_key.sum())   # the cleaning step merges these by the median, as it does for the existing data

    # against existing records: identical -> skip, different -> conflict (never overwritten or merged)
    ex = existing[KEY + VALUE_COLS]
    m = df.reset_index().merge(ex.assign(_present=True), on=KEY, how="left", suffixes=("", "_old"))
    present = m["_present"].fillna(False).astype(bool)
    close = pd.Series(True, index=m.index)
    for c in ["Min_Price", "Max_Price", "Modal_Price"]:
        close &= (m[c].fillna(-1) - m[f"{c}_old"].fillna(-1)).abs() < 0.5
    identical = present & close
    # a key can match several existing rows (the raw file has same-day duplicates): identical if ANY existing row matches
    idx_identical = set(m.loc[identical, 'index'])
    idx_present = set(m.loc[present, 'index'])
    reject(pd.Series(df.index.isin(idx_identical), index=df.index), 'already_present_identical')
    reject(pd.Series(df.index.isin(idx_present - idx_identical), index=df.index), 'conflicts_with_existing_record')

    new = df[REQUIRED_COLUMNS].sort_values(["Commodity", "Market", "Variety", "Date"]).reset_index(drop=True)
    report["rows_new"] = int(len(new))
    report["date_min"] = None if new.empty else str(new["Date"].min().date())
    report["date_max"] = None if new.empty else str(new["Date"].max().date())
    report["new_rows_per_crop"] = new["Commodity"].value_counts().to_dict()
    report["new_rows_per_year"] = {int(k): int(v) for k, v in new.groupby(new["Date"].dt.year).size().items()}
    report["modal_outside_min_max_kept"] = int(((new["Modal_Price"] < new["Min_Price"]) | (new["Modal_Price"] > new["Max_Price"])).sum())
    rej = pd.concat(rejects, ignore_index=True) if rejects else pd.DataFrame(columns=REQUIRED_COLUMNS + ["reason"])
    return new, rej, report


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("file", type=Path)
    ap.add_argument("--source", required=True, help="short name used in the output file name, e.g. agmarknet")
    ap.add_argument("--apply", action="store_true", help="write dataset/raw/imported_*.csv (without it only the reports are written)")
    ap.add_argument("--price-unit", default="quintal", choices=sorted(UNIT_FACTORS))
    ap.add_argument("--date-format", default=None)
    ap.add_argument("--allow-new-markets", action="store_true")
    ap.add_argument("--market-map", type=Path, default=None, help="CSV with columns source_name,project_name")
    ap.add_argument("--out-dir", type=Path, default=paths.RAW_DIR, help=argparse.SUPPRESS)
    ap.add_argument("--report-dir", type=Path, default=paths.REPORTS_DIR, help=argparse.SUPPRESS)
    a = ap.parse_args(argv)

    digest = sha256(a.file)
    manifest_path = a.report_dir / "price_import_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"imports": []}
    if any(i["sha256"] == digest for i in manifest["imports"]):
        print("This exact file was already imported (same SHA-256); nothing to do.", file=sys.stderr)
        return 2
    src = pd.read_csv(a.file, dtype=str)
    mmap = dict(pd.read_csv(a.market_map, dtype=str).itertuples(index=False, name=None)) if a.market_map else None
    try:
        new, rej, report = validate_import(src, load_existing(a.out_dir), price_unit=a.price_unit, date_format=a.date_format,
                                           allow_new_markets=a.allow_new_markets, market_map=mmap)
    except ImportError_ as exc:
        print(f"IMPORT REFUSED: {exc}", file=sys.stderr)
        return 1
    name = f"{a.source}_{(report['date_min'] or 'none').replace('-', '')}_{(report['date_max'] or 'none').replace('-', '')}"
    a.report_dir.mkdir(parents=True, exist_ok=True)
    report |= {"source": a.source, "input_file": a.file.name, "sha256": digest, "applied": bool(a.apply),
               "created": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    (a.report_dir / f"price_import_{name}.json").write_text(json.dumps(report, indent=1, default=str), encoding="utf-8")
    if len(rej):
        rej.to_csv(a.report_dir / f"price_import_{name}_rejects.csv", index=False)
    print(json.dumps({k: v for k, v in report.items() if k.startswith(("rows", "rejected", "date_", "new_rows", "unmatched"))}, indent=1, default=str))
    if a.apply:
        if new.empty:
            print("No new records: nothing written.", file=sys.stderr)
            return 3
        out = a.out_dir / f"imported_{name}.csv"
        out_df = new.copy()
        out_df["Date"] = out_df["Date"].dt.strftime("%Y-%m-%d")
        out_df.to_csv(out, index=False)
        manifest["imports"].append({"sha256": digest, "source": a.source, "input_file": a.file.name, "output_file": out.name,
                                    "rows": int(len(new)), "date_min": report["date_min"], "date_max": report["date_max"], "applied_at": report["created"]})
        manifest_path.write_text(json.dumps(manifest, indent=1), encoding="utf-8")
        print(f"Wrote {out} ({len(new):,} rows). Next: follow dataset/IMPORT_PRICE_DATA.md.")
    else:
        print("Dry run: nothing written to dataset/raw (use --apply).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
