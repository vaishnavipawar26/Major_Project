# Price model inputs

Generated from `backend/app/ml/price_prediction/feature_catalog.py` (checked by `tests/test_price_features.py`).
"Origin" is the last day with a reported price (t); the target date is t + h.

| Feature | Definition | Units | Input columns | Available at origin | Available for target date | Missing-value handling | Leakage risk |
|---|---|---|---|---|---|---|---|
| `log_price` | ln of the price at the origin (modal price, carried forward <= 7 days) | ln(Rs/quintal) | Modal_Price | Yes (data <= t) | No (unknown) | origin must have a reported price | None: price at t is known at t |
| `lag_1_change` | ln(price_t / price_{t-1}) | log ratio | Modal_Price | Yes (data <= t) | No | NaN if the 30-day window has a gap > 7 days; such origins are not used | None: only past prices |
| `lag_3_change` | ln(price_t / price_{t-3}) | log ratio | Modal_Price | Yes (data <= t) | No | NaN if the 30-day window has a gap > 7 days; such origins are not used | None |
| `lag_7_change` | ln(price_t / price_{t-7}) | log ratio | Modal_Price | Yes (data <= t) | No | NaN if the 30-day window has a gap > 7 days; such origins are not used | None |
| `lag_14_change` | ln(price_t / price_{t-14}) | log ratio | Modal_Price | Yes (data <= t) | No | NaN if the 30-day window has a gap > 7 days; such origins are not used | None |
| `lag_30_change` | ln(price_t / price_{t-30}) | log ratio | Modal_Price | Yes (data <= t) | No | NaN if the 30-day window has a gap > 7 days; such origins are not used | None |
| `roll_mean_7_gap` | ln(price_t) - ln(mean of last 7 days incl. t) | log ratio | Modal_Price | Yes (data <= t) | No | NaN if the 30-day window has a gap > 7 days; such origins are not used | None: window ends at t |
| `roll_mean_14_gap` | as above, 14 days | log ratio | Modal_Price | Yes (data <= t) | No | NaN if the 30-day window has a gap > 7 days; such origins are not used | None |
| `roll_mean_30_gap` | as above, 30 days | log ratio | Modal_Price | Yes (data <= t) | No | NaN if the 30-day window has a gap > 7 days; such origins are not used | None |
| `volatility_30` | std of daily log price changes over the last 30 days (>= 10 values) | log ratio per day | Modal_Price | Yes (data <= t) | No | NaN if the 30-day window has a gap > 7 days; such origins are not used | None |
| `momentum_7_30` | ln(7-day mean) - ln(30-day mean) | log ratio | Modal_Price | Yes (data <= t) | No | NaN if the 30-day window has a gap > 7 days; such origins are not used | None |
| `pct_change_7` | exp(lag_7_change) - 1 (same information as lag_7_change) | fraction | Modal_Price | Yes (data <= t) | No | NaN if the 30-day window has a gap > 7 days; such origins are not used | None; redundant with lag_7_change (kept for continuity of saved models) |
| `spread_ratio` | ln(Max_Price) - ln(Min_Price) on the latest day, carried <= 7 days | log ratio | Min_Price, Max_Price | Yes (data <= t) | No | NaN if Min/Max missing | None |
| `log_arrivals` | ln(1 + Arrivals) on the latest reported day, carried <= 7 days | ln(reported units) | Arrivals | Yes (data <= t) | No | NaN if no report within 7 days | None; units not stated by source |
| `arrivals_vs_30d` | log_arrivals minus the mean ln(1 + Arrivals) of the last 30 days (>= 5 values) | log ratio | Arrivals | Yes (data <= t) | No | NaN if < 5 reports | None |
| `state_price_gap` | ln(series price) - ln(state median price of the crop that day) | log ratio | Modal_Price of all markets | Yes (data <= t) | No | NaN if no state price | None: same-day cross-section, known at t |
| `state_change_7` | ln(state median_t) - ln(state median_{t-7}) | log ratio | Modal_Price of all markets | Yes (data <= t) | No | NaN if the 30-day window has a gap > 7 days; such origins are not used | None |
| `month` | calendar month of the origin | 1-12 | Date | Yes (data <= t) | n/a (calendar) | never missing | None |
| `week_of_year` | ISO week of the origin | 1-53 | Date | Yes (data <= t) | n/a | never missing | None |
| `day_of_week` | weekday of the origin | 0-6 | Date | Yes (data <= t) | n/a | never missing | None |
| `season_code` | kharif/rabi/zaid season code of the origin month | category | Date | Yes (data <= t) | n/a | never missing | None |
| `doy_sin` | sin(2 pi * day-of-year / 365.25) of the origin | -1..1 | Date | Yes (data <= t) | n/a | never missing | None |
| `doy_cos` | cos(2 pi * day-of-year / 365.25) of the origin | -1..1 | Date | Yes (data <= t) | n/a | never missing | None |
| `commodity_code` | integer code of the crop (encoder fitted on the panel) | category | Commodity | Yes (data <= t) | n/a | -1 for unseen crop | None |
| `market_code` | integer code of the market (state series has its own code) | category | Market | Yes (data <= t) | n/a | -1 for unseen market | None |
| `variety_code` | integer code of the variety | category | Variety | Yes (data <= t) | n/a | -1 for unseen variety | None |
| `horizon_days` | h, the number of days from origin to target | days (1-60) | chosen by user | Yes (data <= t) | Yes (is the target offset) | never missing | None |
| `target_doy_sin` | sin of the day-of-year of the TARGET date | -1..1 | Date + h | Yes (data <= t) | Yes (calendar) | never missing | None: a calendar position, not a label |
| `target_doy_cos` | cos of the day-of-year of the TARGET date | -1..1 | Date + h | Yes (data <= t) | Yes (calendar) | never missing | None |
| `temp_mean_7` | mean daily temperature of the 7 days ending at t | degC | Open-Meteo archive (reanalysis) | Yes (data <= t) | No | NaN if market unmapped or any day missing | None: window ends at t; observed weather, not a forecast |
| `temp_anom_7` | temp_mean_7 minus the normal temperature for those 7 days | degC | weather + 2015-2022 normals | Yes (data <= t, normals from <= 2022) | No | NaN as above | None: normals use only years <= 2022 |
| `precip_sum_7` | rainfall of the 7 days ending at t | mm | Open-Meteo archive | Yes (data <= t) | No | NaN as above | None |
| `precip_sum_30` | rainfall of the 30 days ending at t | mm | Open-Meteo archive | Yes (data <= t) | No | NaN as above | None |
| `precip_ratio_30` | precip_sum_30 / (normal 30-day rainfall + 10 mm) | ratio | weather + 2015-2022 normals | Yes | No | NaN as above | None |
| `humidity_mean_7` | mean daily relative humidity of the 7 days ending at t | % | Open-Meteo archive | Yes (data <= t) | No | NaN as above | None |
