# Phase 2 candidate model: backtest (final)

Generated 2026-10-23T06:24:34+00:00 · compared with production model `202610170304` · ₹/quintal · same chronological splits as Phase 1.

## 0. Summary (all derived from the tables below)

* Real-origin test (149,426 cases): candidate beats **no change** (skill +9.9 %, 95 % CI +5.9 … +14.0); candidate beats **the production-feature model (re-fitted)** (skill +5.6 %, 95 % CI +3.8 … +7.6).
* Projection test (127,197 cases, chosen anchor `ref_x1.05 (current)`): candidate beats **reference ×1.05** (skill +6.2 %, 95 % CI +4.1 … +8.6); candidate is not distinguishable from **latest known price** (skill +0.9 %, 95 % CI -2.0 … +3.7).
* 80 % ranges: real-origin candidate 80 % covered (production-feature model with shipped ranges 82 %); projection candidate 60 % (Phase 1 shipped: 45 %).

## 1. Data inventory

Raw columns: Date, State, Market, Commodity, Variety, Arrivals, Min_Price, Max_Price, Modal_Price.

| crop | rows | markets | arrivals missing % | arrivals = 0 % | median arrivals | median reporting days / market |
|---|---|---|---|---|---|---|
| Brinjal | 29148 | 56 | 0.0 | 0.0 | 3.0 | 576.0 |
| Cabbage | 27218 | 50 | 0.0 | 0.0 | 4.2 | 686.0 |
| Cauliflower | 26663 | 50 | 0.0 | 0.0 | 5.0 | 657.0 |
| Onion | 49380 | 116 | 0.0 | 0.0 | 166.0 | 375.5 |
| Potato | 21211 | 44 | 0.0 | 0.0 | 23.5 | 508.0 |
| Tomato | 31832 | 61 | 0.0 | 0.0 | 8.9 | 528.0 |
| Wheat | 58698 | 237 | 0.0 | 0.0 | 4.0 | 154.0 |

* Arrivals exist for every observed row (0 % missing) but only on days a market reported; the unit is **not stated** in the file. The period spans 1096 days.
* Market→district mapping: **not available**. `market_locations.csv` has coordinates only (district column present: False); status counts {'mapped': 166, 'not_found': 121, 'ambiguous': 10}. `city_market_map.csv` covers 64 markets for 11 cities.
* Consequence: the market-premium feature compares a market with the Maharashtra median of the same crop (no nearby-market feature).

## 2. Evidence features and leakage assertions

| Feature | Definition (as of the origin date t) |
|---|---|
| `arr_vs_month_prior` | log( mean arrivals, last 30 days ÷ mean daily arrivals in the same calendar month of earlier years ) |
| `season_change` | mean over earlier years of the log price change h days after an origin in the same month (same crop); targets inside the origin's own year only |
| `market_premium_30d` (+ existing `state_price_gap`) | 30-day mean of log(market price ÷ Maharashtra median) |
| `lag_90_change` (+ existing `lag_30_change`) | log(price[t] ÷ price[t−90]) |
| `yoy_gap` | log(price[t] ÷ price[t−365]) |

**Assertions executed (the script stops if any fails):**

| feature | panel cut at | values compared | mismatches | non-missing % |
|---|---|---|---|---|
| arr_vs_month_prior | 2024-06-30 | 314539 | 0 | 18.6 |
| market_premium_30d | 2024-06-30 | 314539 | 0 | 75.5 |
| lag_90_change | 2024-06-30 | 314539 | 0 | 49.9 |
| yoy_gap | 2024-06-30 | 314539 | 0 | 19.2 |
| arr_vs_month_prior | 2025-03-31 | 484541 | 0 | 31.3 |
| market_premium_30d | 2025-03-31 | 484541 | 0 | 74.7 |
| lag_90_change | 2025-03-31 | 484541 | 0 | 52.8 |
| yoy_gap | 2025-03-31 | 484541 | 0 | 32.3 |

| feature | check | passed |
|---|---|---|
| season_change | scramble every label from 2024 onward; table for 2024 unchanged | True |
| season_change | scramble every label from 2025 onward; table for 2025 unchanged | True |
| season_change | year 2023 has no earlier year -> all missing | True |

Training rows of the candidate use `season_change` computed only from earlier years, never their own labels, so there is no target-encoding leak; rows of the first data year (2023) have no value (missing).

## 3. Candidate as built

* Same architecture, hyper-parameters and horizon→model assignment as production (xgb_rate 1–12 d, rf_rate 13–35 d, rf_plain 36–60 d), on the v2 feature set (production features + 5). Target log(price[t+h]/price[t]).
* **Shrinkage:** forecast = start × exp(w · model output), w ∈ {0, 0.1, …, 1} chosen per crop × horizon band on 2025-H1 validation only (band-pooled w when a cell has < 200 validation cases). w = 0 means “keep the latest price”.
* **Intervals:** split-conformal 80 % band of the validation residual (asymmetric, per crop × band, finite-sample quantile index).
* **Weights w (real-origin):**

| crop | 1-7 d | 8-14 d | 15-30 d | 31-60 d |
|---|---|---|---|---|
| Brinjal | 0.8 | 0.9 | 1.0 | 1.0 |
| Cabbage | 0.8 | 0.6 | 0.6 | 0.9 |
| Cauliflower | 0.8 | 0.8 | 0.7 | 0.8 |
| Onion | 0.3 | 0.3 | 0.3 | 0.3 |
| Potato | 0.3 | 0.0 | 0.0 | 0.2 |
| Tomato | 0.6 | 0.4 | 0.2 | 0.4 |
| Wheat | 1.0 | 0.9 | 1.0 | 1.0 |


## 4. Real-origin results (test = origins 2025-07…12)

Test cases 149,426, validation cases 149,444. Production-feature rows are a re-fit on the same training pairs (not the shipped files).

**Phase 1 reference (production architecture, different random sample of cases):**

| method | n | MAE | WAPE_pct | direction_acc_pct |
|---|---|---|---|---|
| model | 149426 | 444.1 | 22.3 | 62.8 |
| no_change | 149426 | 464.9 | 23.4 | – |

**All test cases, same cases for every row**

| method | n | MAE | WAPE_pct | direction_acc_pct | direction_acc_clear_calls_pct | clear_call_rate_pct |
|---|---|---|---|---|---|---|
| no_change | 149426 | 464.9 | 23.4 | – | – | – |
| v1_refit (production features) | 149426 | 444.1 | 22.3 | 62.8 | – | – |
| v1_shrunk | 149426 | 429.2 | 21.6 | 62.8 | – | – |
| v2_raw (new features) | 149426 | 439.8 | 22.1 | 63.1 | – | – |
| v2_shrunk (CANDIDATE) | 149426 | 419.0 | 21.1 | 60.9 | 88.4 | 8.6 |


* candidate beats **no change** (skill +9.9 %, 95 % CI +5.9 … +14.0)
* raw v2 (no shrinkage) beats **no change** (skill +5.4 %, 95 % CI +1.1 … +9.2)
* production-feature re-fit is not distinguishable from **no change** (skill +4.5 %, 95 % CI -0.3 … +9.2)
* candidate beats **the production-feature re-fit** (skill +5.6 %, 95 % CI +3.8 … +7.6)

`direction_acc_pct` counts moves above 5 % and treats a zero forecast as a miss; `direction_acc_clear_calls_pct` counts only forecasts whose expected change exceeds the typical error (the same rule the explanation uses).

**By horizon band (MAE)**

| band (days) | n | no_change | v1_refit (production features) | v1_shrunk | v2_raw (new features) | v2_shrunk (CANDIDATE) | candidate skill vs no-change % | CI low | CI high |
|---|---|---|---|---|---|---|---|---|---|
| 1-7 | 21455 | 256.0 | 245.9 | 244.1 | 251.1 | 246.0 | 3.9 | 1.4 | 6.1 |
| 8-14 | 19707 | 390.8 | 371.7 | 364.6 | 375.4 | 361.0 | 7.6 | 3.1 | 11.9 |
| 15-30 | 41826 | 477.4 | 461.4 | 445.8 | 458.5 | 438.9 | 8.1 | 3.5 | 11.7 |
| 31-60 | 66438 | 546.4 | 518.6 | 497.6 | 508.1 | 479.6 | 12.2 | 6.5 | 17.7 |

**By crop (MAE)**

| crop | n | no_change | v1_refit (production features) | v1_shrunk | v2_raw (new features) | v2_shrunk (CANDIDATE) | candidate skill % | CI low | CI high | candidate dir. acc (clear) % | clear-call rate % |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Brinjal | 20144 | 1,143.0 | 1,051.1 | 1,050.5 | 1,008.2 | 1,007.3 | 11.9 | 1.5 | 22.0 | 83.7 | 26.1 |
| Cabbage | 19493 | 340.5 | 299.5 | 299.2 | 287.9 | 290.9 | 14.6 | 10.8 | 18.1 | 91.4 | 10.9 |
| Cauliflower | 18591 | 615.8 | 496.2 | 501.8 | 480.0 | 486.9 | 20.9 | 15.5 | 25.9 | 93.1 | 11.1 |
| Onion | 27295 | 189.4 | 298.3 | 219.2 | 318.1 | 207.9 | -9.8 | -15.5 | -4.3 | 84.4 | 0.7 |
| Potato | 14724 | 175.1 | 165.3 | 165.7 | 177.8 | 170.4 | 2.7 | 1.3 | 4.1 | 94.5 | 0.4 |
| Tomato | 22707 | 806.9 | 756.2 | 749.4 | 757.8 | 750.9 | 6.9 | 1.8 | 12.0 | 92.9 | 3.7 |
| Wheat | 26472 | 86.2 | 89.7 | 89.2 | 89.3 | 89.2 | -3.4 | -11.4 | 4.1 | 92.9 | 8.5 |

**Exact horizons (MAE, n)**

| h | n | no_change | v1_refit (production features) | v1_shrunk | v2_raw (new features) | v2_shrunk (CANDIDATE) |
|---|---|---|---|---|---|---|
| 1 | 3210 | 147.9 | 152.5 | 150.7 | 153.4 | 150.9 |
| 7 | 2986 | 329.8 | 315.4 | 310.4 | 323.8 | 312.0 |
| 14 | 2682 | 437.4 | 421.0 | 413.7 | 414.0 | 406.5 |
| 30 | 2507 | 515.2 | 505.2 | 478.6 | 509.8 | 475.0 |
| 60 | 1982 | 562.9 | 547.9 | 530.5 | 528.2 | 504.9 |

**80 % ranges – actual coverage and width (test)**

| range | coverage_pct | below_pct | above_pct | mean_width_pct_of_start | n |
|---|---|---|---|---|---|
| candidate conformal (all) | 79.6 | 9.3 | 11.2 | 68.6 | 149426 |
| production-feature model + shipped ranges | 81.6 | 8.8 | 9.6 | 73.2 | 149426 |
| candidate, 1-7 days | 80.6 | 9.3 | 10.0 | 40.0 | 21455 |
| candidate, 8-14 days | 78.9 | 10.6 | 10.5 | 54.5 | 19707 |
| candidate, 15-30 days | 78.0 | 10.9 | 11.1 | 67.2 | 41826 |
| candidate, 31-60 days | 80.4 | 7.9 | 11.8 | 82.8 | 66438 |
| candidate, h = 1 | 89.6 | 4.3 | 6.2 | 39.6 | 3210 |
| candidate, h = 7 | 72.6 | 14.1 | 13.3 | 40.4 | 2986 |
| candidate, h = 14 | 76.0 | 11.8 | 12.2 | 54.5 | 2682 |
| candidate, h = 30 | 75.5 | 12.4 | 12.0 | 67.5 | 2507 |
| candidate, h = 60 | 79.2 | 7.2 | 13.6 | 83.7 | 1982 |
| candidate, Brinjal | 72.7 | 10.1 | 17.2 | 90.0 | 20144 |
| candidate, Cabbage | 80.3 | 7.5 | 12.2 | 82.2 | 19493 |
| candidate, Cauliflower | 84.4 | 12.5 | 3.2 | 123.6 | 18591 |
| candidate, Onion | 83.9 | 4.2 | 11.9 | 54.4 | 27295 |
| candidate, Potato | 79.9 | 11.4 | 8.7 | 35.0 | 14724 |
| candidate, Tomato | 63.9 | 18.2 | 17.8 | 96.3 | 22707 |
| candidate, Wheat | 89.5 | 4.2 | 6.3 | 13.2 | 26472 |


## 5. Projection path (2024 reference → actual 2025; test = 2025-07…12)

Test cases 127,197; validation cases 132,363. Anchor chosen on validation MAE: **ref_x1.05 (current)** (validation MAE by anchor: ref_x1.05 (current) 540, latest_known_0pct 668, trailing_yoy 842). Trailing-12-month YoY was missing (→ 0 %) for 0.6 % of test cases.

**Phase 1 reference (production projection path, different sample):**

| method | n | MAE | WAPE_pct | direction_acc_pct |
|---|---|---|---|---|
| model | 127144 | 1,010.1 | 50.6 | 55.4 |
| reference_x1.05 | 127144 | 1,090.1 | 54.7 | – |
| latest_known | 127144 | 1,031.7 | 51.7 | – |

**All test cases** (direction is measured against each method's own start price; `no model` rows have none)

| method | n | MAE | WAPE_pct | direction_acc_pct |
|---|---|---|---|---|
| reference_x1.05 (no model) | 127197 | 1,086.0 | 54.5 | – |
| latest_known (no model) | 127197 | 1,027.9 | 51.6 | – |
| trailing_yoy anchor (no model) | 127197 | 1,725.5 | 86.6 | – |
| v1_refit on ref x1.05 (as production) | 127197 | 1,005.5 | 50.4 | 55.4 |
| v2_shrunk, anchor ref_x1.05 (current) | 127197 | 1,018.7 | 51.1 | 42.4 |
| v2_shrunk, anchor latest_known_0pct | 127197 | 1,051.0 | 52.7 | 17.6 |
| v2_shrunk, anchor trailing_yoy | 127197 | 1,631.8 | 81.9 | 33.9 |
| CANDIDATE = v2_shrunk, anchor ref_x1.05 (current) | 127197 | 1,018.7 | 51.1 | 42.4 |


* candidate beats **reference ×1.05** (skill +6.2 %, 95 % CI +4.1 … +8.6)
* candidate is not distinguishable from **latest known price** (skill +0.9 %, 95 % CI -2.0 … +3.7)
* candidate is not distinguishable from **the production projection path (re-fit)** (skill -1.3 %, 95 % CI -5.1 … +1.6)

**By horizon band (MAE)**

| band (days) | n | reference_x1.05 (no model) | latest_known (no model) | v1_refit on ref x1.05 (as production) | CANDIDATE = v2_shrunk, anchor ref_x1.05 (current) |
|---|---|---|---|---|---|
| 1-7 | 18185 | 1,115.6 | 1,024.3 | 1,066.2 | 1,082.6 |
| 8-14 | 17030 | 1,085.1 | 998.9 | 1,009.0 | 1,051.9 |
| 15-30 | 35647 | 1,078.4 | 1,016.6 | 990.9 | 1,031.7 |
| 31-60 | 56335 | 1,081.5 | 1,044.9 | 994.1 | 979.9 |

**By crop (MAE)**

| crop | n | reference_x1.05 (no model) | latest_known (no model) | v1_refit on ref x1.05 (as production) | CANDIDATE = v2_shrunk, anchor ref_x1.05 (current) |
|---|---|---|---|---|---|
| Brinjal | 17628 | 1,233.9 | 2,076.6 | 1,144.7 | 1,158.3 |
| Cabbage | 17148 | 588.2 | 420.9 | 449.2 | 539.7 |
| Cauliflower | 17055 | 872.0 | 1,146.1 | 668.4 | 676.5 |
| Onion | 22180 | 2,184.2 | 1,571.9 | 2,221.4 | 2,184.2 |
| Potato | 13345 | 1,191.9 | 440.1 | 1,151.9 | 1,189.5 |
| Tomato | 18434 | 1,162.5 | 1,128.6 | 986.9 | 990.1 |
| Wheat | 21407 | 263.6 | 272.2 | 270.0 | 270.9 |

**80 % ranges – candidate, actual coverage (test)**

| range | coverage_pct | below_pct | above_pct | mean_width_pct_of_start | n |
|---|---|---|---|---|---|
| all | 60.3 | 30.5 | 9.2 | 78.9 | 127197 |
| 1-7 days | 55.4 | 32.1 | 12.4 | 82.3 | 18185 |
| 8-14 days | 57.6 | 32.3 | 10.1 | 82.3 | 17030 |
| 15-30 days | 60.1 | 31.6 | 8.3 | 82.7 | 35647 |
| 31-60 days | 62.7 | 28.8 | 8.5 | 74.4 | 56335 |
| h = 1 | 54.2 | 32.8 | 13.0 | 81.6 | 2775 |
| h = 7 | 56.6 | 30.7 | 12.7 | 82.4 | 2457 |
| h = 14 | 57.6 | 34.4 | 7.9 | 81.8 | 2320 |
| h = 30 | 59.4 | 31.4 | 9.3 | 82.2 | 2108 |
| h = 60 | 64.8 | 26.2 | 9.0 | 76.4 | 1650 |


## 6. Where the candidate does NOT beat the no-change baseline

**Real-origin:** the candidate is at least as bad as no-change in 9 of 28 crop × band cells (2 of them because the validation chose w = 0, i.e. the candidate simply reproduces no-change there).

| crop | band | n | w | MAE_candidate | MAE_no_change | MAE_v1_refit |
|---|---|---|---|---|---|---|
| Onion | 1-7 | 4006 | 0.3 | 117.3 | 113.8 | 122.3 |
| Onion | 8-14 | 3629 | 0.3 | 184.2 | 175.9 | 210.9 |
| Onion | 15-30 | 7588 | 0.3 | 213.9 | 200.4 | 277.9 |
| Onion | 31-60 | 12072 | 0.3 | 241.4 | 211.6 | 395.7 |
| Potato | 8-14 | 1957 | 0.0 | 138.1 | 138.1 | 134.6 |
| Potato | 15-30 | 4047 | 0.0 | 174.5 | 174.5 | 166.8 |
| Wheat | 8-14 | 3509 | 0.9 | 76.9 | 75.9 | 74.2 |
| Wheat | 15-30 | 7355 | 1.0 | 85.4 | 84.6 | 85.9 |
| Wheat | 31-60 | 11630 | 1.0 | 106.3 | 100.3 | 108.4 |

Crops whose overall candidate skill vs no-change has a confidence interval that includes or is below zero: Onion (-9.8 %, -15.5…-4.3), Wheat (-3.4 %, -11.4…+4.1).

**Projection:** the candidate is not better than the better of (reference ×1.05, latest known) in 18 of 28 crop × band cells.

| crop | band | n | w | MAE_candidate | MAE_reference | MAE_latest_known |
|---|---|---|---|---|---|---|
| Cabbage | 1-7 | 2410 | 0.6 | 498.5 | 526.9 | 420.1 |
| Cabbage | 8-14 | 2346 | 0.0 | 554.3 | 554.3 | 404.1 |
| Cabbage | 15-30 | 4776 | 0.1 | 582.5 | 603.6 | 414.2 |
| Cabbage | 31-60 | 7616 | 0.3 | 521.4 | 608.5 | 430.6 |
| Onion | 1-7 | 3313 | 0.0 | 2,185.2 | 2,185.2 | 1,528.6 |
| Onion | 8-14 | 2992 | 0.0 | 2,208.6 | 2,208.6 | 1,547.5 |
| Onion | 15-30 | 6245 | 0.0 | 2,235.8 | 2,235.8 | 1,573.2 |
| Onion | 31-60 | 9630 | 0.0 | 2,142.8 | 2,142.8 | 1,593.4 |
| Potato | 1-7 | 1890 | 0.6 | 1,144.3 | 1,161.1 | 439.0 |
| Potato | 8-14 | 1772 | 0.0 | 1,180.0 | 1,180.0 | 446.8 |
| Potato | 15-30 | 3697 | 0.0 | 1,196.5 | 1,196.5 | 436.8 |
| Potato | 31-60 | 5986 | 0.0 | 1,202.3 | 1,202.3 | 440.6 |
| Tomato | 1-7 | 2601 | 1.0 | 1,261.4 | 1,323.9 | 1,135.7 |
| Tomato | 8-14 | 2477 | 0.5 | 1,164.4 | 1,228.0 | 1,108.6 |
| Wheat | 1-7 | 3087 | 1.0 | 284.4 | 292.1 | 275.3 |
| Wheat | 8-14 | 2926 | 1.0 | 270.3 | 272.1 | 267.8 |
| Wheat | 15-30 | 6003 | 1.0 | 271.4 | 267.8 | 269.0 |
| Wheat | 31-60 | 9391 | 1.0 | 266.3 | 248.9 | 274.5 |


## 7. What the candidate uses (SHAP on test cases)

Mean share of the total absolute SHAP contribution per explanation group over 2000 test cases (max |base + Σ SHAP − model output| = 3.8e-07):

| group | mean share % |
|---|---|
| Other model factors | 33.8 |
| Seasonal pattern | 32.6 |
| Recent trend | 18.4 |
| Compared with last year | 8.2 |
| Market premium | 5.4 |
| Supply (arrivals) | 1.6 |

Top features by mean |SHAP|: log_price (0.072), doy_cos (0.036), target_doy_cos (0.028), lag_90_change (0.022), commodity_code (0.021), target_doy_sin (0.019), yoy_gap (0.016), state_price_gap (0.013), lag_30_change (0.012), season_change (0.012).

## 8. Limitations

* Three years of data; one held-out half-year (real-origin) and one year pair (projection). Conclusions are suggestive. Confidence intervals resample origin weeks and understate year-to-year variation.
* Shrinkage weights, conformal bands and the projection anchor come from fit A / 2025-H1 and are applied to fit B / 2025-H2; a weight chosen for one half-year may not hold in another.
* The first data year (2023) has no earlier year, so `season_change`, `arr_vs_month_prior` and `yoy_gap` are missing for those training rows; tests use 2023–2024 as the earlier years.
* Arrivals have no stated unit, and state-median series sum arrivals over however many markets reported that day.
* The Phase 1 reference rows use a different random sample of cases than this run; only rows inside this report share identical cases.
* The explanation text is a description of the model's behaviour and of measured data; it does not establish causes.
