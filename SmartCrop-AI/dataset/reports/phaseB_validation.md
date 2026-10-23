# Phase B Stage A: validation-only results (final)

Generated 2026-10-23T08:03:00+00:00. Validation folds: **C** = train targets < 2024-07-01, validate origins 2024-07-01 .. 2024-12-31 (n = 100,000); **A** = train targets < 2025-01-01, validate origins 2025-01-01 .. 2025-06-30 (n = 100,000). Training pairs per fit: 200,000. **No 2025-H2 confirmation case was built or scored.** ₹/quintal.

## 0. Summary

* New features supported by BOTH folds (as individual add-ons to the production features): **none**. Frozen final feature set: **v1**.
* Not supported: arr_vs_month_prior, season_change, market_premium_30d, lag_90_change, yoy_gap.
* Crop strategies (frozen): Brinjal: shrink (final features); Cabbage: shrink (final features); Cauliflower: shrink (final features); Onion: crop-specific model + shrink; Potato: no_change; Tomato: no_change; Wheat: crop-specific model + shrink.

## 1. Acceptance criteria (fixed before running)

* **feature_or_group_supported_if:** pooled raw-MAE gain >= 0.5% in BOTH validation folds AND no crop (n >= 1500) worse than -2.0% in either fold
* **crop_strategy_adopted_if:** cross-fold skill vs no-change >= 0 in both folds AND mean >= 0.5%; otherwise the crop falls back to no-change
* **eligible_strategies:** shrink (final features), no_change, v1_features + shrink, crop-specific model (Onion/Wheat only)
* **informational_only:** validation gate (selected on both folds, so its numbers are optimistic)

## 2. Task 3: value of each feature / group (raw model output, no shrinkage)

MAE, WAPE and direction accuracy (moves above 5 %) per variant and fold on identical validation cases:

| variant | fold | n | MAE | WAPE_pct | direction_acc_pct | n_meaningful | up_share_pct |
|---|---|---|---|---|---|---|---|
| v1 | C | 100000 | 566.8 | 23.5 | 65.1 | 74137 | 44.5 |
| v1 | A | 100000 | 366.0 | 21.2 | 69.4 | 71784 | 54.4 |
| v2 | C | 100000 | 562.6 | 23.3 | 67.3 | 74137 | 44.5 |
| v2 | A | 100000 | 373.6 | 21.7 | 68.7 | 71784 | 54.4 |
| add_arr_vs_month_prior | C | 100000 | 567.8 | 23.5 | 64.6 | 74137 | 44.5 |
| add_arr_vs_month_prior | A | 100000 | 367.6 | 21.3 | 69.7 | 71784 | 54.4 |
| add_season_change | C | 100000 | 568.8 | 23.6 | 65.5 | 74137 | 44.5 |
| add_season_change | A | 100000 | 370.6 | 21.5 | 69.6 | 71784 | 54.4 |
| add_market_premium_30d | C | 100000 | 575.7 | 23.9 | 65.4 | 74137 | 44.5 |
| add_market_premium_30d | A | 100000 | 365.8 | 21.2 | 69.5 | 71784 | 54.4 |
| add_lag_90_change | C | 100000 | 557.0 | 23.1 | 66.8 | 74137 | 44.5 |
| add_lag_90_change | A | 100000 | 371.1 | 21.5 | 68.5 | 71784 | 54.4 |
| add_yoy_gap | C | 100000 | 568.1 | 23.5 | 64.6 | 74137 | 44.5 |
| add_yoy_gap | A | 100000 | 369.3 | 21.4 | 69.7 | 71784 | 54.4 |
| drop_supply | C | 100000 | 561.0 | 23.3 | 67.1 | 74137 | 44.5 |
| drop_supply | A | 100000 | 373.0 | 21.7 | 69.0 | 71784 | 54.4 |
| drop_seasonal | C | 100000 | 592.4 | 24.6 | 64.5 | 74137 | 44.5 |
| drop_seasonal | A | 100000 | 387.0 | 22.5 | 63.9 | 71784 | 54.4 |
| drop_market_premium | C | 100000 | 553.2 | 22.9 | 67.5 | 74137 | 44.5 |
| drop_market_premium | A | 100000 | 377.5 | 21.9 | 68.8 | 71784 | 54.4 |
| drop_recent_trend | C | 100000 | 586.9 | 24.3 | 64.5 | 74137 | 44.5 |
| drop_recent_trend | A | 100000 | 386.8 | 22.5 | 69.6 | 71784 | 54.4 |
| drop_last_year | C | 100000 | 563.2 | 23.3 | 66.7 | 74137 | 44.5 |
| drop_last_year | A | 100000 | 370.9 | 21.5 | 69.0 | 71784 | 54.4 |


**Verdicts** (gain = 1 − MAE_with / MAE_without; 95 % interval from resampling origin weeks; worst crop = largest loss among crops):

| variant | compared | verdict | gain % (C) | CI (C) | worst crop (C) | gain % (A) | CI (A) | worst crop (A) | CI excludes 0 in both |
|---|---|---|---|---|---|---|---|---|---|
| v2 | v2 vs v1 | not supported | 0.7 | -0.1…+1.7 | Wheat -3.3% | -2.1 | -3.3…-0.9 | Potato -24.0% | False |
| add_arr_vs_month_prior | add_arr_vs_month_prior vs v1 | not supported | -0.2 | -0.7…+0.3 | Onion -1.0% | -0.4 | -1.2…+0.2 | Potato -20.2% | False |
| add_season_change | add_season_change vs v1 | not supported | -0.4 | -1.2…+0.3 | Wheat -5.0% | -1.3 | -2.2…-0.4 | Potato -21.7% | False |
| add_market_premium_30d | add_market_premium_30d vs v1 | not supported | -1.6 | -2.2…-0.9 | Onion -6.2% | 0.1 | -0.4…+0.4 | Cabbage -0.6% | False |
| add_lag_90_change | add_lag_90_change vs v1 | not supported | 1.7 | +0.9…+2.6 | Potato -3.6% | -1.4 | -2.0…-0.8 | Onion -7.2% | False |
| add_yoy_gap | add_yoy_gap vs v1 | not supported | -0.2 | -1.0…+0.5 | Onion -2.2% | -0.9 | -1.8…+0.0 | Potato -17.1% | False |
| drop_supply | v2 vs drop_supply | not supported | -0.3 | -0.7…+0.1 | Wheat -1.8% | -0.2 | -0.4…+0.1 | Potato -3.9% | False |
| drop_seasonal | v2 vs drop_seasonal | not supported | 5.0 | +1.6…+8.9 | Cabbage -11.4% | 3.5 | -5.7…+12.9 | Onion -21.7% | False |
| drop_market_premium | v2 vs drop_market_premium | not supported | -1.7 | -2.6…-0.7 | Onion -10.3% | 1.1 | +0.8…+1.4 | Tomato -0.3% | False |
| drop_recent_trend | v2 vs drop_recent_trend | not supported | 4.1 | +1.5…+6.3 | Cabbage -4.7% | 3.4 | +1.3…+5.1 | Wheat -2.5% | True |
| drop_last_year | v2 vs drop_last_year | not supported | 0.1 | -0.5…+0.8 | Onion -0.9% | -0.7 | -1.1…-0.2 | Onion -2.6% | False |


Reading: an add-on row compares v1 + that feature with v1; a drop-out row compares the full v2 with v2 minus the whole group (so a supported drop-out means the group as a whole earns its place, not that the new feature inside it does). 'Supported' requires the point-estimate criteria above; the interval column shows whether the gain is also statistically clear.

**Same variants after cross-fold shrinkage** (weights from the other fold):

| variant | fold | MAE_cross_shrunk | MAE_no_change | skill_vs_no_change_pct |
|---|---|---|---|---|
| v1 | C | 565.1 | 629.0 | 10.2 |
| v1 | A | 354.5 | 372.3 | 4.8 |
| v2 | C | 562.4 | 629.0 | 10.6 |
| v2 | A | 360.9 | 372.3 | 3.1 |
| add_arr_vs_month_prior | C | 567.1 | 629.0 | 9.8 |
| add_arr_vs_month_prior | A | 356.2 | 372.3 | 4.3 |
| add_season_change | C | 567.8 | 629.0 | 9.7 |
| add_season_change | A | 352.5 | 372.3 | 5.3 |
| add_market_premium_30d | C | 568.8 | 629.0 | 9.6 |
| add_market_premium_30d | A | 354.8 | 372.3 | 4.7 |
| add_lag_90_change | C | 562.2 | 629.0 | 10.6 |
| add_lag_90_change | A | 363.4 | 372.3 | 2.4 |
| add_yoy_gap | C | 566.5 | 629.0 | 9.9 |
| add_yoy_gap | A | 350.0 | 372.3 | 6.0 |
| drop_supply | C | 562.1 | 629.0 | 10.6 |
| drop_supply | A | 358.5 | 372.3 | 3.7 |
| drop_seasonal | C | 577.8 | 629.0 | 8.1 |
| drop_seasonal | A | 380.2 | 372.3 | -2.1 |
| drop_market_premium | C | 564.2 | 629.0 | 10.3 |
| drop_market_premium | A | 363.9 | 372.3 | 2.3 |
| drop_recent_trend | C | 575.0 | 629.0 | 8.6 |
| drop_recent_trend | A | 365.8 | 372.3 | 1.7 |
| drop_last_year | C | 566.1 | 629.0 | 10.0 |
| drop_last_year | A | 360.1 | 372.3 | 3.3 |


## 3. Feature coverage (share of validation cases where the feature has a value)

| fold | crop | n | arr_vs_month_prior | season_change | market_premium_30d | lag_90_change | yoy_gap |
|---|---|---|---|---|---|---|---|
| C | Brinjal | 13356 | 99.3 | 89.8 | 100.0 | 98.7 | 100.0 |
| C | Cabbage | 13003 | 99.4 | 89.8 | 100.0 | 98.7 | 100.0 |
| C | Cauliflower | 13295 | 99.2 | 89.5 | 100.0 | 97.7 | 100.0 |
| C | Onion | 17588 | 98.9 | 90.1 | 100.0 | 89.0 | 100.0 |
| C | Potato | 9799 | 100.0 | 88.2 | 100.0 | 98.8 | 100.0 |
| C | Tomato | 14262 | 99.1 | 89.2 | 100.0 | 98.1 | 100.0 |
| C | Wheat | 18697 | 97.9 | 89.6 | 100.0 | 94.1 | 100.0 |
| A | Brinjal | 13396 | 99.9 | 100.0 | 100.0 | 99.3 | 100.0 |
| A | Cabbage | 13155 | 99.9 | 100.0 | 100.0 | 99.2 | 100.0 |
| A | Cauliflower | 12823 | 99.9 | 100.0 | 100.0 | 99.1 | 100.0 |
| A | Onion | 16825 | 99.7 | 100.0 | 100.0 | 79.9 | 100.0 |
| A | Potato | 9860 | 99.8 | 100.0 | 100.0 | 98.3 | 100.0 |
| A | Tomato | 14819 | 99.7 | 100.0 | 100.0 | 99.5 | 100.0 |
| A | Wheat | 19122 | 99.0 | 100.0 | 100.0 | 96.0 | 100.0 |


Why coverage is thin: the first data year (2023) has no earlier year, so `arr_vs_month_prior`, `season_change` and `yoy_gap` are missing there, and `lag_90_change` needs 90 days of history. Fold C (origins in 2024-H2) has only one earlier year; fold A has two for seasonal / arrivals comparisons.

**v2 versus v1 where the time-dependent features exist and where they do not:**

* fold C: all three available n = 88,664, v2 gain over v1 = +0.63 %; some missing n = 11,336, gain = +1.74 %.
* fold A: all three available n = 99,675, v2 gain over v1 = -2.04 %; some missing n = 325, gain = -4.72 %.

## 4. Task 2: crop strategies (skill vs no-change, cross-fold: weights chosen on the other fold)

| crop | strategy | skill_C_pct | skill_A_pct | n_C | n_A | mean_skill_pct |
|---|---|---|---|---|---|---|
| Brinjal | no_change | 0.0 | 0.0 | 13356 | 13396 | 0.0 |
| Brinjal | shrink (final features) | 8.9 | 15.5 | 13356 | 13396 | 12.2 |
| Brinjal | v1_features + shrink | 8.9 | 15.5 | 13356 | 13396 | 12.2 |
| Brinjal | validation gate (informational, optimistic) | 9.1 | 15.3 | 13356 | 13396 | 12.2 |
| Cabbage | no_change | 0.0 | 0.0 | 13003 | 13155 | 0.0 |
| Cabbage | shrink (final features) | 4.1 | 11.8 | 13003 | 13155 | 7.9 |
| Cabbage | v1_features + shrink | 4.1 | 11.8 | 13003 | 13155 | 7.9 |
| Cabbage | validation gate (informational, optimistic) | 5.2 | 10.2 | 13003 | 13155 | 7.7 |
| Cauliflower | no_change | 0.0 | 0.0 | 13295 | 12823 | 0.0 |
| Cauliflower | shrink (final features) | 9.9 | 5.0 | 13295 | 12823 | 7.5 |
| Cauliflower | v1_features + shrink | 9.9 | 5.0 | 13295 | 12823 | 7.5 |
| Cauliflower | validation gate (informational, optimistic) | 9.9 | 5.0 | 13295 | 12823 | 7.5 |
| Onion | no_change | 0.0 | 0.0 | 17588 | 16825 | 0.0 |
| Onion | shrink (final features) | 10.0 | 10.1 | 17588 | 16825 | 10.0 |
| Onion | v1_features + shrink | 10.0 | 10.1 | 17588 | 16825 | 10.0 |
| Onion | crop-specific model + shrink | 19.8 | 5.1 | 17588 | 16825 | 12.4 |
| Onion | validation gate (informational, optimistic) | 10.0 | 10.1 | 17588 | 16825 | 10.0 |
| Potato | no_change | 0.0 | 0.0 | 9799 | 9860 | 0.0 |
| Potato | shrink (final features) | 9.1 | -3.3 | 9799 | 9860 | 2.9 |
| Potato | v1_features + shrink | 9.1 | -3.3 | 9799 | 9860 | 2.9 |
| Potato | validation gate (informational, optimistic) | 2.6 | 0.9 | 9799 | 9860 | 1.7 |
| Tomato | no_change | 0.0 | 0.0 | 14262 | 14819 | 0.0 |
| Tomato | shrink (final features) | 14.7 | -23.6 | 14262 | 14819 | -4.5 |
| Tomato | v1_features + shrink | 14.7 | -23.6 | 14262 | 14819 | -4.5 |
| Tomato | validation gate (informational, optimistic) | 0.2 | 0.4 | 14262 | 14819 | 0.3 |
| Wheat | no_change | 0.0 | 0.0 | 18697 | 19122 | 0.0 |
| Wheat | shrink (final features) | 7.1 | 12.3 | 18697 | 19122 | 9.7 |
| Wheat | v1_features + shrink | 7.1 | 12.3 | 18697 | 19122 | 9.7 |
| Wheat | crop-specific model + shrink | 15.1 | 13.5 | 18697 | 19122 | 14.3 |
| Wheat | validation gate (informational, optimistic) | 7.1 | 12.3 | 18697 | 19122 | 9.7 |


**Frozen choice per crop**

| crop | strategy | mean cross-fold skill % | reason |
|---|---|---|---|
| Brinjal | shrink (final features) | 12.2 | model beats no-change in both folds |
| Cabbage | shrink (final features) | 7.9 | model beats no-change in both folds |
| Cauliflower | shrink (final features) | 7.5 | model beats no-change in both folds |
| Onion | crop-specific model + shrink | 12.4 | model beats no-change in both folds |
| Potato | no_change | 0.0 | no eligible model strategy was >= 0% in both folds with a mean gain >= 0.5%: falls back to no-change |
| Tomato | no_change | 0.0 | no eligible model strategy was >= 0% in both folds with a mean gain >= 0.5%: falls back to no-change |
| Wheat | crop-specific model + shrink | 14.3 | model beats no-change in both folds |


**Pooled effect of the per-crop choices** (cross-fold, skill vs no-change over all crops):

| fold | skill_shrink_everywhere_pct | skill_with_crop_strategies_pct | change_points |
|---|---|---|---|
| C | 10.2 | 8.3 | -1.8 |
| A | 4.8 | 8.2 | 3.5 |


The validation-gate row is informational only: the gate is selected using both folds, so its numbers are optimistic and it is not eligible for adoption.

### Diagnostics: Onion (final features, raw model output)

| fold | n | markets | weeks | model MAE | v1 MAE | no-change MAE | skill (week CI) | skill (market CI) | error from worst 5 % cases % | state-median series % | outlier-capped day % |
|---|---|---|---|---|---|---|---|---|---|---|---|
| C | 17588 | 81 | 27 | 700.3 | 700.3 | 703.1 | +0.4 (-18.1…+16.7) | +0.4 (-5.3…+5.7) | 16.0 | 3.5 | 0.0 |
| A | 16825 | 85 | 27 | 328.2 | 328.2 | 309.7 | -6.0 (-26.9…+11.5) | -6.0 (-11.7…-0.8) | 15.4 | 2.9 | 0.1 |

Signed error (model − actual, log) and MAE by band:

| fold | band | n | mean_signed_log_error | model_MAE | no_change_MAE |
|---|---|---|---|---|---|
| C | 1-7 | 2270 | -0.0 | 291.9 | 279.5 |
| C | 8-14 | 2177 | -0.1 | 508.5 | 473.2 |
| C | 15-30 | 4702 | -0.2 | 681.4 | 653.1 |
| C | 31-60 | 8439 | -0.2 | 870.1 | 904.2 |
| A | 1-7 | 2141 | 0.0 | 153.6 | 154.4 |
| A | 8-14 | 2092 | 0.0 | 240.0 | 236.6 |
| A | 15-30 | 4500 | 0.1 | 323.1 | 290.4 |
| A | 31-60 | 8092 | 0.2 | 400.0 | 380.4 |

By variety:

| fold | variety | n | model_MAE | no_change_MAE |
|---|---|---|---|---|
| C | All varieties | 612 | 628.7 | 656.6 |
| C | Local | 4053 | 685.5 | 736.0 |
| C | Other | 9029 | 761.7 | 677.9 |
| C | Pole | 201 | 500.9 | 911.3 |
| C | Red | 3211 | 587.3 | 725.1 |
| C | White | 270 | 657.2 | 666.3 |
| A | 1st Sort | 233 | 389.3 | 339.9 |
| A | All varieties | 490 | 313.1 | 297.3 |
| A | Local | 3801 | 338.2 | 332.6 |
| A | Other | 7740 | 297.0 | 271.2 |
| A | Pole | 254 | 487.4 | 464.7 |
| A | Red | 3989 | 370.1 | 358.6 |
| A | White | 274 | 288.9 | 244.3 |


### Diagnostics: Wheat (final features, raw model output)

| fold | n | markets | weeks | model MAE | v1 MAE | no-change MAE | skill (week CI) | skill (market CI) | error from worst 5 % cases % | state-median series % | outlier-capped day % |
|---|---|---|---|---|---|---|---|---|---|---|---|
| C | 18697 | 115 | 27 | 130.2 | 130.2 | 139.8 | +6.9 (+1.7…+11.5) | +6.9 (+0.0…+11.9) | 21.4 | 3.1 | 0.0 |
| A | 19122 | 126 | 27 | 116.8 | 116.8 | 133.2 | +12.3 (+7.7…+16.5) | +12.3 (+8.6…+15.8) | 21.7 | 2.8 | 0.0 |

Signed error (model − actual, log) and MAE by band:

| fold | band | n | mean_signed_log_error | model_MAE | no_change_MAE |
|---|---|---|---|---|---|
| C | 1-7 | 2338 | -0.0 | 87.4 | 94.5 |
| C | 8-14 | 2148 | -0.0 | 109.0 | 116.2 |
| C | 15-30 | 5071 | -0.0 | 131.2 | 136.1 |
| C | 31-60 | 9140 | -0.0 | 145.6 | 159.0 |
| A | 1-7 | 2500 | 0.0 | 84.0 | 88.0 |
| A | 8-14 | 2265 | 0.0 | 103.8 | 106.4 |
| A | 15-30 | 5058 | 0.0 | 118.4 | 126.7 |
| A | 31-60 | 9299 | 0.0 | 128.0 | 155.5 |

By variety:

| fold | variety | n | model_MAE | no_change_MAE |
|---|---|---|---|---|
| C | All varieties | 579 | 77.4 | 92.1 |
| C | Bansi | 315 | 182.3 | 188.2 |
| C | Maharashtra 2189 | 2533 | 165.5 | 186.3 |
| C | Other | 14397 | 124.9 | 135.8 |
| C | Sharbati | 840 | 133.6 | 84.6 |
| A | All varieties | 535 | 69.7 | 78.9 |
| A | Bansi | 503 | 145.5 | 177.4 |
| A | Maharashtra 2189 | 2594 | 120.3 | 149.4 |
| A | Other | 14193 | 116.9 | 131.0 |
| A | Sharbati | 1122 | 125.4 | 140.0 |


## 5. Prediction ranges, calibrated on one fold and checked on the other (final strategy, 80 % nominal)

**calibrate A -> evaluate C**

| scope | coverage_pct | below_pct | above_pct | mean_width_pct_of_start | n |
|---|---|---|---|---|---|
| all | 69.9 | 17.9 | 12.2 | 73.2 | 100000 |
| 1-7 days | 80.2 | 11.3 | 8.6 | 42.4 | 12222 |
| 8-14 days | 75.2 | 14.4 | 10.4 | 57.6 | 11669 |
| 15-30 days | 72.5 | 17.4 | 10.1 | 69.5 | 26865 |
| 31-60 days | 64.6 | 20.7 | 14.7 | 86.5 | 49244 |
| Brinjal | 73.4 | 16.8 | 9.8 | 102.0 | 13356 |
| Cabbage | 66.6 | 21.2 | 12.3 | 81.8 | 13003 |
| Cauliflower | 70.9 | 24.3 | 4.7 | 125.8 | 13295 |
| Onion | 72.8 | 6.1 | 21.0 | 51.7 | 17588 |
| Potato | 79.3 | 16.7 | 3.9 | 37.4 | 9799 |
| Tomato | 48.9 | 41.7 | 9.4 | 119.0 | 14262 |
| Wheat | 77.2 | 5.6 | 17.2 | 13.2 | 18697 |


**calibrate C -> evaluate A**

| scope | coverage_pct | below_pct | above_pct | mean_width_pct_of_start | n |
|---|---|---|---|---|---|
| all | 81.0 | 8.5 | 10.6 | 85.5 | 100000 |
| 1-7 days | 79.8 | 8.7 | 11.5 | 41.1 | 12180 |
| 8-14 days | 81.8 | 7.9 | 10.3 | 62.7 | 11770 |
| 15-30 days | 82.2 | 7.5 | 10.3 | 81.7 | 26749 |
| 31-60 days | 80.3 | 9.0 | 10.6 | 104.1 | 49301 |
| Brinjal | 85.5 | 4.4 | 10.1 | 123.4 | 13396 |
| Cabbage | 88.9 | 3.5 | 7.6 | 122.1 | 13155 |
| Cauliflower | 78.3 | 2.4 | 19.4 | 122.4 | 12823 |
| Onion | 75.5 | 18.2 | 6.3 | 59.6 | 16825 |
| Potato | 76.7 | 5.2 | 18.1 | 36.7 | 9860 |
| Tomato | 87.4 | 1.5 | 11.1 | 142.4 | 14819 |
| Wheat | 76.1 | 17.3 | 6.6 | 13.1 | 19122 |


## 6. Frozen decisions

`dataset/reports/phaseB_decisions.json` (sha256 `10baf05567d5a3d29796f725fed93124f8d076aad837c10253446419f72c3336`) holds the final features, per-crop strategy, shrinkage weights, conformal bands and typical errors. Stage B (not started) would: load these decisions and verify the hash; fit the chosen models on targets < 2025-07-01 (fit B); score the 2025-H2 confirmation cases ONCE with the frozen features, strategies, weights and conformal bands; rebuild reliability counts and regenerate six samples with explain_v3 (no setting changes).

**Shrinkage weights (pooled validation):**

| crop | 1-7 | 8-14 | 15-30 | 31-60 |
|---|---|---|---|---|
| Brinjal | 0.5 | 0.6 | 0.7 | 0.8 |
| Cabbage | 0.8 | 0.6 | 0.6 | 0.9 |
| Cauliflower | 0.7 | 0.7 | 0.7 | 0.7 |
| Onion | 0.3 | 0.3 | 0.4 | 0.5 |
| Potato | 0.0 | 0.0 | 0.0 | 0.0 |
| Tomato | 0.0 | 0.0 | 0.0 | 0.0 |
| Wheat | 0.8 | 0.7 | 0.8 | 0.9 |


## 7. Limitations

* Three years of data. Fold C trains on only 18 months and has one earlier year for the seasonal / arrivals / year-ago features, so it is a harder, thinner validation than fold A.
* Both folds are consecutive half-years of the same period (2024-H2, 2025-H1); a feature that helps in both may still not help in other years.
* Models are re-fitted with 200k pairs (random forests capped at 100k rows); absolute MAEs differ slightly from Phase 2, so only within-report comparisons are valid.
* Crop-strategy numbers are cross-fold, but the feature set and the strategy rule were chosen on the same two folds; Stage B is the first genuinely held-out check, and 2025-H2 was already seen in Phase 2.
* Market series and the state-median series are correlated; the market-clustered intervals in section 4 are the more conservative ones.
* Arrivals have no stated unit; nearby-market and weather information are not used.