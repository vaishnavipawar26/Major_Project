# Price forecast backtest (Phase 1)

Generated 2026-10-23T05:59:11+00:00 · production model `202610170304` · data 2023-01-01 … 2025-12-31 · inflation assumption 5 %

Read-only: models were re-fitted in memory with the production architecture; nothing in the pipeline, model files, database or frontend was changed. Prices are ₹/quintal.

## 1. Current baseline (Phase 0 snapshot, as reported by the production CV)

Model version `202610170304`, horizon → model: 1-12: xgb_rate, 13-35: rf_rate, 36-60: rf_plain.

| horizon | model MAE | no-change MAE | reported direction acc % |
|---|---|---|---|
| all | 400.0 | 406.5 | 54.9 |
| 1 | 129.3 | 123.5 | 32.4 |
| 7 | 266.2 | 278.2 | 51.5 |
| 14 | 341.7 | 351.3 | 52.1 |
| 21 | 391.2 | 390.0 | 53.8 |
| 30 | 433.5 | 427.3 | 55.8 |
| 45 | 493.0 | 499.3 | 58.2 |
| 60 | 512.7 | 524.4 | 60.0 |

Saved in `price_baseline_snapshot.json` together with model-file hashes and sample forecasts.

## 2. Method

* **Time order.** Fit A uses pairs whose *target* date is before 2025-01-01; fit B before 2025-07-01. Validation origins are 2025-01…06 (interval calibration, diagnostics); test origins are 2025-07…12 (final scores). The training code asserts that no training target date reaches the cut-off.
* **Information at the origin.** Features come from the existing code (data ≤ origin). Baselines use only earlier prices: the year-ago price at (target − 365 days) is always before the origin.
* **Same cases for all methods.** A case is kept only when every method is defined (a year-ago price, a seasonal ratio from ≥ 1 earlier year, an actual target price).
* **Direction accuracy** counts only cases where the actual price moved more than 5 % from the start price; `up share` is the share of those that went up (a method that always says “up” would score that).
* **Skill** = 1 − MAE_model / MAE_baseline; its 95 % interval comes from resampling origin *weeks*, which keeps the strong correlation between neighbouring days.
* **The three forecasting methods are scored separately and never pooled:** (1) the trained model on real-origin data, (2) the trained model on the production *projection* path, (3) the production *historical projection* (`forecaster._forecast_baseline`, no model). Sections 3, 4 and 5.
* **WAPE** = 100 × Σ|forecast − actual| / Σ actual, summed over the cases of a row. A zero actual price would make single-case percentages undefined, which is why WAPE (not MAPE) is used; the script also asserts that every observed price is > 0 (the cleaning step already removed non-positive modal prices), so nothing needs to be excluded or imputed.
* **MAE** = mean |forecast − actual| in ₹/quintal. **Truth** = the cleaned modal price (outlier-capped, see section 6).
* **Horizon bands** 1–7, 8–14, 15–30, 31–60 days, plus exact horizons 1, 7, 14, 30, 60 (n is printed in every table).

### Exactly what was evaluated

| id | what |
|---|---|
| trained_model (real-origin) | Production architecture re-fitted in memory (xgb_rate 1–12 d, rf_rate 13–35 d, rf_plain 36–60 d, same hyper-parameters), fit B for the test. Start price = last reported price. |
| trained_model (projection) | Same architecture, fit A. Features of the same day one year earlier, start price = that price × 1.05. |
| historical_projection | forecaster._forecast_baseline logic: median of last 10 reports × level × median seasonal ratio (±10-day windows, up to 3 earlier years); its own displayed range ±1.2816 × weekly log-spread × √(h/7). |
| no_change / latest_known | Latest reported price carried forward. |
| reference_x1.05 | Projection path with model ratio = 1 (the start price itself). |
| year_ago_x1.05 | Price one year before the target date × 1.05. |
| seasonal_naive | Price change over the same days one year earlier (train_price_model.py's baseline). |
| seasonal_ratio | Median seasonal change of earlier years applied to the start price (the serving fallback ratio). |


## 3. REAL-ORIGIN forecasts (forecast from the market's own recent prices)

This is what the production cross-validation measures. Start price = the last reported price. Baselines: **no_change** (latest price), **year_ago_x1.05** (price one year before the target date × 1.05), **seasonal_naive** (the price change of the same days one year earlier, used by train_price_model.py), **seasonal_ratio** (the serving fallback: median change over earlier years, ±10-day windows).

Test cases: 149,426 · validation cases: 149,444

**Test period, all cases**

| method | n | MAE | WAPE_pct | direction_acc_pct | n_meaningful | up_share_of_meaningful_pct |
|---|---|---|---|---|---|---|
| model | 149426 | 444.1 | 22.3 | 62.8 | 104397 | 49.6 |
| no_change | 149426 | 464.9 | 23.4 | – | 104397 | 49.6 |
| year_ago_x1.05 | 149426 | 1,131.6 | 56.9 | 60.7 | 104397 | 49.6 |
| seasonal_naive | 149426 | 729.5 | 36.7 | 45.1 | 104397 | 49.6 |
| seasonal_ratio | 149426 | 582.4 | 29.3 | 48.8 | 104397 | 49.6 |

**Validation period, all cases (for reference)**

| method | n | MAE | WAPE_pct | direction_acc_pct |
|---|---|---|---|---|
| model | 149444 | 367.8 | 21.3 | 69.3 |
| no_change | 149444 | 370.1 | 21.5 | – |
| year_ago_x1.05 | 149444 | 659.6 | 38.2 | 68.0 |
| seasonal_naive | 149444 | 539.1 | 31.3 | 52.0 |
| seasonal_ratio | 149444 | 493.8 | 28.6 | 59.2 |

**Does the model beat each baseline? (test)**

* model is statistically indistinguishable from **no_change** (MAE skill +4.5 %, 95 % CI -0.3 … +8.9 %)
* model beats **year_ago_x1.05** (MAE skill +60.8 %, 95 % CI +57.5 … +63.4 %)
* model beats **seasonal_naive** (MAE skill +39.1 %, 95 % CI +34.8 … +42.6 %)
* model beats **seasonal_ratio** (MAE skill +23.7 %, 95 % CI +19.5 … +27.9 %)

**By forecast horizon band – MAE (test)**

| band (days) | model | no_change | year_ago_x1.05 | seasonal_naive | seasonal_ratio | n |
|---|---|---|---|---|---|---|
| 1-7 | 245.9 | 256.0 | 1,119.7 | 401.9 | 281.1 | 21455 |
| 8-14 | 371.7 | 390.8 | 1,123.4 | 583.0 | 450.3 | 19707 |
| 15-30 | 461.4 | 477.4 | 1,117.1 | 739.1 | 606.3 | 41826 |
| 31-60 | 518.6 | 546.4 | 1,147.1 | 872.8 | 703.7 | 66438 |

**Exact forecast horizons: test MAE, n, and the shipped 80 % range (coverage / mean width)**

| horizon (days) | n | model | no_change | year_ago_x1.05 | seasonal_naive | seasonal_ratio | range coverage % | range width % of start |
|---|---|---|---|---|---|---|---|---|
| 1 | 3210 | 152.5 | 147.9 | 1,109.4 | 264.1 | 159.6 | 87.3 | 35.1 |
| 7 | 2986 | 315.4 | 329.8 | 1,124.3 | 507.9 | 372.1 | 80.3 | 50.2 |
| 14 | 2682 | 421.0 | 437.4 | 1,128.2 | 649.6 | 523.0 | 79.6 | 64.1 |
| 30 | 2507 | 505.2 | 515.2 | 1,121.3 | 849.4 | 700.7 | 80.1 | 78.6 |
| 60 | 1982 | 547.9 | 562.9 | 1,164.2 | 910.1 | 694.9 | 83.9 | 90.9 |

Model skill vs no_change by band:

* 1-7 days: +3.9 % (95 % CI +1.5 … +6.0)
* 8-14 days: +4.9 % (95 % CI +0.1 … +9.2)
* 15-30 days: +3.4 % (95 % CI -1.7 … +7.6)
* 31-60 days: +5.1 % (95 % CI -1.8 … +11.0)

**By crop – MAE and direction accuracy (test)**

| crop | n | model MAE | no_change MAE | year_ago_x1.05 MAE | seasonal_naive MAE | seasonal_ratio MAE | model dir. acc % |
|---|---|---|---|---|---|---|---|
| Brinjal | 20144 | 1,051.1 | 1,143.0 | 1,246.5 | 1,753.5 | 1,537.3 | 64.6 |
| Cabbage | 19493 | 299.5 | 340.5 | 478.4 | 407.6 | 353.8 | 67.3 |
| Cauliflower | 18591 | 496.2 | 615.8 | 814.1 | 802.7 | 666.6 | 72.8 |
| Onion | 27295 | 298.3 | 189.4 | 2,411.7 | 358.6 | 351.7 | 47.7 |
| Potato | 14724 | 165.3 | 175.1 | 1,135.9 | 214.9 | 185.5 | 63.5 |
| Tomato | 22707 | 756.2 | 806.9 | 1,272.0 | 1,465.0 | 935.0 | 63.2 |
| Wheat | 26472 | 89.7 | 86.2 | 305.6 | 174.0 | 120.9 | 66.2 |

**Crop × horizon-band cells (n ≥ 100):** 28 cells; model beats no_change in 22, year_ago_x1.05 in 28, seasonal_naive in 28, seasonal_ratio in 28; beats **all** baselines in 22.

**Uncertainty interval (nominal 80 %) – actual coverage on the test period**

| interval | coverage_pct | below_pct | above_pct | mean_width_pct_of_start_price | n |
|---|---|---|---|---|---|
| production_intervals_as_shipped | 81.6 | 8.8 | 9.6 | 73.2 | 149426 |
| recalibrated_on_validation_only | 79.3 | 9.0 | 11.7 | 70.0 | 149426 |

Production interval coverage by band: 1-7: 82 %, 8-14: 80 %, 15-30: 80 %, 31-60: 83 %

**Model-selection check (test MAE by horizon band).** The production horizon→model assignment was chosen on all of 2025, so it has seen the test period; this shows how each candidate fares out of sample:

| band | rf_plain | rf_rate | xgb_rate | assigned | no_change |
|---|---|---|---|---|---|
| 1-7 | 278.0 | 254.4 | 245.9 | 245.9 | 256.0 |
| 8-14 | 380.9 | 376.0 | 372.1 | 371.7 | 390.8 |
| 15-30 | 467.2 | 461.4 | 470.9 | 461.4 | 477.4 |
| 31-60 | 520.0 | 534.3 | 551.5 | 518.6 | 546.4 |

*Leak size:* the shipped production models (trained on all data, including this test period) score MAE 363.7 on these same cases – compare with 444.1 for the properly held-out refit. That gap is why reported in-sample figures must not be used as accuracy.

## 4. PROJECTION forecasts (the production path while the data are out of date)

Simulates a user in 2025 whose data end 2024-12-31: features and prices of the same day in **2024** are used, start price = that 2024 price × 1.05, and the model's ratio is applied to it (as `forecaster._forecast_model` does with `years_ahead = 1`). The truth is the actual 2025 price. Direction is measured against the app's (synthetic) start price. Baselines: **reference_x1.05** (the start price itself, i.e. the model with ratio 1 – the fair “no change” for this path), **latest_known** (the last price actually observed by 2024-12-31), **year_ago_x1.05** (assume 2025 repeats the realised 2024 change) and **seasonal_ratio**. Test origins per month: {7: 26344, 8: 27170, 9: 25518, 10: 24836, 11: 16696, 12: 6580}. Only one year pair (2024→2025) exists, so this is a single replication of the annual pattern.

Test cases: 127,144 · validation cases: 132,258

**Test period, all cases**

| method | n | MAE | WAPE_pct | direction_acc_pct | n_meaningful | up_share_of_meaningful_pct |
|---|---|---|---|---|---|---|
| model | 127144 | 1,010.1 | 50.6 | 55.4 | 112127 | 20.2 |
| reference_x1.05 | 127144 | 1,090.1 | 54.7 | – | 112127 | 20.2 |
| latest_known | 127144 | 1,031.7 | 51.7 | – | 112127 | 20.2 |
| year_ago_x1.05 | 127144 | 1,124.7 | 56.4 | 51.3 | 112127 | 20.2 |
| seasonal_ratio | 127144 | 1,476.6 | 74.0 | 37.7 | 112127 | 20.2 |

**Validation period, all cases (for reference)**

| method | n | MAE | WAPE_pct | direction_acc_pct |
|---|---|---|---|---|
| model | 132258 | 606.3 | 35.5 | 60.1 |
| reference_x1.05 | 132258 | 626.5 | 36.7 | – |
| latest_known | 132258 | 680.0 | 39.8 | – |
| year_ago_x1.05 | 132258 | 660.8 | 38.7 | 55.6 |
| seasonal_ratio | 132258 | 1,059.0 | 62.0 | 34.5 |

**Does the model beat each baseline? (test)**

* model beats **reference_x1.05** (MAE skill +7.3 %, 95 % CI +4.4 … +10.4 %)
* model is statistically indistinguishable from **latest_known** (MAE skill +2.1 %, 95 % CI -1.9 … +6.8 %)
* model beats **year_ago_x1.05** (MAE skill +10.2 %, 95 % CI +8.4 … +11.9 %)
* model beats **seasonal_ratio** (MAE skill +31.6 %, 95 % CI +25.5 … +36.7 %)

**By forecast horizon band – MAE (test)**

| band (days) | model | reference_x1.05 | latest_known | year_ago_x1.05 | seasonal_ratio | n |
|---|---|---|---|---|---|---|
| 1-7 | 1,054.3 | 1,102.2 | 1,018.1 | 1,110.1 | 1,123.0 | 18515 |
| 8-14 | 1,014.3 | 1,095.5 | 1,001.5 | 1,103.3 | 1,199.5 | 16886 |
| 15-30 | 997.4 | 1,084.5 | 1,023.8 | 1,114.8 | 1,403.4 | 35651 |
| 31-60 | 1,002.3 | 1,087.9 | 1,050.2 | 1,142.3 | 1,723.4 | 56092 |

**Exact forecast horizons: test MAE, n, and the shipped 80 % range (coverage / mean width)**

| horizon (days) | n | model | reference_x1.05 | latest_known | year_ago_x1.05 | seasonal_ratio | range coverage % | range width % of start |
|---|---|---|---|---|---|---|---|---|
| 1 | 2828 | 1,099.9 | 1,116.9 | 1,043.2 | 1,118.4 | 1,121.3 | 23.7 | 36.1 |
| 7 | 2533 | 1,022.1 | 1,100.1 | 985.1 | 1,111.2 | 1,143.3 | 32.4 | 49.9 |
| 14 | 2363 | 998.3 | 1,082.7 | 995.2 | 1,102.4 | 1,225.5 | 39.7 | 63.0 |
| 30 | 2150 | 972.4 | 1,062.1 | 1,032.2 | 1,124.5 | 1,549.6 | 48.7 | 75.8 |
| 60 | 1606 | 999.6 | 1,080.5 | 1,083.4 | 1,124.3 | 1,741.1 | 57.3 | 84.4 |

Model skill vs reference_x1.05 by band:

* 1-7 days: +4.3 % (95 % CI +3.5 … +5.2)
* 8-14 days: +7.4 % (95 % CI +5.1 … +10.1)
* 15-30 days: +8.0 % (95 % CI +4.8 … +11.2)
* 31-60 days: +7.9 % (95 % CI +2.7 … +13.0)

**By crop – MAE and direction accuracy (test)**

| crop | n | model MAE | reference_x1.05 MAE | latest_known MAE | year_ago_x1.05 MAE | seasonal_ratio MAE | model dir. acc % |
|---|---|---|---|---|---|---|---|
| Brinjal | 17870 | 1,159.3 | 1,257.4 | 2,072.8 | 1,284.3 | 1,792.4 | 67.9 |
| Cabbage | 17319 | 451.8 | 585.7 | 416.5 | 480.5 | 641.9 | 72.3 |
| Cauliflower | 16803 | 672.3 | 876.0 | 1,139.2 | 830.3 | 956.5 | 73.0 |
| Onion | 22324 | 2,222.9 | 2,177.4 | 1,568.8 | 2,389.1 | 2,893.1 | 32.9 |
| Potato | 13046 | 1,151.4 | 1,190.7 | 439.8 | 1,125.5 | 1,184.4 | 44.4 |
| Tomato | 18514 | 980.8 | 1,160.4 | 1,142.6 | 1,256.9 | 2,246.7 | 60.3 |
| Wheat | 21268 | 272.0 | 265.0 | 275.6 | 305.1 | 324.0 | 44.0 |

**Crop × horizon-band cells (n ≥ 100):** 28 cells; model beats reference_x1.05 in 25, latest_known in 14, year_ago_x1.05 in 26, seasonal_ratio in 28; beats **all** baselines in 13.

**Uncertainty interval (nominal 80 %) – actual coverage on the test period**

| interval | coverage_pct | below_pct | above_pct | mean_width_pct_of_start_price | n |
|---|---|---|---|---|---|
| production_intervals_as_shipped | 45.3 | 49.3 | 5.4 | 69.8 | 127144 |
| recalibrated_on_projection_validation_only | 58.6 | 28.7 | 12.7 | 78.5 | 127144 |

Production interval coverage by band: 1-7: 27 %, 8-14: 37 %, 15-30: 46 %, 31-60: 53 %

## 5. Production historical projection (`_forecast_baseline`), evaluated on its own

This is the fallback the application uses when no trained model can run. It is **not** the trained model and is not validated by the sections above. Each timing is scored on its own random subset; the trained model and a no-change reference are scored on exactly the same cases only for comparison.

### 5a. Real-origin timing (start from the latest reported price, level ×1.00)

n = 30,000 test cases.

| method | n | MAE | WAPE_pct | direction_acc_pct | n_meaningful |
|---|---|---|---|---|---|
| historical_projection | 30000 | 570.0 | 28.7 | 48.6 | 21179 |
| trained_model | 30000 | 447.9 | 22.5 | 63.2 | 21049 |
| no_change | 30000 | 467.6 | 23.5 | – | 21049 |
| year_ago_x1.05 | 30000 | 1,136.9 | 57.2 | 61.1 | 21049 |

* model is WORSE than **no_change** (MAE skill -21.9 %, 95 % CI -29.4 … -14.9 %)
* model is WORSE than **the trained model** (MAE skill -27.2 %, 95 % CI -36.8 … -19.2 %)

Its displayed 80 % range – actual coverage:

| scope | coverage_pct | below_pct | above_pct | mean_width_pct_of_forecast | n |
|---|---|---|---|---|---|
| all | 78.5 | 11.0 | 10.5 | 98.4 | 30000 |
| 1-7 days | 65.9 | 18.4 | 15.7 | 33.9 | 4233 |
| 8-14 days | 75.9 | 12.9 | 11.2 | 60.8 | 3914 |
| 15-30 days | 78.7 | 11.1 | 10.3 | 90.0 | 8482 |
| 31-60 days | 83.2 | 8.0 | 8.7 | 135.2 | 13371 |
| h = 1 | 55.3 | 24.8 | 19.9 | 17.7 | 642 |
| h = 7 | 69.3 | 16.9 | 13.8 | 48.0 | 573 |
| h = 14 | 76.0 | 11.9 | 12.1 | 69.8 | 529 |
| h = 30 | 78.4 | 10.1 | 11.5 | 112.2 | 514 |
| h = 60 | 86.2 | 8.2 | 5.6 | 161.8 | 392 |

By crop (MAE):

| crop | n | historical_projection | trained_model | no_change |
|---|---|---|---|---|
| Brinjal | 4083 | 1,442.9 | 1,069.1 | 1,149.8 |
| Cabbage | 3972 | 329.0 | 297.3 | 336.7 |
| Cauliflower | 3669 | 645.5 | 489.8 | 628.1 |
| Onion | 5497 | 358.9 | 305.9 | 194.0 |
| Potato | 2947 | 177.9 | 165.9 | 176.5 |
| Tomato | 4531 | 978.3 | 761.1 | 804.9 |
| Wheat | 5301 | 113.7 | 89.9 | 86.3 |


### 5b. Projection timing (2024 reference, level ×1.05, truth = actual 2025)

n = 30,000 test cases.

| method | n | MAE | WAPE_pct | direction_acc_pct | n_meaningful |
|---|---|---|---|---|---|
| historical_projection | 30000 | 1,427.4 | 71.6 | 38.0 | 26397 |
| trained_model | 30000 | 1,015.3 | 50.9 | 55.2 | 26447 |
| reference_x1.05 | 30000 | 1,093.2 | 54.8 | – | 26447 |
| year_ago_x1.05 | 30000 | 1,134.3 | 56.9 | 51.3 | 26447 |

* model is WORSE than **reference_x1.05** (MAE skill -30.6 %, 95 % CI -41.7 … -21.0 %)
* model is WORSE than **the trained model** (MAE skill -40.6 %, 95 % CI -51.7 … -28.7 %)

Its displayed 80 % range – actual coverage:

| scope | coverage_pct | below_pct | above_pct | mean_width_pct_of_forecast | n |
|---|---|---|---|---|---|
| all | 42.9 | 49.7 | 7.4 | 98.5 | 30000 |
| 1-7 days | 22.3 | 66.2 | 11.5 | 35.3 | 4395 |
| 8-14 days | 35.6 | 56.6 | 7.7 | 61.4 | 4002 |
| 15-30 days | 43.8 | 49.8 | 6.4 | 90.8 | 8429 |
| 31-60 days | 51.5 | 41.9 | 6.6 | 135.9 | 13174 |
| h = 1 | 11.1 | 72.8 | 16.0 | 18.2 | 655 |
| h = 7 | 27.6 | 64.2 | 8.2 | 49.6 | 598 |
| h = 14 | 36.2 | 57.3 | 6.5 | 69.7 | 588 |
| h = 30 | 47.9 | 46.8 | 5.3 | 111.8 | 511 |
| h = 60 | 57.3 | 37.0 | 5.7 | 163.8 | 349 |

By crop (MAE):

| crop | n | historical_projection | trained_model | reference_x1.05 |
|---|---|---|---|---|
| Brinjal | 4247 | 1,795.5 | 1,176.6 | 1,278.4 |
| Cabbage | 3980 | 601.9 | 446.7 | 583.3 |
| Cauliflower | 3989 | 891.6 | 670.4 | 872.8 |
| Onion | 5271 | 2,819.2 | 2,229.6 | 2,184.7 |
| Potato | 3118 | 1,182.8 | 1,147.1 | 1,186.6 |
| Tomato | 4364 | 2,100.6 | 988.2 | 1,149.3 |
| Wheat | 5031 | 304.0 | 272.3 | 265.2 |


## 6. Data-leakage and data-handling audit

**Measured – feature-cut test.** Features were recomputed on a panel cut at a date and compared with the features of the full panel for every row up to that date. A mismatch would mean a feature depends on later data.

| cut date | rows compared | values compared | mismatching values | features affected |
|---|---|---|---|---|
| 2024-06-30 | 314539 | 8178014 | 0 | none |
| 2025-03-31 | 484541 | 12598066 | 0 | none |
| 2025-09-30 | 590567 | 15354742 | 0 | none |


**Checked by code inspection (not re-measured):**

| Item | Finding |
|---|---|
| Future prices | Lags, rolling means, volatility use `price_ffill` backwards only. Targets (`target_price`) are used only as labels. Training pairs require target date < cut-off (asserted). |
| Future arrivals | `log_arrivals`, `arrivals_vs_30d` use arrivals up to the origin day (forward-fill ≤ 7 days, backward rolling mean). No arrivals forecast exists or is needed. |
| Future weather | The deployed model has no weather inputs; no weather is used anywhere in this backtest. |
| State-median feature | `state_price` is the median over markets **on the same day**; known at the origin, not later. |
| Encoders | Crop / market / variety integer codes are fitted on the whole panel. They carry no price information; harmless for leakage. |
| Scaling | No feature scaling is used (tree models). |
| Model selection | **Leaks.** The horizon→model assignment and the shipped residual intervals were chosen on all four 2025 quarters, which include this test period. This backtest keeps the assignment (as the task requires) but re-fits and re-calibrates on earlier data; section 3 shows the assignment still holds out of sample. |
| Shipped models | The files in `trained_models/` were trained on all data through 2025-12-31, so scoring them on 2025 is in-sample (section 3 quantifies the gap). They are not used for the held-out scores. |
| Missing dates | The panel is re-indexed to a daily calendar. A price is carried forward at most 7 days (features) / 3 days (target); a longer gap stays missing and that origin is not used. |
| Duplicates | 3,834 raw rows (1,917 same-day groups with different prices) were merged to their median at cleaning; arrivals were averaged. No exact duplicates existed. |
| Outliers | 610 modal prices (> 4× / < ¼ of the trailing 15-report median) were **capped** at cleaning; the capped value is both an input and the truth in this backtest. |
| Inflation | A constant 5 %/yr (`DEFAULT_INFLATION`), applied only to the start price at serving time, never in training; it is not estimated from the data. |
| Size | 634,609 daily panel rows, 251,758 observed, 219,941 usable origins, 767 series; smallest observed price ₹6/q. |

**Limitation from the data ending 2025-12-31:** no 2026 price exists, so the application's 2026 forecasts can never be scored against actual prices; the 2024→2025 projection test is the only available proxy and it is a single year pair.

## 7. Which approach was best on unseen dates, and is the production approach supported?

* **Real-origin, lowest MAE:** model (trained model MAE 444, no-change 465). model is statistically indistinguishable from **no change** (MAE skill +4.5 %, 95 % CI -0.3 … +8.9 %).
* **Projection, lowest MAE:** model. Trained model: model beats **reference × 1.05** (MAE skill +7.3 %, 95 % CI +4.4 … +10.4 %); model is statistically indistinguishable from **the latest known price** (MAE skill +2.1 %, 95 % CI -1.9 … +6.8 %).
* **Production historical projection:** real-origin timing model is WORSE than **no change** (MAE skill -21.9 %, 95 % CI -29.4 … -14.9 %); projection timing model is WORSE than **reference × 1.05** (MAE skill -30.6 %, 95 % CI -41.7 … -21.0 %).
* **Shipped 80 % ranges, actual coverage:** trained model real-origin 82 %, trained model projection 45 %, historical projection 79 % (real-origin) / 43 % (projection).

**Reading (derived from the numbers above):** the trained model is NOT shown to beat no-change on real-origin forecasts; on the projection path it does clearly beat a plain replay of last year × 1.05 and does not clearly beat the latest known price; the historical projection does not clearly beat the reference. Ranges are NOT close to 80 % in both trained-model scenarios.

## 8. Problems found in the current pipeline

**Measured**

1. Projection-path ranges cover 45 % of actual prices instead of 80 % (49 % fall below the range).
2. Projection-path MAE (1010) is more than twice the real-origin MAE (444); the reported CV accuracy describes the real-origin task, not what users receive.
3. Real-origin: the model is worse than no-change for Onion, Wheat; projection: worse than the reference for Onion, Wheat.
4. Direction accuracy on projection (55 %) must be read against the base rate: 80 % of meaningful moves were downward in this test year.
5. Shipped (in-sample) models score MAE 364 vs 444 held-out: any accuracy quoted from the shipped models on 2025 data is optimistic.
6. Seasonal baselines (seasonal_naive, seasonal_ratio, year_ago) are much worse than no-change in the real-origin test, so seasonal repetition from 2–3 years of data is a weak forecasting signal.

**Found by code inspection (assumptions to be verified in later phases)**

7. Model-choice per horizon and the interval widths were fitted on all of 2025 (test period included).
8. The 5 % inflation factor is a constant, not estimated from data, and is applied to a one-year-old price.
9. The start price shown in the application during projection is last year's price × 1.05, not a current market price.

## 9. Most important next improvements (recommendations, not measured results)

1. Refresh the price data to the present, so forecasts start from real current prices instead of a one-year-old snapshot.
2. Until then, widen / recalibrate the projection-path range on projection backtest residuals and label the start price and the forecast as a seasonal-scenario estimate.
3. Extend the history before 2023 (if available) to obtain more seasons and re-run this backtest with several year pairs.
4. Treat Onion and Wheat (and long horizons) as not validated; offer the latest-price baseline there.
5. Only after the above, test extra features (nearby markets, arrivals, weather) with this same backtest and keep them only if they win on the held-out period.

## 10. Limitations of this evaluation

* **Three years of data**: one held-out half-year for the real-origin test and a single year pair (2024→2025) for the projection test. Conclusions are suggestive, not strong.
* Confidence intervals resample origin weeks and therefore understate year-to-year uncertainty.
* Fit B / interval mismatch: validation-recalibrated ranges (fit A) are applied to fit-B forecasts.
* Projection test staleness is 6–12 months (2025-H2); today's is about 10 months. The year-ago baseline removes cases whose reference target lies after 2024-12-31, so late-year origins keep only short horizons.
* Pooled MAE is dominated by high-priced crops and many state/wheat series; read the per-crop and per-band tables.
* Markets move together, so the effective sample size is smaller than the case counts.
* The historical-projection range was evaluated on a 30,000-case random subset per timing.
* Weather, arrivals forecasting and new data were deliberately not evaluated.
