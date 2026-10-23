# Crop × horizon-band policy: model or context-only

Generated 2026-10-23T09:28:51+00:00 from the backtest reliability table and the frozen Phase B decisions. **Model** = the forecast and its ₹ explanation are shown. **Context-only** = no rise or fall is claimed; the dated records are shown for information.

| Crop | Band (days) | Mode | Real-origin skill | Projection skill | Why |
|---|---|---|---|---|---|
| Brinjal | 1-7 | **model** | +4.7% | +6.6% | The model beat its baseline in both backtests and was not rejected in validation. |
| Brinjal | 8-14 | **model** | +6.6% | +10.1% | The model beat its baseline in both backtests and was not rejected in validation. |
| Brinjal | 15-30 | **model** | +5.4% | +8.7% | The model beat its baseline in both backtests and was not rejected in validation. |
| Brinjal | 31-60 | **model** | +9.0% | +6.3% | The model beat its baseline in both backtests and was not rejected in validation. |
| Cabbage | 1-7 | **model** | +9.3% | +8.5% | The model beat its baseline in both backtests and was not rejected in validation. |
| Cabbage | 8-14 | **model** | +9.6% | +14.7% | The model beat its baseline in both backtests and was not rejected in validation. |
| Cabbage | 15-30 | **model** | +9.5% | +23.0% | The model beat its baseline in both backtests and was not rejected in validation. |
| Cabbage | 31-60 | **model** | +14.3% | +32.0% | The model beat its baseline in both backtests and was not rejected in validation. |
| Cauliflower | 1-7 | **model** | +6.7% | +8.6% | The model beat its baseline in both backtests and was not rejected in validation. |
| Cauliflower | 8-14 | **model** | +12.8% | +12.8% | The model beat its baseline in both backtests and was not rejected in validation. |
| Cauliflower | 15-30 | **model** | +17.6% | +21.9% | The model beat its baseline in both backtests and was not rejected in validation. |
| Cauliflower | 31-60 | **model** | +23.7% | +34.8% | The model beat its baseline in both backtests and was not rejected in validation. |
| Onion | 1-7 | **context-only** | -4.8% | +2.5% | Real-origin backtest (origins 2025-H2, n=7,939): model -4.8% vs no-change. Validation fold A (2025-H1), pooled model vs no-change: -6.0% (market-bootstrap 95% CI -11.7 to -0.8). |
| Onion | 8-14 | **context-only** | -17.2% | +4.8% | Real-origin backtest (origins 2025-H2, n=7,389): model -17.2% vs no-change. Validation fold A (2025-H1), pooled model vs no-change: -6.0% (market-bootstrap 95% CI -11.7 to -0.8). |
| Onion | 15-30 | **context-only** | -33.5% | +4.7% | Real-origin backtest (origins 2025-H2, n=15,418): model -33.5% vs no-change. Validation fold A (2025-H1), pooled model vs no-change: -6.0% (market-bootstrap 95% CI -11.7 to -0.8). |
| Onion | 31-60 | **context-only** | -76.6% | -2.6% | Real-origin backtest (origins 2025-H2, n=24,482): model -76.6% vs no-change. Projection backtest (origins 2025-H2, n=16,477): model -2.6% vs the starting price. Validation fold A (2025-H1), pooled model vs no-change: -6.0% (market-bootstrap 95% CI -11.7 to -0.8). |
| Potato | 1-7 | **context-only** | +2.1% | +3.0% | Validation folds 2024-H2 and 2025-H1: the model did not beat keeping the latest price in both (skill +9.1% / -3.3%). |
| Potato | 8-14 | **context-only** | +3.6% | +5.3% | Validation folds 2024-H2 and 2025-H1: the model did not beat keeping the latest price in both (skill +9.1% / -3.3%). |
| Potato | 15-30 | **context-only** | +4.1% | +4.1% | Validation folds 2024-H2 and 2025-H1: the model did not beat keeping the latest price in both (skill +9.1% / -3.3%). |
| Potato | 31-60 | **context-only** | +7.0% | +2.3% | Validation folds 2024-H2 and 2025-H1: the model did not beat keeping the latest price in both (skill +9.1% / -3.3%). |
| Tomato | 1-7 | **context-only** | +2.0% | +4.2% | Validation folds 2024-H2 and 2025-H1: the model did not beat keeping the latest price in both (skill +14.7% / -23.6%). |
| Tomato | 8-14 | **context-only** | +0.3% | +6.5% | Validation folds 2024-H2 and 2025-H1: the model did not beat keeping the latest price in both (skill +14.7% / -23.6%). Real-origin backtest (origins 2025-H2, n=5,991): model +0.3% vs no-change, below the +2% margin required. |
| Tomato | 15-30 | **context-only** | +1.2% | +15.4% | Validation folds 2024-H2 and 2025-H1: the model did not beat keeping the latest price in both (skill +14.7% / -23.6%). Real-origin backtest (origins 2025-H2, n=12,759): model +1.2% vs no-change, below the +2% margin required. |
| Tomato | 31-60 | **context-only** | +9.3% | +27.1% | Validation folds 2024-H2 and 2025-H1: the model did not beat keeping the latest price in both (skill +14.7% / -23.6%). |
| Wheat | 1-7 | **context-only** | +1.8% | +4.8% | Real-origin backtest (origins 2025-H2, n=7,982): model +1.8% vs no-change, below the +2% margin required. |
| Wheat | 8-14 | **context-only** | +0.1% | +6.2% | Real-origin backtest (origins 2025-H2, n=7,111): model +0.1% vs no-change, below the +2% margin required. |
| Wheat | 15-30 | **context-only** | -0.1% | +1.1% | Real-origin backtest (origins 2025-H2, n=14,923): model -0.1% vs no-change. Projection backtest (origins 2025-H2, n=9,399): model +1.1% vs the starting price, below the +2% margin required. |
| Wheat | 31-60 | **context-only** | -5.6% | -4.0% | Real-origin backtest (origins 2025-H2, n=23,437): model -5.6% vs no-change. Projection backtest (origins 2025-H2, n=15,152): model -4.0% vs the starting price. |
