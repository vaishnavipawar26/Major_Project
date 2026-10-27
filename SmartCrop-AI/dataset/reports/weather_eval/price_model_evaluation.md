# Price Model Evaluation (walk-forward, 2025)

Generated 2026-10-27T15:59:44+00:00 by `scripts/evaluate_price_models.py`.

Status: **validation folds used for selection/calibration; test folds scored once**. Validation folds ['2025-Q1', '2025-Q2']; test folds ['2025-Q3', '2025-Q4'] (all tables below are TEST unless stated).

Metric definitions: MAE = mean |forecast - actual| (Rs/quintal); RMSE = root mean squared error; WAPE = sum|error| / sum(actual) (a weighted percentage error that stays defined when single prices are small; MAPE is avoided because it explodes near zero); direction accuracy = share of cases with a price move above 1% where the forecast had the right sign; skill vs no-change = 1 - MAE / MAE of 'price stays the same' (positive = better than no change).

Weather features: trailing observed weather and pre-2023 normals only (no forecasts).

## Overall

| model | n | MAE | RMSE | WAPE_pct | direction_acc_pct | skill_vs_nochange_pct |
|---|---|---|---|---|---|---|
| no_change | 800000 | 451.38 | 797.28 | 22.24 | 0.00 | 0.00 |
| price_only|selected | 800000 | 438.73 | 754.97 | 21.62 | 61.45 | 2.80 |
| price_weather|selected | 800000 | 438.98 | 755.89 | 21.63 | 61.58 | 2.75 |
| seasonal_naive | 800000 | 685.84 | 1,303.86 | 33.80 | 41.82 | -51.94 |

## By forecast-horizon band

| band | model | n | MAE | RMSE | WAPE_pct | direction_acc_pct | skill_vs_nochange_pct |
|---|---|---|---|---|---|---|---|
| 1-7 | no_change | 120778 | 254.18 | 497.22 | 12.48 | 0.00 | 0.00 |
| 1-7 | price_only|selected | 120778 | 247.06 | 458.83 | 12.13 | 63.57 | 2.80 |
| 1-7 | price_weather|selected | 120778 | 248.39 | 461.46 | 12.19 | 62.55 | 2.28 |
| 1-7 | seasonal_naive | 120778 | 398.42 | 775.88 | 19.56 | 36.83 | -56.75 |
| 15-30 | no_change | 228070 | 464.58 | 808.15 | 23.00 | 0.00 | 0.00 |
| 15-30 | price_only|selected | 228070 | 455.76 | 774.32 | 22.56 | 60.49 | 1.90 |
| 15-30 | price_weather|selected | 228070 | 454.69 | 772.97 | 22.51 | 60.71 | 2.13 |
| 15-30 | seasonal_naive | 228070 | 692.86 | 1,321.25 | 34.30 | 44.14 | -49.14 |
| 31-60 | no_change | 340929 | 532.32 | 900.62 | 26.17 | 0.00 | 0.00 |
| 31-60 | price_only|selected | 340929 | 516.01 | 851.91 | 25.36 | 61.51 | 3.06 |
| 31-60 | price_weather|selected | 340929 | 517.29 | 854.91 | 25.43 | 61.92 | 2.82 |
| 31-60 | seasonal_naive | 340929 | 817.60 | 1,485.91 | 40.19 | 41.73 | -53.59 |
| 8-14 | no_change | 110223 | 389.80 | 694.55 | 19.26 | 0.00 | 0.00 |
| 8-14 | price_only|selected | 110223 | 374.49 | 648.67 | 18.50 | 61.32 | 3.93 |
| 8-14 | price_weather|selected | 110223 | 373.11 | 645.54 | 18.43 | 61.44 | 4.28 |
| 8-14 | seasonal_naive | 110223 | 578.69 | 1,112.63 | 28.59 | 41.72 | -48.46 |

## By exact horizon

| horizon | model | n | MAE | RMSE | WAPE_pct | direction_acc_pct | skill_vs_nochange_pct |
|---|---|---|---|---|---|---|---|
| 1 | no_change | 18169 | 140.48 | 336.08 | 6.91 | 0.00 | 0.00 |
| 1 | price_only|selected | 18169 | 147.14 | 318.56 | 7.23 | 64.88 | -4.74 |
| 1 | price_weather|selected | 18169 | 147.20 | 320.52 | 7.24 | 63.30 | -4.79 |
| 1 | seasonal_naive | 18169 | 256.15 | 533.39 | 12.60 | 30.52 | -82.35 |
| 7 | no_change | 16238 | 330.54 | 605.78 | 16.25 | 0.00 | 0.00 |
| 7 | price_only|selected | 16238 | 316.29 | 552.65 | 15.55 | 62.36 | 4.31 |
| 7 | price_weather|selected | 16238 | 317.33 | 552.95 | 15.60 | 61.98 | 4.00 |
| 7 | seasonal_naive | 16238 | 501.31 | 940.59 | 24.65 | 39.96 | -51.66 |
| 14 | no_change | 15472 | 427.56 | 756.42 | 21.33 | 0.00 | 0.00 |
| 14 | price_only|selected | 15472 | 410.51 | 702.52 | 20.48 | 60.60 | 3.99 |
| 14 | price_weather|selected | 15472 | 405.69 | 694.77 | 20.24 | 61.44 | 5.12 |
| 14 | seasonal_naive | 15472 | 618.58 | 1,195.81 | 30.86 | 43.16 | -44.68 |
| 30 | no_change | 13208 | 487.71 | 833.61 | 24.05 | 0.00 | 0.00 |
| 30 | price_only|selected | 13208 | 486.47 | 810.84 | 23.98 | 61.09 | 0.25 |
| 30 | price_weather|selected | 13208 | 485.11 | 808.64 | 23.92 | 60.96 | 0.53 |
| 30 | seasonal_naive | 13208 | 749.54 | 1,448.97 | 36.96 | 44.28 | -53.69 |
| 60 | no_change | 9726 | 535.64 | 870.07 | 26.36 | 0.00 | 0.00 |
| 60 | price_only|selected | 9726 | 531.38 | 853.24 | 26.15 | 60.59 | 0.80 |
| 60 | price_weather|selected | 9726 | 528.24 | 851.87 | 26.00 | 61.24 | 1.38 |
| 60 | seasonal_naive | 9726 | 851.96 | 1,474.89 | 41.93 | 39.55 | -59.05 |

## By crop

| commodity | model | n | MAE | RMSE | WAPE_pct | direction_acc_pct | skill_vs_nochange_pct |
|---|---|---|---|---|---|---|---|
| Brinjal | no_change | 103473 | 1,116.18 | 1,578.42 | 33.51 | 0.00 | 0.00 |
| Brinjal | price_only|selected | 103473 | 1,082.85 | 1,541.40 | 32.51 | 63.09 | 2.99 |
| Brinjal | price_weather|selected | 103473 | 1,082.62 | 1,540.85 | 32.50 | 63.44 | 3.01 |
| Brinjal | seasonal_naive | 103473 | 1,713.81 | 2,592.62 | 51.45 | 42.18 | -53.54 |
| Cabbage | no_change | 102132 | 336.07 | 476.42 | 26.86 | 0.00 | 0.00 |
| Cabbage | price_only|selected | 102132 | 300.83 | 418.33 | 24.04 | 66.32 | 10.49 |
| Cabbage | price_weather|selected | 102132 | 292.82 | 409.73 | 23.40 | 68.56 | 12.87 |
| Cabbage | seasonal_naive | 102132 | 411.84 | 591.62 | 32.92 | 53.05 | -22.54 |
| Cauliflower | no_change | 95224 | 607.10 | 831.47 | 31.64 | 0.00 | 0.00 |
| Cauliflower | price_only|selected | 95224 | 497.71 | 672.62 | 25.94 | 71.18 | 18.02 |
| Cauliflower | price_weather|selected | 95224 | 491.50 | 665.57 | 25.62 | 71.74 | 19.04 |
| Cauliflower | seasonal_naive | 95224 | 784.89 | 1,156.60 | 40.91 | 51.83 | -29.28 |
| Onion | no_change | 157935 | 210.04 | 323.05 | 16.59 | 0.00 | 0.00 |
| Onion | price_only|selected | 157935 | 282.07 | 370.99 | 22.28 | 50.52 | -34.30 |
| Onion | price_weather|selected | 157935 | 286.31 | 374.62 | 22.62 | 49.93 | -36.32 |
| Onion | seasonal_naive | 157935 | 347.69 | 501.25 | 27.47 | 35.79 | -65.54 |
| Potato | no_change | 77101 | 183.11 | 279.86 | 11.97 | 0.00 | 0.00 |
| Potato | price_only|selected | 77101 | 166.90 | 226.16 | 10.91 | 66.03 | 8.85 |
| Potato | price_weather|selected | 77101 | 165.58 | 224.79 | 10.83 | 65.79 | 9.57 |
| Potato | seasonal_naive | 77101 | 219.63 | 334.19 | 14.36 | 45.11 | -19.94 |
| Tomato | no_change | 115417 | 806.48 | 1,086.26 | 37.00 | 0.00 | 0.00 |
| Tomato | price_only|selected | 115417 | 778.66 | 1,023.34 | 35.73 | 62.26 | 3.45 |
| Tomato | price_weather|selected | 115417 | 787.44 | 1,034.01 | 36.13 | 61.79 | 2.36 |
| Tomato | seasonal_naive | 115417 | 1,368.99 | 1,961.83 | 62.81 | 33.90 | -69.75 |
| Wheat | no_change | 148718 | 88.11 | 142.05 | 3.28 | 0.00 | 0.00 |
| Wheat | price_only|selected | 148718 | 90.98 | 133.13 | 3.39 | 58.58 | -3.26 |
| Wheat | price_weather|selected | 148718 | 91.37 | 133.26 | 3.41 | 58.17 | -3.70 |
| Wheat | seasonal_naive | 148718 | 165.96 | 244.51 | 6.19 | 37.65 | -88.36 |

## Paired comparison on identical test rows (price-only MAE minus weather MAE; positive = weather better)

```json
{
 "1-7": {
  "mean_MAE_gain_rs": -1.332033049362687,
  "naive_se_rs": 0.1426429892106343,
  "share_rows_improved_pct": 48.142045736806374
 },
 "15-30": {
  "mean_MAE_gain_rs": 1.0710681844079395,
  "naive_se_rs": 0.14740117411940926,
  "share_rows_improved_pct": 51.91651685885912
 },
 "31-60": {
  "mean_MAE_gain_rs": -1.2866605220292877,
  "naive_se_rs": 0.11718108626100854,
  "share_rows_improved_pct": 50.232746407609795
 },
 "8-14": {
  "mean_MAE_gain_rs": 1.3795202608342798,
  "naive_se_rs": 0.28060335977710155,
  "share_rows_improved_pct": 48.96981573718734
 }
}
```

The standard error treats rows as independent, but rows from the same origin and market are correlated, so it is optimistic: a gain smaller than about 2 naive standard errors should be read as no evidence of improvement.

## 80% prediction-interval coverage (calibrated on validation, scored on test)

| feature_set | by | key | n | coverage_pct | mean_width_rs | mean_rel_width_pct |
|---|---|---|---|---|---|---|
| price_only | band | 1-7 | 120778 | 78.61 | 798.20 | 39.91 |
| price_only | band | 15-30 | 228070 | 75.34 | 1,318.99 | 69.62 |
| price_only | band | 31-60 | 340929 | 77.07 | 1,585.23 | 84.79 |
| price_only | band | 8-14 | 110223 | 75.47 | 1,101.55 | 56.36 |
| price_only | commodity | Brinjal | 103473 | 55.58 | 1,822.38 | 69.85 |
| price_only | commodity | Cabbage | 102132 | 72.68 | 804.91 | 69.84 |
| price_only | commodity | Cauliflower | 95224 | 67.61 | 1,218.25 | 69.85 |
| price_only | commodity | Onion | 157935 | 84.40 | 973.26 | 69.67 |
| price_only | commodity | Potato | 77101 | 97.60 | 1,092.53 | 69.78 |
| price_only | commodity | Tomato | 115417 | 51.50 | 1,324.77 | 69.94 |
| price_only | commodity | Wheat | 148718 | 99.92 | 1,892.60 | 69.60 |
| price_weather | band | 1-7 | 120778 | 78.42 | 795.71 | 39.87 |
| price_weather | band | 15-30 | 228070 | 75.19 | 1,314.60 | 69.50 |
| price_weather | band | 31-60 | 340929 | 76.99 | 1,580.08 | 84.49 |
| price_weather | band | 8-14 | 110223 | 75.77 | 1,087.83 | 55.88 |
| price_weather | commodity | Brinjal | 103473 | 55.41 | 1,809.39 | 69.61 |
| price_weather | commodity | Cabbage | 102132 | 74.45 | 809.10 | 69.61 |
| price_weather | commodity | Cauliflower | 95224 | 68.28 | 1,218.31 | 69.62 |
| price_weather | commodity | Onion | 157935 | 83.22 | 969.61 | 69.44 |
| price_weather | commodity | Potato | 77101 | 97.67 | 1,088.30 | 69.55 |
| price_weather | commodity | Tomato | 115417 | 50.68 | 1,311.85 | 69.70 |
| price_weather | commodity | Wheat | 148718 | 99.92 | 1,884.09 | 69.37 |

## Model chosen per horizon band (validation only)

```json
{
 "price_only": {
  "1-7": "xgb_rate",
  "15-30": "rf_rate",
  "31-60": "rf_plain",
  "8-14": "xgb_rate"
 },
 "price_weather": {
  "1-7": "xgb_rate",
  "15-30": "rf_rate",
  "31-60": "rf_plain",
  "8-14": "xgb_rate"
 }
}
```