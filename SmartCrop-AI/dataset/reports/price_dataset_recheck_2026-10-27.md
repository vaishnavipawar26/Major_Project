# Price dataset re-check (independent of prepare_price_data.py)

Checked 2026-10-27 on `dataset/raw/Maharashtra_Crop_Prices_2023_2025_Cleaned.csv` (original file, not modified).
Original source: AGMARKNET mandi reports per `DATASET.md`; the exact download source and licence are still marked "to confirm" there.

| Check | Result |
|---|---|
| Rows / columns | 246,067 / Date, State, Market, Commodity, Variety, Arrivals, Min_Price, Max_Price, Modal_Price |
| Dates | all parse; 2023-01-01 to **2025-12-31** (historical; nothing later exists in the project) |
| State | Maharashtra only |
| Crop names | 7 clean names, no spelling variants |
| Market names | no two spellings collide after case/punctuation normalisation (distinct markets are kept distinct) |
| Exact duplicate rows | 0 |
| Same date/market/crop/variety, different prices | 1,917 groups (merged by median in the cleaned file; arrivals averaged) |
| Min > Max, Modal outside Min..Max | 0 |
| Min_Price = 0 | 1 row (Wheat, APMC Dhule, 2023-06-02, modal 2,405) - kept, Min is not a model input on its own |
| Modal > 10x crop median | Cabbage 3, Onion 4, Tomato 8 (capped by the existing rule, original kept in `Modal_Price_raw`) |
| Modal < 0.1x crop median | 50 rows across crops (same capping rule) |
| Arrivals | no missing values; units are not stated by the source |
| Weather in the price file | none (kept in separate files under `dataset/weather/`) |

These figures match the existing `price_data_quality.md` (1,917 same-day groups, outliers capped, nothing deleted without a record).
No new cleaned dataset was needed, so none was written.

## Coverage and forecast status per crop

| Crop | Rows | Markets | Latest price date | Existing model validated for a forecast? | Weather candidate (2025 test) |
|---|---|---|---|---|---|
| Brinjal | 29,148 | 56 | 2025-12-31 | Yes, all distances | no change (0.0%) |
| Cabbage | 27,218 | 50 | 2025-12-31 | Yes, all distances | 2.7% lower MAE (small) |
| Cauliflower | 26,663 | 50 | 2025-12-31 | Yes, all distances | 1.3% lower MAE (small) |
| Onion | 49,385 | 116 | 2025-12-31 | No (history only) | 1.5% worse |
| Potato | 21,212 | 44 | 2025-12-31 | No (history only) | 0.8% lower MAE (small) |
| Tomato | 31,832 | 61 | 2025-12-31 | No (history only) | 1.1% worse |
| Wheat | 60,609 | 237 | 2025-12-31 | No (history only) | 0.4% worse |

Every crop's latest real price is 31 Dec 2025. Dates after that in the app are projections from earlier years, not observations.
