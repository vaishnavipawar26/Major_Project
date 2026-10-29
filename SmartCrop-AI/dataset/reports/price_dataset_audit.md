# Price Dataset Audit

Generated 2026-10-28T18:26:30+00:00 by `scripts/audit_price_data.py` (read-only; raw data untouched).

## 1. Size and identity

- Rows: raw **246,067** -> cleaned **244,150** (1,917 merged/removed; per-step counts in `price_data_quality.md`).
- Date coverage: 2023-01-01 to 2025-12-31; 1091 distinct report dates; 5 calendar days with no report from any market.
- Unique crops 7, markets 297, varieties 13, crop-market-variety series 760.
- Exact duplicate rows in raw: 0; same date/market/crop/variety rows (different values): 1917.

## 2. Missing values (% of rows)

| index | raw | cleaned |
|---|---|---|
| Date | 0.00 | 0.00 |
| State | 0.00 | 0.00 |
| Market | 0.00 | 0.00 |
| Commodity | 0.00 | 0.00 |
| Variety | 0.00 | 0.00 |
| Arrivals | 0.00 | 0.00 |
| Min_Price | 0.00 | 0.00 |
| Max_Price | 0.00 | 0.00 |
| Modal_Price | 0.00 | 0.00 |

## 3. Consistency of prices

- Modal price outside [Min, Max] in cleaned data: 296; Min > Max: 0.
- Rows whose modal price was capped by the trailing-median outlier rule: 610 (the original is kept in `Modal_Price_raw`).

Modal price (Rs/quintal) quantiles per crop:

| Commodity | p1 | p25 | p50 | p75 | p99 |
|---|---|---|---|---|---|
| Brinjal | 500.00 | 1,500.00 | 2,100.00 | 3,000.00 | 6,500.00 |
| Cabbage | 275.00 | 700.00 | 1,000.00 | 1,300.00 | 3,000.00 |
| Cauliflower | 400.00 | 1,000.00 | 1,500.00 | 2,150.00 | 5,000.00 |
| Onion | 475.00 | 1,050.00 | 1,450.00 | 2,250.00 | 4,900.00 |
| Potato | 800.00 | 1,300.00 | 1,600.00 | 2,000.00 | 3,200.00 |
| Tomato | 350.00 | 950.00 | 1,400.00 | 2,305.00 | 8,500.00 |
| Wheat | 2,000.00 | 2,400.00 | 2,550.00 | 2,750.00 | 4,400.00 |

## 4. Arrivals

Arrivals quantiles per crop (units as reported by the source; the file does not state them):

| Commodity | p1 | p25 | p50 | p75 | p99 | missing_pct | zero_or_neg |
|---|---|---|---|---|---|---|---|
| Brinjal | 0.20 | 1.40 | 3.00 | 8.00 | 66.00 | 0.00 | 0 |
| Cabbage | 0.20 | 1.80 | 4.20 | 17.00 | 180.20 | 0.00 | 0 |
| Cauliflower | 0.30 | 2.00 | 5.00 | 32.00 | 3,942.10 | 0.00 | 0 |
| Onion | 0.30 | 24.80 | 166.00 | 620.60 | 3,567.00 | 0.00 | 0 |
| Potato | 0.20 | 3.00 | 23.50 | 92.00 | 1,250.00 | 0.00 | 0 |
| Tomato | 0.30 | 3.00 | 8.90 | 43.10 | 883.00 | 0.00 | 0 |
| Wheat | 0.10 | 1.50 | 4.00 | 12.50 | 434.00 | 0.00 | 0 |

## 5. Irregular series and gaps

- Median share of days a series reports between its first and last date: 35%.
- Series with a gap longer than 30 days: 412 of 760.
- Gaps are never filled with prices: the model panel carries a price forward at most 7 days, and any forecast origin whose lag windows touch a longer gap is not used.

| Commodity | series | median_obs | median_coverage | series_with_gap_gt30 | series_under_180_obs |
|---|---|---|---|---|---|
| Brinjal | 56 | 576.00 | 0.61 | 20 | 12 |
| Cabbage | 50 | 686.00 | 0.64 | 16 | 10 |
| Cauliflower | 50 | 657.00 | 0.63 | 16 | 11 |
| Onion | 197 | 173.00 | 0.26 | 136 | 99 |
| Potato | 64 | 222.00 | 0.47 | 22 | 31 |
| Tomato | 69 | 458.00 | 0.66 | 23 | 20 |
| Wheat | 274 | 127.00 | 0.20 | 179 | 157 |

Share of reports by weekday (Mon=0): 0: 14.9%, 1: 15.6%, 2: 15.4%, 3: 16.2%, 4: 14.7%, 5: 14.1%, 6: 9.1%

## 6. Limitations and recommended fixes

- **Short history (3 years).** Seasonal comparisons rest on 1-2 earlier years. Add Agmarknet downloads for 2018-2022 with the same columns (Date, State, Market, Commodity, Variety, Arrivals, Min/Max/Modal price) to `dataset/raw/`, then rerun `prepare_price_data`. Do not fabricate rows.
- **Sparse markets.** Many markets report on fewer than half of days; only series with enough reports are offered.
- **Arrivals units and aggregation unknown.** Same-day duplicate arrivals were averaged (repeated figures), so arrivals may be under- or over-stated for some yards.
- **Price outliers are capped, not removed.** The cap uses only past prices, so it can be applied to live data.
- **No weather in the price file.** Weather is joined separately from Open-Meteo (see `weather_data_quality.md`).
- **Variety spelling** is used as given; near-duplicate variety names were not merged.