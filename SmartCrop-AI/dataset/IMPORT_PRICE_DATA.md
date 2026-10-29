# Importing additional mandi price records

Why: the forecast models for Onion, Potato, Tomato and Wheat are limited by the history, not by the validation rules. The price file has
three years (2023-2025), so the projection test sees only two year-over-year transitions and they point opposite ways (Onion x1.2-2.3 in 2024,
x0.28-0.6 in 2025; Potato x1.7-1.9, then x0.56-0.65). See `MODEL_EVALUATION.md` and `dataset/reports/forecast_v3_experiment.md`.
More real years can only help; it does **not** guarantee any crop will reach 60/60 validated days. The measured result after retraining decides.

## 1. What the current dataset contains (verified 2026-10-28, `python -m scripts.audit_price_data`)

| Item | Value |
|---|---|
| File | `dataset/raw/Maharashtra_Crop_Prices_2023_2025_Cleaned.csv` (never edited) |
| Columns (exact) | `Date, State, Market, Commodity, Variety, Arrivals, Min_Price, Max_Price, Modal_Price` (prices in Rs per quintal; Arrivals unit not stated by the source) |
| Rows | 246,067 raw, 244,150 after cleaning (`price_data_quality.md` lists every step) |
| States / markets / crops | Maharashtra only; 297 markets; 7 crops |
| Dates | 2023-01-01 to 2025-12-31 (1,096 calendar days). No market reported on 5 days: 2023-11-05, 2024-04-10, 2024-04-11, 2024-10-08, 2025-05-14 |
| Missing values | 0 in every column |
| Duplicates | 0 exact duplicate rows; 1,917 rows share Date/State/Market/Commodity/Variety with different values (merged by the median in cleaning) |
| Market names | mixed styles (`APMC Sillod`, `Pune(Manjri)`, some with double spaces, normalised by the cleaning step) |

| Crop | Rows | Markets | Days with at least one report (of 1,096) | Markets with 500+ days | Markets with 180+ days |
|---|---|---|---|---|---|
| Onion | 49,385 | 116 | 1,088 | 40 | 80 |
| Potato | 21,212 | 44 | 1,086 | 23 | 32 |
| Tomato | 31,832 | 61 | 1,086 | 33 | 47 |
| Wheat | 60,609 | 237 | 1,090 | 43 | 111 |

## 2. Where more real data could come from (checked 2026-10-28; nothing was downloaded or registered)

| Source | What was verified | Usable now? |
|---|---|---|
| data.gov.in "Current Daily Price of Various Commodities from Various Markets (Mandi)" (Agmarknet, DMI) | A web search of the resource page describes it as having no public API and offering a "Request API" button (the page itself returned 403 to an automated fetch); the API endpoint answers HTTP 400 without a key. Current-day data only, per third-party notes. | No: needs an API key you request; not a history source |
| CEDA Agri Market Data API, Ashoka University (`api.ceda.ashoka.edu.in`) | Free API key after registration; coverage stated by CEDA and a third-party wrapper as 2000 to present, updated monthly with a lag of a few months. I could not confirm whether the API returns **daily** records or only monthly aggregates. | Not without registering (an account must be created by you); granularity must be checked first |
| Agmarknet portal (`agmarknet.gov.in`, "Agmarknet 2.0") | Reachable but a script-driven page; date-wise market and commodity reports exist per the portal's description; I could not read its report pages or confirm bulk export or CAPTCHA. | Unknown: needs a manual check |
| MSAMB (`msamb.com`, Maharashtra State Agricultural Marketing Board) | Home page shows only the current rates (no date selector); the download section holds monthly marketing-news PDFs (April 2022 to September 2026), not daily price tables. | No daily history found |
| CEDA/DoCA daily food prices | Per CEDA's description: daily retail and wholesale prices of 22 essential commodities from 100+ centres since 2009. These are price-monitoring-centre prices, not APMC modal prices, so they are a different series. | Not a substitute: do not mix with the mandi series |

Needed from whichever source is obtained (any one is enough):

* **Older history:** daily APMC records for the 7 crops in Maharashtra, as far back as available (2015-2022 would be most valuable), for at least the
  markets that already exist in this dataset (Onion 116, Potato 44, Tomato 61, Wheat 237 markets; at minimum the 100+ markets with 500+ days).
* **2026:** daily records from 2026-01-01 to the latest available date for the same markets.
* **Fields (all nine, per record):** Date, State, Market, Commodity, Variety, Arrivals, Min_Price, Max_Price, Modal_Price, with prices in Rs per quintal.
  The importer maps common headers (`Arrival_Date`, `Min Price`, `Max Price`, `Modal Price`, `Mandi`, ...). A source that gives only a monthly
  average cannot be used: the models use daily lags and rolling windows.

## 3. Import (never overwrites, never invents)

```
cd backend
python -m scripts.import_price_data path/to/file.csv --source agmarknet            # dry run: reports only
python -m scripts.import_price_data path/to/file.csv --source agmarknet --apply    # writes dataset/raw/imported_agmarknet_<first>_<last>.csv
```

Options: `--price-unit kg|tonne` (a file not in Rs/quintal is refused unless declared), `--date-format %d/%m/%Y`, `--market-map map.csv`
(`source_name,project_name`), `--allow-new-markets`.

Rules: only Maharashtra rows of the seven crops; valid dates (2000-01-01 to today); modal price > 0 and Min <= Max; markets must match an existing
market (otherwise rejected with spelling suggestions, never silently renamed); a record whose Date/State/Market/Commodity/Variety already exists is skipped
when identical and written to the rejects file as a conflict when different (existing data always wins); exact duplicates inside the file are
dropped; the file's SHA-256 is recorded in `dataset/reports/price_import_manifest.json`, so the same file cannot be applied twice.
Reports: `dataset/reports/price_import_<source>_<first>_<last>.json` and `..._rejects.csv`.
The output file has exactly the existing schema, so `scripts.prepare_price_data` includes it automatically (`find_price_files`).

## 4. After importing: retrain and validate (nothing here is automatic)

1. `python -m scripts.audit_price_data` and `python -m scripts.prepare_price_data` (cleaned rows, daily panel, `supported_series.csv`, quality report).
2. Review the **date constants**. These scripts hard-code the 2023-2025 folds and split dates and must be extended to the new history before any
   claim is made: `train_price_model.py` (`FOLDS`), `backtest_price.py`, `backtest_candidate_v2.py`, `build_reliability_table.py`, `phaseB_*.py`,
   `experiment_hard_crops.py` / `experiment_forecast_v2.py` / `experiment_forecast_v3.py` (`SPLITS`), `train_crop_band_models.py`. Keep the rule that training pairs
   must have target dates before the scored period, and keep the +2 % margin and both scenarios.
3. Weather inputs: if older dates are added, `scripts.fetch_price_weather` / `build_weather_features` must cover them (the production model currently uses none).
4. `python -m scripts.train_price_model`, then `build_reliability_table`, `phaseB_validation`, `phaseB_projection`, `build_crop_policy`.
5. Re-run the model searches (`experiment_forecast_v3`, `evaluate_horizon_metrics` for the per-horizon MAE / RMSE / WAPE / R2 table), then `python -m scripts.train_crop_band_models` (a cell is saved only if it clears +2 % in every split,
   both scenarios and three sampling seeds).
6. `python -m pytest`, check `/api/price-prediction/trend` for the four crops and report the measured validated / experimental / unavailable days.
