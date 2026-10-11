"""Stage 2: price data-quality report + cleaning + daily panel.

Run from backend/:  python -m scripts.prepare_price_data

Outputs
  dataset/reports/price_data_quality.md / .json   human + machine readable report
  dataset/processed/price_clean.parquet           cleaned rows (one per day/series)
  dataset/processed/price_daily_panel.parquet     continuous daily panel used by the model
  dataset/processed/price_monthly_seasonal_index.csv
  dataset/crop_price/supported_series.csv         which market series can be forecast
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from app.ml.common import paths
from app.ml.price_prediction.features import STATE_MARKET, build_daily_panel
from app.ml.price_prediction.preprocessing import (DAY_KEY, SERIES_KEY, clean_prices,
                                                   find_price_files, load_raw)

MIN_SERIES_OBS = 180  # minimum reported days for a market series to be offered for forecasting


def profile_raw(raw: pd.DataFrame) -> dict:
    d = pd.to_datetime(raw["Date"], errors="coerce")
    num = ["Arrivals", "Min_Price", "Max_Price", "Modal_Price"]
    out = {
        "rows": len(raw),
        "columns": list(raw.columns.drop("source_file")),
        "missing_values": raw.drop(columns="source_file").isna().sum().astype(int).to_dict(),
        "exact_duplicate_rows": int(raw.drop(columns="source_file").duplicated().sum()),
        "same_day_key_duplicates": int(raw.duplicated(subset=DAY_KEY).sum()),
        "invalid_dates": int(d.isna().sum()),
        "date_min": str(d.min().date()), "date_max": str(d.max().date()),
        "distinct_dates": int(d.nunique()),
        "states": raw["State"].value_counts().to_dict(),
        "n_markets": int(raw["Market"].nunique()),
        "missing_crop_names": int(raw["Commodity"].isna().sum()
                                  + (raw["Commodity"].astype(str).str.strip() == "").sum()),
        "records_per_crop": raw["Commodity"].value_counts().to_dict(),
        "markets_per_crop": raw.groupby("Commodity")["Market"].nunique().to_dict(),
        "varieties_per_crop": {c: g.value_counts().to_dict()
                               for c, g in raw.groupby("Commodity")["Variety"]},
        "numeric_summary": raw[num].describe().round(2).to_dict(),
        "invalid_prices": {
            "modal_le_0": int((raw["Modal_Price"] <= 0).sum()),
            "min_le_0": int((raw["Min_Price"] <= 0).sum()),
            "max_le_0": int((raw["Max_Price"] <= 0).sum()),
            "min_gt_max": int((raw["Min_Price"] > raw["Max_Price"]).sum()),
            "modal_outside_min_max": int(((raw["Modal_Price"] < raw["Min_Price"]) |
                                          (raw["Modal_Price"] > raw["Max_Price"])).sum()),
        },
        "arrivals_le_0": int((raw["Arrivals"] <= 0).sum()),
    }

    def iqr_extremes(s: pd.Series) -> int:
        q1, q3 = s.quantile([.25, .75])
        return int(((s < q1 - 3 * (q3 - q1)) | (s > q3 + 3 * (q3 - q1))).sum())
    out["extreme_values_3iqr_per_crop"] = raw.groupby("Commodity")["Modal_Price"].apply(
        iqr_extremes).to_dict()
    out["top_modal_prices"] = (raw.nlargest(10, "Modal_Price")
                               [["Date", "Market", "Commodity", "Variety", "Modal_Price"]]
                               .to_dict("records"))
    return out


def series_support(clean: pd.DataFrame, panel: pd.DataFrame) -> pd.DataFrame:
    s = (clean.groupby(SERIES_KEY, observed=True)
              .agg(observations=("Date", "nunique"), first_date=("Date", "min"),
                   last_date=("Date", "max"))
              .reset_index())
    state = (panel[panel["Market"] == STATE_MARKET].groupby(SERIES_KEY)
             .agg(observations=("observed", "sum"), first_date=("Date", "min"),
                  last_date=("Date", "max")).reset_index())
    s = pd.concat([state, s], ignore_index=True)
    span = (s["last_date"] - s["first_date"]).dt.days + 1
    s["coverage"] = (s["observations"] / span).round(3)
    s["supported"] = s["observations"] >= MIN_SERIES_OBS
    s["first_date"] = s["first_date"].dt.date.astype(str)
    s["last_date"] = s["last_date"].dt.date.astype(str)
    return s.sort_values(["Commodity", "Market", "Variety"]).reset_index(drop=True)


def seasonal_index(panel: pd.DataFrame) -> pd.DataFrame:
    """Historical month-of-year price index per commodity (state-level series).

    index(month) = mean over complete years of  median price in month / median price in year.
    Only calendar years with data in all 12 months are used.
    """
    st = panel[(panel["Market"] == STATE_MARKET) & panel["observed"]].copy()
    st["year"], st["month"] = st["Date"].dt.year, st["Date"].dt.month
    monthly = st.groupby(["Commodity", "year", "month"])["price"].median().reset_index()
    full_years = monthly.groupby(["Commodity", "year"])["month"].nunique()
    full_years = full_years[full_years == 12].reset_index()[["Commodity", "year"]]
    monthly = monthly.merge(full_years, on=["Commodity", "year"])
    annual = st.merge(full_years, on=["Commodity", "year"]).groupby(
        ["Commodity", "year"])["price"].median().rename("annual")
    monthly = monthly.join(annual, on=["Commodity", "year"])
    monthly["ratio"] = monthly["price"] / monthly["annual"]
    idx = (monthly.groupby(["Commodity", "month"])
           .agg(index=("ratio", "mean"), index_std=("ratio", "std"), n_years=("year", "nunique"))
           .reset_index())
    return idx.round(4)


def write_markdown(prof: dict, log, support: pd.DataFrame, clean: pd.DataFrame, path) -> None:
    L = ["# Price Dataset — Data-Quality Report", "",
         f"Generated: {datetime.now(timezone.utc).isoformat(timespec='seconds')} by "
         "`backend/scripts/prepare_price_data.py`", "",
         "## 1. Raw dataset profile", "",
         f"- Rows: **{prof['rows']:,}**",
         f"- Columns: {', '.join(prof['columns'])}",
         f"- Date range: **{prof['date_min']} → {prof['date_max']}** "
         f"({prof['distinct_dates']} distinct dates); invalid dates: {prof['invalid_dates']}",
         f"- States: {prof['states']}",
         f"- Distinct markets: **{prof['n_markets']}**",
         f"- Missing crop names: {prof['missing_crop_names']}",
         f"- Exact duplicate rows: {prof['exact_duplicate_rows']}",
         f"- Same date/market/commodity/variety duplicates (different prices): "
         f"{prof['same_day_key_duplicates']}",
         f"- Arrivals ≤ 0: {prof['arrivals_le_0']}", "",
         "### Missing values per column", "", "| Column | Missing |", "|---|---|"]
    L += [f"| {k} | {v} |" for k, v in prof["missing_values"].items()]
    L += ["", "### Invalid prices", "", "| Check | Rows |", "|---|---|"]
    L += [f"| {k} | {v} |" for k, v in prof["invalid_prices"].items()]
    L += ["", "### Records, markets and extreme values per crop", "",
          "| Crop | Records | Markets | Extreme modal prices (>3×IQR) |", "|---|---|---|---|"]
    for c, n in prof["records_per_crop"].items():
        L.append(f"| {c} | {n:,} | {prof['markets_per_crop'][c]} | "
                 f"{prof['extreme_values_3iqr_per_crop'][c]} |")
    L += ["", "Note: values beyond 3×IQR are not automatically errors — vegetable prices "
          "have genuine seasonal spikes (e.g. tomato in mid-2023). See the outlier rule below.",
          "", "### Varieties per crop", ""]
    for c, v in prof["varieties_per_crop"].items():
        L.append(f"- **{c}**: " + ", ".join(f"{k} ({n:,})" for k, n in v.items()))
    L += ["", "### Highest modal prices in raw data", "",
          "| Date | Market | Crop | Variety | Modal price (₹/qtl) |", "|---|---|---|---|---|"]
    for r in prof["top_modal_prices"]:
        L.append(f"| {r['Date']} | {r['Market']} | {r['Commodity']} | {r['Variety']} | "
                 f"{r['Modal_Price']:,.0f} |")
    L += ["", "## 2. Cleaning steps (in order)", "",
          "| Step | Rows affected | Rows after | Decision |", "|---|---|---|---|"]
    L += [f"| {s['step']} | {s['rows_affected']:,} | {s['rows_after']:,} | {s['note']} |"
          for s in log.steps]
    removed = prof["rows"] - len(clean)
    L += ["", f"Net rows removed or merged: **{removed:,} ({removed / prof['rows']:.2%})**. "
          "No large portion of the data was discarded.", "",
          "## 3. Forecastability of series", "",
          f"A market series is offered for forecasting when it has at least {MIN_SERIES_OBS} "
          "reported days. A state-level reference series (median across all markets) is also "
          "built per crop.", "",
          "| Crop | Market series | Supported (≥ "
          f"{MIN_SERIES_OBS} days) | Median coverage of days |", "|---|---|---|---|"]
    mk = support[support["Market"] != STATE_MARKET]
    for c, g in mk.groupby("Commodity"):
        L.append(f"| {c} | {len(g)} | {int(g['supported'].sum())} | {g['coverage'].median():.0%} |")
    st = support[support["Market"] == STATE_MARKET]
    L += ["", "State-level reference series:", ""]
    for _, r in st.iterrows():
        L.append(f"- {r['Commodity']}: {int(r['observations'])} reported days, "
                 f"{r['first_date']} → {r['last_date']}")
    L += ["", "## 4. Notes and limitations", "",
          "- The file is already named *Cleaned*; its upstream cleaning is undocumented. "
          "About 0.3% of Arrivals values look averaged (e.g. 152.666667).",
          "- Only one state (Maharashtra) is present, so State carries no predictive "
          "information and is not a model feature.",
          "- Markets do not report every day; prices are carried forward at most 7 days and "
          "longer gaps are left missing rather than interpolated.",
          f"- Data ends on {prof['date_max']}; forecasts are made *as of* a date inside the "
          "dataset, never for dates after the last available price without new data."]
    path.write_text("\n".join(L), encoding="utf-8")


def main() -> None:
    for d in (paths.PROCESSED_DIR, paths.REPORTS_DIR, paths.CROP_PRICE_DIR):
        d.mkdir(parents=True, exist_ok=True)
    files = find_price_files(paths.RAW_DIR)
    if not files:
        raise SystemExit(f"No price CSV found in {paths.RAW_DIR}")
    print("Price files:", [f.name for f in files])
    raw = load_raw(files)

    prof = profile_raw(raw)
    clean, log = clean_prices(raw)
    for s in log.steps:
        print(f"  {s['step']:<26} affected={s['rows_affected']:>7,}  after={s['rows_after']:>8,}")

    panel = build_daily_panel(clean)
    support = series_support(clean, panel)
    sidx = seasonal_index(panel)

    clean.to_parquet(paths.PRICE_CLEAN_PATH, index=False)
    panel.to_parquet(paths.PRICE_PANEL_PATH, index=False)
    sidx.to_csv(paths.SEASONAL_INDEX_PATH, index=False)
    support.to_csv(paths.CROP_PRICE_DIR / "supported_series.csv", index=False)

    report = {"raw_profile": prof, "cleaning_steps": log.steps,
              "clean_rows": len(clean), "panel_rows": len(panel),
              "series_total": int(len(support)), "series_supported": int(support["supported"].sum()),
              "source_files": [f.name for f in files]}
    (paths.REPORTS_DIR / "price_data_quality.json").write_text(
        json.dumps(report, indent=2, default=str), encoding="utf-8")
    write_markdown(prof, log, support, clean, paths.REPORTS_DIR / "price_data_quality.md")
    print(f"clean rows={len(clean):,} panel rows={len(panel):,} "
          f"series={len(support)} supported={int(support['supported'].sum())}")


if __name__ == "__main__":
    main()
