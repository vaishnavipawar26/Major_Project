# Onion, Potato, Tomato, Wheat: can a crop- and band-specific model validate?

Generated 2026-10-28T16:06:44+00:00 by `scripts/experiment_hard_crops.py`. Skill = 1 - MAE/no-change MAE (price scale); the adoption margin is +2% in folds C and A and on the untouched test T.

## 1. Why each crop fails today (stored cross-validation, 2025, and the policy's reasons)

| crop | band | CV skill vs no-change | policy | reasons |
|---|---|---|---|---|
| Onion | 1-7 | -2.9% | context_only | Real-origin backtest (origins 2025-H2, n=7,939): model -4.8% vs no-change.; Validation fold A (2025-H1), pooled model vs no-change: -6.0% (market-bootstrap 95% CI -11.7 to -0.8). |
| Onion | 8-14 | -8.7% | context_only | Real-origin backtest (origins 2025-H2, n=7,389): model -17.2% vs no-change.; Validation fold A (2025-H1), pooled model vs no-change: -6.0% (market-bootstrap 95% CI -11.7 to -0.8). |
| Onion | 15-30 | -20.9% | context_only | Real-origin backtest (origins 2025-H2, n=15,418): model -33.5% vs no-change.; Validation fold A (2025-H1), pooled model vs no-change: -6.0% (market-bootstrap 95% CI -11.7 to -0.8). |
| Onion | 31-60 | -28.4% | context_only | Real-origin backtest (origins 2025-H2, n=24,482): model -76.6% vs no-change.; Projection backtest (origins 2025-H2, n=16,477): model -2.6% vs the starting price.; Validation fold A (2025-H1), pooled model vs no-change: -6.0% (mark |
| Potato | 1-7 | +2.8% | context_only | Validation folds 2024-H2 and 2025-H1: the model did not beat keeping the latest price in both (skill +9.1% / -3.3%). |
| Potato | 8-14 | +2.8% | context_only | Validation folds 2024-H2 and 2025-H1: the model did not beat keeping the latest price in both (skill +9.1% / -3.3%). |
| Potato | 15-30 | +4.1% | context_only | Validation folds 2024-H2 and 2025-H1: the model did not beat keeping the latest price in both (skill +9.1% / -3.3%). |
| Potato | 31-60 | +2.9% | context_only | Validation folds 2024-H2 and 2025-H1: the model did not beat keeping the latest price in both (skill +9.1% / -3.3%). |
| Tomato | 1-7 | +2.8% | context_only | Validation folds 2024-H2 and 2025-H1: the model did not beat keeping the latest price in both (skill +14.7% / -23.6%). |
| Tomato | 8-14 | -2.6% | context_only | Validation folds 2024-H2 and 2025-H1: the model did not beat keeping the latest price in both (skill +14.7% / -23.6%).; Real-origin backtest (origins 2025-H2, n=5,991): model +0.3% vs no-change, below the +2% margin required. |
| Tomato | 15-30 | -16.6% | context_only | Validation folds 2024-H2 and 2025-H1: the model did not beat keeping the latest price in both (skill +14.7% / -23.6%).; Real-origin backtest (origins 2025-H2, n=12,759): model +1.2% vs no-change, below the +2% margin required. |
| Tomato | 31-60 | -13.3% | context_only | Validation folds 2024-H2 and 2025-H1: the model did not beat keeping the latest price in both (skill +14.7% / -23.6%). |
| Wheat | 1-7 | +2.9% | context_only | Real-origin backtest (origins 2025-H2, n=7,982): model +1.8% vs no-change, below the +2% margin required. |
| Wheat | 8-14 | +3.4% | context_only | Real-origin backtest (origins 2025-H2, n=7,111): model +0.1% vs no-change, below the +2% margin required. |
| Wheat | 15-30 | +3.4% | context_only | Real-origin backtest (origins 2025-H2, n=14,923): model -0.1% vs no-change.; Projection backtest (origins 2025-H2, n=9,399): model +1.1% vs the starting price, below the +2% margin required. |
| Wheat | 31-60 | +6.8% | context_only | Real-origin backtest (origins 2025-H2, n=23,437): model -5.6% vs no-change.; Projection backtest (origins 2025-H2, n=15,152): model -4.0% vs the starting price. |

## 2. New candidates (skill vs no-change, %, fold C / fold A / test T)

| crop | band | n (T) | xgb_l2 | xgb_huber | xgb_l2_half | seasonal_med |
|---|---|---|---|---|---|---|
| Onion | 1-7 | 21,567 | -6.8 / -2.0 / -7.2 | -7.0 / -2.7 / -6.8 | +0.7 / +1.1 / -1.0 | -50.6 / -26.4 / -32.4 |
| Onion | 15-30 | 18,438 | -20.1 / -27.7 / -73.8 | -22.8 / -26.9 / -73.7 | +14.0 / -1.9 / -19.6 | -40.5 / -24.4 / -54.9 |
| Onion | 31-60 | 15,580 | -11.3 / -25.4 / -242.8 | -10.2 / -25.4 / -240.6 | +26.0 / +7.1 / -74.2 | -36.8 / -28.9 / -124.7 |
| Onion | 8-14 | 20,022 | -8.7 / -11.1 / -22.6 | -11.7 / -10.2 / -22.4 | +9.4 / +1.1 / -3.5 | -43.2 / -20.1 / -30.3 |
| Potato | 1-7 | 10,006 | -1.6 / +5.9 / +1.9 | -0.3 / +5.9 / +1.8 | +2.1 / +4.8 / +3.2 | -47.0 / -25.4 / -20.6 |
| Potato | 15-30 | 8,736 | +5.1 / -2.4 / +6.2 | +5.1 / -3.0 / +6.0 | +4.8 / +5.8 / +5.5 | -23.2 / -19.1 / -5.8 |
| Potato | 31-60 | 7,481 | +6.3 / -23.5 / +4.5 | +6.6 / -24.3 / +4.3 | +4.2 / -0.0 / +4.5 | -11.1 / -26.3 / -3.9 |
| Potato | 8-14 | 9,454 | +2.8 / +5.7 / +3.3 | +2.7 / +5.0 / +3.5 | +4.4 / +6.8 / +4.8 | -32.0 / -20.1 / -11.1 |
| Tomato | 1-7 | 15,045 | -5.7 / -6.0 / -2.4 | -5.4 / -4.9 / -1.8 | +0.6 / +1.5 / +2.0 | -29.5 / -25.6 / -14.9 |
| Tomato | 15-30 | 13,231 | -6.1 / -81.9 / -1.3 | -6.1 / -81.8 / -2.5 | +4.4 / -11.7 / +9.6 | -58.6 / -107.3 / -4.1 |
| Tomato | 31-60 | 11,396 | +14.6 / -56.5 / +18.5 | +12.6 / -51.7 / +18.1 | +14.6 / +9.9 / +20.8 | -78.7 / -138.0 / +7.2 |
| Tomato | 8-14 | 14,259 | -7.0 / -30.6 / -5.0 | -7.0 / -30.8 / -4.2 | +2.6 / -1.8 / +3.0 | -40.6 / -48.9 / -10.9 |
| Wheat | 1-7 | 20,940 | +8.2 / +1.7 / +2.6 | +8.2 / +1.7 / +2.6 | +6.9 / +3.9 / +4.0 | -20.2 / -23.0 / -34.5 |
| Wheat | 15-30 | 17,679 | +11.8 / +8.0 / -5.9 | +12.0 / +8.6 / -5.5 | +10.7 / +9.7 / +3.6 | -18.3 / -15.5 / -27.2 |
| Wheat | 31-60 | 14,878 | +17.1 / +17.1 / -28.1 | +17.3 / +17.2 / -27.9 | +13.2 / +13.8 / -5.1 | -9.4 / -5.9 / -47.9 |
| Wheat | 8-14 | 19,060 | +13.6 / +6.8 / +6.0 | +13.7 / +7.1 / +6.1 | +11.5 / +7.9 / +7.1 | -16.7 / -14.8 / -23.9 |

## 3. Adoptable (>= +2% in C, A and T)

* Potato 1-7: xgb_l2_half (C +2.1%, A +4.8%, T +3.2%)
* Potato 15-30: xgb_l2_half (C +4.8%, A +5.8%, T +5.5%)
* Potato 8-14: xgb_huber (C +2.7%, A +5.0%, T +3.5%)
* Potato 8-14: xgb_l2 (C +2.8%, A +5.7%, T +3.3%)
* Potato 8-14: xgb_l2_half (C +4.4%, A +6.8%, T +4.8%)
* Tomato 31-60: xgb_l2_half (C +14.6%, A +9.9%, T +20.8%)
* Wheat 1-7: xgb_l2_half (C +6.9%, A +3.9%, T +4.0%)
* Wheat 15-30: xgb_l2_half (C +10.7%, A +9.7%, T +3.6%)
* Wheat 8-14: xgb_huber (C +13.7%, A +7.1%, T +6.1%)
* Wheat 8-14: xgb_l2 (C +13.6%, A +6.8%, T +6.0%)
* Wheat 8-14: xgb_l2_half (C +11.5%, A +7.9%, T +7.1%)
