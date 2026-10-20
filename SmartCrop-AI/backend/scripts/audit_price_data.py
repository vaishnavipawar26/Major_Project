"""Read-only audit of the price dataset (raw file -> cleaned file -> daily panel).

Run from backend/:  python -m scripts.audit_price_data
Writes dataset/reports/price_dataset_audit.md and .json. It never modifies the raw data or the
processed files; the cleaning itself lives in app/ml/price_prediction/preprocessing.py and is
run by scripts.prepare_price_data (whose cleaning log is in price_data_quality.md).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pandas as pd

from app.ml.common import paths
from app.ml.price_prediction.preprocessing import SERIES_KEY, find_price_files, load_raw

QS = [0.01, 0.25, 0.5, 0.75, 0.99]
COLS = ["Date", "State", "Market", "Commodity", "Variety", "Arrivals", "Min_Price", "Max_Price",
        "Modal_Price"]


def md(df: pd.DataFrame, index: bool = True) -> str:
    d = df.reset_index() if index else df
    rows = ["| " + " | ".join(map(str, d.columns)) + " |", "|" + "---|" * len(d.columns)]
    rows += ["| " + " | ".join(f"{v:,.2f}" if isinstance(v, float) else str(v) for v in r) + " |"
             for r in d.itertuples(index=False)]
    return "\n".join(rows)


def quantile_table(grouped) -> pd.DataFrame:
    t = grouped.quantile(QS).unstack().round(1)
    t.columns = [f"p{int(q * 100)}" for q in QS]
    return t


def series_stats(clean: pd.DataFrame) -> pd.DataFrame:
    clean = clean.sort_values([*SERIES_KEY, "Date"])
    clean = clean.assign(gap=clean.groupby(SERIES_KEY, observed=True)["Date"].diff().dt.days)
    ser = clean.groupby(SERIES_KEY, observed=True).agg(
        obs=("Date", "size"), first=("Date", "min"), last=("Date", "max"),
        max_gap=("gap", "max"), median_gap=("gap", "median"))
    ser["span"] = (ser["last"] - ser["first"]).dt.days + 1
    ser["coverage"] = ser["obs"] / ser["span"]
    return ser


def main() -> None:
    raw = load_raw(find_price_files(paths.RAW_DIR))
    clean = pd.read_parquet(paths.PRICE_CLEAN_PATH)
    miss_raw = (raw[COLS].isna().mean() * 100).round(3)
    miss_clean = (clean[COLS].isna().mean() * 100).round(3)
    rd = pd.to_datetime(raw["Date"], errors="coerce")
    ser = series_stats(clean)
    per_crop = (ser.reset_index().groupby("Commodity")
                .agg(series=("obs", "size"), median_obs=("obs", "median"),
                     median_coverage=("coverage", "median"),
                     series_with_gap_gt30=("max_gap", lambda s: int((s > 30).sum())),
                     series_under_180_obs=("obs", lambda s: int((s < 180).sum()))))
    price_dist = quantile_table(clean.groupby("Commodity")["Modal_Price"])
    arr = clean.groupby("Commodity")["Arrivals"]
    arr_dist = quantile_table(arr)
    arr_dist["missing_pct"] = (arr.apply(lambda s: s.isna().mean()) * 100).round(2)
    arr_dist["zero_or_neg"] = arr.apply(lambda s: int((s <= 0).sum()))
    wd = clean["Date"].dt.dayofweek.value_counts(normalize=True).sort_index().mul(100).round(1)

    summary = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "rows_raw": len(raw), "rows_clean": len(clean),
        "missing_pct_raw": miss_raw.to_dict(), "missing_pct_clean": miss_clean.to_dict(),
        "exact_duplicate_rows_raw": int(raw[COLS].duplicated().sum()),
        "same_day_key_duplicates_raw": int(raw.duplicated(subset=["Date", *SERIES_KEY]).sum()),
        "date_min": str(rd.min().date()), "date_max": str(rd.max().date()),
        "distinct_dates": int(rd.nunique()),
        "calendar_days_without_any_report": int((rd.max() - rd.min()).days + 1 - rd.nunique()),
        "unique_crops": int(clean["Commodity"].nunique()), "unique_markets": int(clean["Market"].nunique()),
        "unique_varieties": int(clean["Variety"].nunique()), "series": int(len(ser)),
        "modal_outside_min_max_clean": int(((clean["Modal_Price"] < clean["Min_Price"])
                                            | (clean["Modal_Price"] > clean["Max_Price"])).sum()),
        "min_gt_max_clean": int((clean["Min_Price"] > clean["Max_Price"]).sum()),
        "outlier_capped_rows": int(clean["outlier_capped"].sum()),
        "series_median_coverage": float(ser["coverage"].median()),
        "series_with_gap_gt30": int((ser["max_gap"] > 30).sum()),
    }
    (paths.REPORTS_DIR / "price_dataset_audit.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    s = summary
    lines = [
        "# Price Dataset Audit", "",
        f"Generated {s['generated']} by `scripts/audit_price_data.py` (read-only; raw data untouched).", "",
        "## 1. Size and identity", "",
        f"- Rows: raw **{s['rows_raw']:,}** -> cleaned **{s['rows_clean']:,}** "
        f"({s['rows_raw'] - s['rows_clean']:,} merged/removed; per-step counts in `price_data_quality.md`).",
        f"- Date coverage: {s['date_min']} to {s['date_max']}; {s['distinct_dates']} distinct report dates; "
        f"{s['calendar_days_without_any_report']} calendar days with no report from any market.",
        f"- Unique crops {s['unique_crops']}, markets {s['unique_markets']}, varieties {s['unique_varieties']}, "
        f"crop-market-variety series {s['series']}.",
        f"- Exact duplicate rows in raw: {s['exact_duplicate_rows_raw']}; same date/market/crop/variety rows "
        f"(different values): {s['same_day_key_duplicates_raw']}.", "",
        "## 2. Missing values (% of rows)", "",
        md(pd.DataFrame({"raw": miss_raw, "cleaned": miss_clean})), "",
        "## 3. Consistency of prices", "",
        f"- Modal price outside [Min, Max] in cleaned data: {s['modal_outside_min_max_clean']}; "
        f"Min > Max: {s['min_gt_max_clean']}.",
        f"- Rows whose modal price was capped by the trailing-median outlier rule: {s['outlier_capped_rows']} "
        "(the original is kept in `Modal_Price_raw`).", "",
        "Modal price (Rs/quintal) quantiles per crop:", "", md(price_dist), "",
        "## 4. Arrivals", "",
        "Arrivals quantiles per crop (units as reported by the source; the file does not state them):", "",
        md(arr_dist), "",
        "## 5. Irregular series and gaps", "",
        f"- Median share of days a series reports between its first and last date: {s['series_median_coverage']:.0%}.",
        f"- Series with a gap longer than 30 days: {s['series_with_gap_gt30']} of {s['series']}.",
        "- Gaps are never filled with prices: the model panel carries a price forward at most 7 days, and any "
        "forecast origin whose lag windows touch a longer gap is not used.", "",
        md(per_crop.round(2)), "",
        "Share of reports by weekday (Mon=0): " + ", ".join(f"{k}: {v}%" for k, v in wd.items()), "",
        "## 6. Limitations and recommended fixes", "",
        "- **Short history (3 years).** Seasonal comparisons rest on 1-2 earlier years. Add Agmarknet downloads for "
        "2018-2022 with the same columns (Date, State, Market, Commodity, Variety, Arrivals, Min/Max/Modal price) to "
        "`dataset/raw/`, then rerun `prepare_price_data`. Do not fabricate rows.",
        "- **Sparse markets.** Many markets report on fewer than half of days; only series with enough reports are offered.",
        "- **Arrivals units and aggregation unknown.** Same-day duplicate arrivals were averaged (repeated figures), so "
        "arrivals may be under- or over-stated for some yards.",
        "- **Price outliers are capped, not removed.** The cap uses only past prices, so it can be applied to live data.",
        "- **No weather in the price file.** Weather is joined separately from Open-Meteo (see `weather_data_quality.md`).",
        "- **Variety spelling** is used as given; near-duplicate variety names were not merged.",
    ]
    (paths.REPORTS_DIR / "price_dataset_audit.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines[:14]))


if __name__ == "__main__":
    main()
