# Price Dataset — Data-Quality Report

Generated: 2026-10-08T17:45:12+00:00 by `backend/scripts/prepare_price_data.py`

## 1. Raw dataset profile

- Rows: **246,067**
- Columns: Date, State, Market, Commodity, Variety, Arrivals, Min_Price, Max_Price, Modal_Price
- Date range: **2023-01-01 → 2025-12-31** (1091 distinct dates); invalid dates: 0
- States: {'Maharashtra': 246067}
- Distinct markets: **297**
- Missing crop names: 0
- Exact duplicate rows: 0
- Same date/market/commodity/variety duplicates (different prices): 1917
- Arrivals ≤ 0: 0

### Missing values per column

| Column | Missing |
|---|---|
| Date | 0 |
| State | 0 |
| Market | 0 |
| Commodity | 0 |
| Variety | 0 |
| Arrivals | 0 |
| Min_Price | 0 |
| Max_Price | 0 |
| Modal_Price | 0 |

### Invalid prices

| Check | Rows |
|---|---|
| modal_le_0 | 0 |
| min_le_0 | 1 |
| max_le_0 | 0 |
| min_gt_max | 0 |
| modal_outside_min_max | 0 |

### Records, markets and extreme values per crop

| Crop | Records | Markets | Extreme modal prices (>3×IQR) |
|---|---|---|---|
| Wheat | 60,609 | 237 | 1217 |
| Onion | 49,385 | 116 | 81 |
| Tomato | 31,832 | 61 | 840 |
| Brinjal | 29,148 | 56 | 118 |
| Cabbage | 27,218 | 50 | 268 |
| Cauliflower | 26,663 | 50 | 112 |
| Potato | 21,212 | 44 | 14 |

Note: values beyond 3×IQR are not automatically errors — vegetable prices have genuine seasonal spikes (e.g. tomato in mid-2023). See the outlier rule below.

### Varieties per crop

- **Brinjal**: Other (29,148)
- **Cabbage**: Other (27,218)
- **Cauliflower**: Other (26,663)
- **Onion**: Other (25,124), Red (12,142), Local (9,031), 1st Sort (1,000), White (929), Pole (625), 2nd Sort (436), Hybrid (98)
- **Potato**: Other (13,467), Local (7,745)
- **Tomato**: Other (21,262), Local (10,570)
- **Wheat**: Other (45,784), Maharashtra 2189 (9,005), Sharbati (3,355), Bansi (1,091), Kalyan (752), 147 Average (603), Red (19)

### Highest modal prices in raw data

| Date | Market | Crop | Variety | Modal price (₹/qtl) |
|---|---|---|---|---|
| 2023-02-23 | Junnar(Alephata) | Onion | Other | 75,000 |
| 2024-10-14 | APMC Ratnagiri (Nachane) | Tomato | Other | 45,000 |
| 2025-08-19 | Junnar(Alephata) | Onion | Other | 25,000 |
| 2024-03-01 | APMC Kalyan | Onion | 1st Sort | 21,000 |
| 2024-10-14 | APMC Ratnagiri (Nachane) | Cabbage | Other | 20,000 |
| 2023-07-26 | APMC Shrirampur | Tomato | Other | 19,000 |
| 2023-07-23 | APMC Shrirampur | Tomato | Other | 18,000 |
| 2023-07-21 | APMC Shrirampur | Tomato | Other | 17,500 |
| 2023-07-27 | APMC Shrirampur | Tomato | Other | 17,500 |
| 2024-02-18 | APMC Pune | Potato | Local | 16,000 |

## 2. Cleaning steps (in order)

| Step | Rows affected | Rows after | Decision |
|---|---|---|---|
| load | 0 | 246,067 | Rows read from raw price files |
| invalid_dates | 0 | 246,067 | Rows whose Date could not be parsed were removed |
| missing_key_fields | 0 | 246,067 | Rows missing state/market/commodity/variety/modal price were removed |
| non_positive_modal_price | 0 | 246,067 | Rows with Modal_Price <= 0 were removed (a price cannot be zero or negative) |
| non_positive_min_price | 1 | 246,067 | Min_Price <= 0 set to missing; row kept because Modal_Price is valid. Min_Price is not a model input |
| exact_duplicates | 0 | 246,067 | Exact duplicate rows removed |
| same_day_duplicates | 3,834 | 244,150 | 1917 date/market/commodity/variety groups had several rows with different prices; merged into one row using the median price. Arrivals were averaged, not summed, because within most groups the arrival figure is repeated identically |
| outlier_capping | 610 | 244,150 | Modal prices more than 4x above or below the median of the previous 15 observations of the same series were capped to that bound (rows kept; original value preserved in Modal_Price_raw) |

Net rows removed or merged: **1,917 (0.78%)**. No large portion of the data was discarded.

## 3. Forecastability of series

A market series is offered for forecasting when it has at least 180 reported days. A state-level reference series (median across all markets) is also built per crop.

| Crop | Market series | Supported (≥ 180 days) | Median coverage of days |
|---|---|---|---|
| Brinjal | 56 | 44 | 61% |
| Cabbage | 50 | 40 | 64% |
| Cauliflower | 50 | 39 | 64% |
| Onion | 197 | 98 | 26% |
| Potato | 64 | 33 | 48% |
| Tomato | 69 | 49 | 66% |
| Wheat | 274 | 117 | 20% |

State-level reference series:

- Brinjal: 1086 reported days, 2023-01-01 → 2025-12-31
- Cabbage: 1086 reported days, 2023-01-01 → 2025-12-31
- Cauliflower: 1086 reported days, 2023-01-01 → 2025-12-31
- Onion: 1088 reported days, 2023-01-01 → 2025-12-31
- Potato: 1086 reported days, 2023-01-01 → 2025-12-31
- Tomato: 1086 reported days, 2023-01-01 → 2025-12-31
- Wheat: 1090 reported days, 2023-01-01 → 2025-12-31

## 4. Notes and limitations

- The file is already named *Cleaned*; its upstream cleaning is undocumented. About 0.3% of Arrivals values look averaged (e.g. 152.666667).
- Only one state (Maharashtra) is present, so State carries no predictive information and is not a model feature.
- Markets do not report every day; prices are carried forward at most 7 days and longer gaps are left missing rather than interpolated.
- Data ends on 2025-12-31; forecasts are made *as of* a date inside the dataset, never for dates after the last available price without new data.