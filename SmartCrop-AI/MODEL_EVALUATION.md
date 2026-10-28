# Model Evaluation

All numbers below were produced by the training scripts in `backend/scripts/` on the data in
`dataset/raw/` and the generated crop dataset (daily price model `202610101837`; the monthly
price and crop models are versioned in their `metadata.json`). Re-running the scripts regenerates them; the raw
outputs live in `backend/trained_models/*/` (`metadata.json`, `cv_fold_metrics.csv`,
`cv_per_crop_metrics.csv`, `classification_report.csv`, `confusion_matrix.csv/.png`,
`weight_sensitivity.json`).

---

## 1. Daily price forecasting (every day, 1–60 days ahead)

### 1.1 Set-up

| Item | Value |
|---|---|
| Data | Maharashtra APMC mandi prices, 2023-01-01 → 2025-12-31, 7 crops |
| Unit of prediction | One series = (market, crop, variety), plus a state-median series per crop |
| Forecast origins usable for training | 219,941 (days a market reported a price **and** all features exist) |
| Target | `log(price[t+h] / price[t])` — the % change over *h* days, for every h = 1 … 60 |
| Approach | **Direct multi-horizon**: each training row is an (origin, h) pair = the origin's features (data ≤ t only) + h + the target day-of-year. Every date is predicted directly from data known at the origin — **no recursion**, so no predicted price or future arrival is ever used as an input and errors do not compound. |
| Validation | Expanding-window rolling-origin CV, 4 folds = the 4 quarters of 2025, all 60 horizons |
| Leakage control | Training pairs restricted to those whose target date `t+h` is **before** the test quarter. Data is never shuffled across time. Features only use data ≤ t (unit-tested in `tests/test_ml_pipeline.py`). |
| Sampling | 400,000 (origin, h) pairs per CV fit (Random Forest: 200,000), up to 1,000,000 test pairs per quarter; 600,000 pairs for the final fit |
| Metrics | On the price in ₹/quintal: MAE, RMSE, MAPE; also R² on the *change* and direction accuracy |

**Why not recursive?** Feeding day *d*'s prediction back in as the lag for day *d+1* needs a
forecast of every other input (arrivals, state prices) and lets errors compound. Direct models
avoid both; the only cost is one (larger) training set of (origin, horizon) pairs.

**Candidates.** Random Forest and XGBoost, each in two target forms:
* *plain* — the model predicts the h-day change;
* *rate* — the model predicts the average **daily** change (forecast = h × prediction),
  trained with weight h² so the loss is still the squared error of the h-day change.

A single plain model averages changes over all horizons inside each leaf, so long-horizon
patterns leaked into 1-day forecasts (1-day MAE ₹188 vs ₹124 for "no change"). The rate form
fixes short horizons; the plain form is better far ahead. **For each horizon the candidate with
the lowest CV MAE (pooled over crops, smoothed over ±3 days) is used:**

| Days ahead | Model |
|---|---|
| 1–12 | XGBoost, rate form |
| 13–35 | Random Forest, rate form |
| 36–60 | Random Forest, plain form |

(Histogram Gradient Boosting was within 3 % of XGBoost in the earlier 7/14/30-day study and
is no longer compared.)

### 1.2 Results (mean of 4 folds, ₹/quintal)

| Days ahead | Selected MAE | "No change" MAE | Seasonal naive MAE | Selected RMSE | "No change" RMSE | Direction acc. % |
|---|---|---|---|---|---|---|
| 1 | 129.3 | **123.5** | 220.3 | **277.6** | 295.1 | 32.4 |
| 7 | **266.2** | 278.2 | 419.9 | **462.9** | 507.6 | 51.5 |
| 14 | **341.7** | 351.3 | 514.4 | **579.3** | 618.8 | 52.1 |
| 30 | 433.5 | **427.3** | 638.7 | **701.5** | 719.7 | 55.8 |
| 45 | **493.0** | 499.3 | 715.2 | **782.2** | 830.7 | 58.2 |
| 60 | **512.7** | 524.4 | 766.1 | **807.7** | 842.6 | 60.0 |
| all 1–60 | **400.0** | 406.5 | 598.9 | **668.9** | 709.5 | 54.9 |

For comparison, the former separate 7-, 14- and 30-day Random Forests scored ₹263, ₹342 and
₹442: the new forecaster is about equal at 7 and 14 days, better at 30 days, and also covers
every day in between and up to 60 days.

### 1.3 Honest reading of these results

* **Mandi prices are hard to predict.** Over all horizons the forecaster is ~2 % better than
  "no change" on MAE and ~6 % on RMSE. It is never far better; the app says so.
* **Tomorrow's price is best guessed by today's price.** At 1 day ahead no model beat "no
  change" on MAE for any crop. Day 1 is therefore never "validated".
* **Reliability is judged per crop and per day.** A day *h* is *validated* for a crop only if
  the forecaster's CV MAE beat "no change" both at exactly *h* and pooled over *h ± 3* days:

| Crop | Validated days ahead | MAE 7d model / naive | MAE 30d model / naive | MAE 60d model / naive |
|---|---|---|---|---|
| Brinjal | 2–60 | 618 / 656 | 884 / 1001 | 941 / 1154 |
| Cabbage | 2–60 | 175 / 195 | 268 / 301 | 326 / 388 |
| Cauliflower | 2–60 | 368 / 402 | 519 / 592 | 631 / 743 |
| Potato | 2–60 | 122 / 127 | 186 / 195 | 227 / 232 |
| Wheat | 3–60 | 86 / 91 | 116 / 121 | 135 / 149 |
| Tomato | 2–8 | 371 / 377 | 736 / 609 ✗ | 851 / 791 ✗ |
| **Onion** | **none** | 187 / 180 ✗ | 356 / 285 ✗ | 448 / 348 ✗ |

  (MAE columns pooled over ±3 days.) **Onion is not validated at any horizon**: in 2025 its
  price moved in ways the model could not anticipate better than "no change". The app still
  shows the forecast, drawn grey as "less reliable", and its advice for onion is
  *"Forecast too uncertain to pick an exact date — compare current mandi prices"*.
* Unvalidated days are drawn grey in the chart, flagged on the result page, and **never used
  by the best-time-to-sell advice**. The chart extends past the farmer's date only up to the
  last validated day.

### 1.4 Prediction range

The range shown to users is the 10th–90th percentile of the selected forecaster's
**out-of-fold CV errors** (log scale) per crop and horizon (pooled over ±3 days; pooled over
crops when fewer than 200 errors exist). By construction these bands cover 80 % of the CV
errors they were built from; they are an empirical error range, **not** a confidence level,
and no confidence percentage is shown.

### 1.5 "Stable" band and the advice threshold

A forecast counts as *Stable* when the predicted change is smaller than the median absolute CV
error for that crop and horizon. The best-time-to-sell advice uses the same yardstick: another
date is recommended only if its predicted price differs from the farmer's date by more than
this typical error at the longer of the two horizons. Smaller differences are reported but
not acted on ("Sell around your selected date — compare mandi prices").

### 1.6 Global feature importance (mean |SHAP|, recent origins, all horizons)

| Rank | Feature | Meaning |
|---|---|---|
| 1 | log_price | Current price level (mean reversion) |
| 2 | commodity_code | Crop |
| 3 | doy_cos | Time of year at the forecast date |
| 4 | target_doy_cos | Time of year at the target date |
| 5 | lag_30_change | Change over the last 30 days |
| 6 | roll_mean_30_gap | Price vs 30-day average |

Price level and seasonality dominate; short horizons also lean on recent momentum and the
gap to the state median.

---|---|---|---|
| 1 | state_price_gap | log_price | log_price |
| 2 | state_change_7 | state_price_gap | doy_cos (season) |
| 3 | roll_mean_7_gap | doy_cos (season) | commodity_code |
| 4 | log_price | state_change_7 | lag_30_change |
| 5 | doy_cos (season) | commodity_code | state_price_gap |

Short horizons are driven by recent momentum and how a market compares to the state;
longer horizons rely more on the price level (mean reversion) and time of year.

---

## 2. Monthly (selling-month) price forecasting — XGBoost

Used by the crop recommendation to price each crop in the user's city at the selling month.
Code: `backend/app/ml/price_prediction/monthly.py` (features), `monthly_forecaster.py`
(serving), `backend/scripts/train_monthly_price_model.py` (training).

### 2.1 Set-up
* Series: monthly median modal price per (city, crop) over the city's markets, plus a
  state-wide series per crop — 80 series, Jan 2023 – Dec 2025.
* Prices are deflated with an assumed **5 %/year inflation**; the model predicts the real log
  change `log(p[t+h]/p[t])` for h = 1–24 months (direct multi-horizon; h is a feature);
  inflation is added back explicitly. 45,096 (origin, horizon) training pairs.
* Features (all from data ≤ origin): horizon, origin/target calendar month, crop, city,
  1- and 3-month momentum, price vs 3- and 12-month average, 6-month volatility, arrivals vs
  12-month average, city premium over the state median, and **seasonal priors** (historical
  price and arrivals change from origin month to target month, rebuilt from the history
  available at the origin). A unit test checks that later prices never change origin features.
* **De-drifting**: each crop's linear real-price trend over the training window is removed
  from the target and not projected forward (three years cannot identify a trend: 2023-24
  rises were followed by a 2025 crash). Without this, XGBoost was *worse* than both
  baselines (MAE ₹860 vs ₹630 seasonal naive); with it, it beats them (below).
* Validation: two time-ordered cut-offs (2024-12, 2025-06); for each, train on pairs whose
  target is ≤ cut-off and test on forecasts made at or before the cut-off for the next 6
  months — genuine out-of-sample forecasts. Baselines: *naive* (latest price + inflation)
  and *seasonal naive* (same calendar month last year + inflation).

### 2.2 Results (out-of-fold, ₹/quintal)

| Horizon (months) | n | XGBoost MAE | Naive MAE | Seasonal-naive MAE | XGBoost MAPE |
|---|---|---|---|---|---|
| 1–3 | 960 | **665** | 673 | 794 | 58 % |
| 4–6 | 2,399 | **676** | 857 | 735 | 56 % |
| 7–12 | 5,754 | **737** | 870 | 743 | 56 % |
| 13–24 | 11,508 | 538 | 675 | **537** | 37 % |
| All | 20,621 | **616** | 750 | 630 | 45 % |

Per crop (MAE, model vs naive): Brinjal 695 vs 1,050 · Cabbage 365 vs 459 · Cauliflower
530 vs 713 · Tomato 624 vs 1,104 — **better**; Onion 1,053 vs 1,016 · Potato 639 vs 512 ·
Wheat 332 vs 253 — **worse than naive**. For those three crops the UI says the price is
indicative (`reliability.beats_baseline = false`).

### 2.3 Honest reading
* The model beats "no change" at every horizon and seasonal naive up to 12 months; at 13–24
  months it ties seasonal naive. Errors are large (MAPE 37–58 %) because vegetable prices
  swing by 2–4× within a year and the test period contains the 2025 price crash.
* The likely range (10th–90th percentile of out-of-fold log errors per horizon bucket) is
  **skewed downward** (e.g. 1–3 months: −58 % … +8 % around the forecast) because the model
  over-predicted during the 2025 crash. This is shown, not hidden.
* Data end in Dec 2025, so a selling month in 2027 is 13–24 months ahead. Beyond 24 months
  the same calendar month within the modelled range is used and inflation covers the full
  period (flagged `beyond_model_horizon`).

---

## 3. Crop recommendation — suitability classifier (XGBoost)

### 3.1 Set-up
* Data: `crop_dataset_extended.csv` — 8,400 rows, 7 crops × 1,200: the 4,550 original simulated rows
  (`source = original`, no soil type → `unknown`) plus 3,850 synthetic rows (`source = synthetic`) covering the
  app's full input ranges and the soil types, see README §6.2.1. Both are simulated, not measured on farms.
* Features: N, P, K, temperature, humidity, pH, rainfall, soil type (one-hot inside the pipeline), city (code),
  planting month, selling month, growing months (derived).
* Split: stratified 80/20 hold-out of the **original rows only** (910 test rows); synthetic rows are used for
  training only. Model comparison by 5-fold CV on the training part (3,640 original + 3,850 synthetic rows).

### 3.2 Model comparison (5-fold CV, mean ± std)

| Model | Accuracy | F1 (macro) |
|---|---|---|
| Logistic regression (baseline) | 0.834 ± 0.009 | 0.833 ± 0.009 |
| Random Forest | 0.838 ± 0.011 | 0.836 ± 0.011 |
| **XGBoost (deployed)** | 0.859 ± 0.009 | 0.859 ± 0.009 |

### 3.3 Hold-out test set (910 original rows), before vs after adding synthetic rows

| XGBoost trained on | Accuracy | Precision (macro) | Recall (macro) | F1 (macro) |
|---|---|---|---|---|
| Original training rows only (before) | 0.851 | 0.851 | 0.851 | 0.851 |
| Original + synthetic rows (after, deployed) | 0.851 | 0.850 | 0.851 | 0.850 |

Per crop F1 (after): Wheat 0.981, Potato 0.961, Onion 0.911, Brinjal 0.841, Tomato 0.786, Cauliflower 0.773, Cabbage 0.698. The metrics are unchanged within noise: the test rows come from the old simulator, which
the synthetic rows do not try to imitate, so this shows the extension did not hurt there. It says nothing about
dry-season or soil-type accuracy on real farms (no real data). Confusion matrices: `confusion_matrix.csv` (after),
`confusion_matrix_before.csv`. This accuracy describes separability of simulated data, **not field accuracy**.

Global SHAP importance (mean |SHAP|, log-odds): K 1.38, P 0.95, N 0.79, pH 0.70, growing
months 0.80, temperature 0.52, humidity 0.50, planting month 0.49, city 0.36, rainfall 0.31,
soil type 0.17, selling month 0.11.

---

## 4. Smart economic recommendation score

Defined in `backend/app/ml/crop_recommendation/recommender.py`; profit in
`backend/app/ml/economics/profit.py`.

```
Agronomic A = 100 × (soil + weather values inside the crop's typical range) / 7
              (N, P, K, pH, temperature, humidity, rainfall; typical = 5th-95th percentile of that crop's rows)
Timing    T = 50% planting-window fit + 50% selling fit (fresh 100, −12/month stored, 0 if not ready or spoiled)
Profit    P = 50 + 50·tanh(ROI), ROI = net profit / (cultivation + storage cost); 0 if infeasible
Overall     = 0.40·A + 0.20·T + 0.40·P
Recommended = at least 5 of 7 values in range AND sellable in the chosen month AND net profit > 0 (top 3 of these)
Best overall = first recommended crop; Highest profit = feasible crop with the largest net profit (reported separately)
```

**Why A is not the classifier probability (changed).** The XGBoost probability is *relative*: it
says which of the seven crops the inputs resemble most. For Nashik inputs typical of onion, onion
scored 99.8 % and brinjal 0.1 % although all 7 values were inside brinjal's range too, so a 40 %
weight on that number decided the ranking regardless of profit (onion ₹17K vs brinjal ₹1.4 L).
The share of values in range is an absolute "can it grow here" measure, matches the counts shown
on the page, and lets profit separate crops that fit equally well. The classifier probability is
still returned as `model_match_score` and explained by SHAP in the advanced section. The "at
least 5 of 7" viability rule is a design choice: each range covers 90 % of the crop's training
rows, so a suitable field normally has about 6 of 7 inside.

Net profit = yield × (1 − losses) × forecast price × (1 − marketing %) − cultivation cost
(inflated to the planting year) − storage cost. The best selling month (highest projected
net profit within the crop's harvest + storage window) is reported on the timeline.

There is no ground truth for "best crop to plant", so the weights are a documented design
choice. **Sensitivity** (`scripts/score_sensitivity.py`, 300 dataset profiles): the dataset
label (the crop a profile was generated for) is in the default top 3 in 73.7 % of cases (it was
99.3 % when the classifier probability was the agronomic term). That drop is expected: the label
records which crop the profile resembles, not which crop earns most, and the new rule lets any
crop that fits (≥ 5 of 7 values) compete on profit. Changing the weights moves the #1 crop in
1 %–18 % of cases (same #1: 81.7 % suitability-heavy, 89.7 % profit-heavy, 99.3 % equal thirds,
98.7 % no-timing), so the ranking between several well-fitting crops depends on the chosen weights.

---

## 5. Explainability checks

* SHAP values are computed per request with `shap.TreeExplainer` on the deployed models.
* Additivity is tested: daily price model (log change), crop classifier (base + Σ SHAP =
  log-odds margin, `test_explain_shap_additivity`) and monthly price model (base + Σ SHAP +
  inflation = log(forecast / latest price), `test_market_forecast_and_price_shap`).
* Explanations pair an observed fact from the data (e.g. "In 2023–2025, Onion prices in March
  averaged 25 % below the yearly average"; "arrivals rise about 22 %") with the direction and
  size of the SHAP effect.

## 6. Test suite

`cd backend && python -m pytest` → **47 passed** (auth, JWT, price API, monthly price API,
7-crop recommendation, score formula, economics arithmetic, storage and timing feasibility,
SHAP additivity for all three models, per-user history isolation, pagination, migration ↔
model consistency, look-ahead checks for daily and monthly features).

---

## Weather and soil as inputs of the daily price model (tested, not adopted)

`python -m scripts.evaluate_environment_features` fits the production XGBoost "rate" model with extra inputs and compares it with the
deployed feature set on exactly the same (origin, horizon) pairs, hyper-parameters and the four 2025 quarterly rolling-origin folds of the
main evaluation (250,000 training and 200,000 test pairs per fold; training pairs need a target date before the test quarter). Raw output:
`dataset/reports/environment_feature_eval.json`.

Inputs tested: trailing observed weather up to the forecast origin at the **selling market's town** (temperature: `temp_mean_7`,
`temp_anom_7`; rainfall: `precip_sum_7`, `precip_sum_30`, `precip_ratio_30`; humidity: `humidity_mean_7`), and the **climatological normal at
the target date** (normal temperature and 30-day rainfall for the day t+h, normals from years <= 2022: known in advance, aligned to the
horizon, no future observation). The price data has no growing location, so a growing location cannot be a trained input.

| Variant (all 1-60 days) | MAE | RMSE | MAE vs baseline | RMSE vs baseline | folds with lower MAE | worst fold |
|---|---|---|---|---|---|---|
| "no change" | 405.6 | 721.4 | | | | |
| deployed features (baseline) | 413.7 | 700.7 | | | | |
| + temperature | 413.8 | 697.9 | -0.01 % | +0.40 % | 1 / 4 | +1.76 % |
| + rainfall | 414.0 | 707.4 | -0.06 % | -0.96 % | 2 / 4 | +2.59 % |
| + humidity | 412.9 | 704.5 | +0.21 % | -0.53 % | 2 / 4 | +0.89 % |
| + all six weather features | 410.7 | 692.3 | +0.73 % | +1.20 % | 2 / 4 | +1.70 % |
| + climate at target date | 414.3 | 700.8 | -0.14 % | -0.01 % | 1 / 4 | +0.31 % |
| + weather + climate | 413.0 | 718.3 | +0.19 % | -2.51 % | 2 / 4 | +4.19 % |

(positive = better than the baseline.) Adoption rule, fixed before the run: pooled MAE **and** RMSE each >= 2 % better, MAE better in at
least 3 of 4 folds, and no fold more than 2 % worse. **No variant passes**, so the deployed model, its artifacts and its explanations are
unchanged. On this sample the plain "no change" forecast has a lower MAE than the model (the model is better on RMSE), consistent with
section 1.3.

**Soil was not evaluated.** Soil pH and soil group would be regional SoilGrids estimates for the selling market's town (static in time, so
they can only describe the market). The SoilGrids services could not be reached from the environment where this was run, and no historical
soil table exists in the repository, so there is nothing to train on and no value was invented. `python -m scripts.build_market_soil` builds
`dataset/soil/market_soil.csv` when the services are reachable; `evaluate_environment_features` then adds `+soil` and `+all` variants
automatically, and the forecaster already joins `soil_ph` / `soil_class_code` if a model is ever trained with them.

Data limits: weather history exists for 66 of the 297 markets (about 72 % of usable forecast origins, including the state-median series);
other markets have no weather features (NaN). The live forecast is projected from the same calendar day one year earlier because the data ends
2025-12-31, so serving-time weather features would describe last year's weather, not the current season.


---

## Why Onion, Potato, Tomato and Wheat show no daily forecast (diagnosis and crop-model test)

`python -m scripts.diagnose_price_forecasts` runs the real forecaster for every supported crop on the state-median series, the best-covered
markets and the two thinnest listed markets (report: `dataset/reports/price_forecast_diagnostics.md`). Result, identical in every market:

| Crop | Forecast produced | Reliability policy | Validated days in the 30-day window |
|---|---|---|---|
| Brinjal, Cabbage, Cauliflower | yes, every market tested | `model` | 29 of 30 (day 1 never validates) |
| Onion | yes | `context_only` in every band | 0 |
| Potato, Tomato | yes | `context_only` in every band | 0 |
| Wheat | yes | `context_only` in every band | 0 |

The cause is not missing data or an inference error: the markets tested have 800-980 usable reports each. It is the crop-level reliability
rule (`scripts/build_crop_policy.py`): a crop is model-backed only if it beats "price stays unchanged" by 2 % in the validation folds, the
2025-H2 real-origin test and the projection test. Onion: the model is 17-77 % worse than no-change in 2025-H2. Tomato and Potato fail the
validation folds. Wheat is at +0.1 % to +1.8 % in the short bands and negative beyond 14 days. A market with stale or thin records
(for example latest report 2025-08-25) is served from the state-median series, and the response says so.

**Would a crop-specific model fix it?** `python -m scripts.evaluate_crop_models` (same chronological folds and features; the 0.5 damping was
fixed in advance, not tuned; details in `dataset/reports/crop_model_eval*.json`):

| Crop | pooled (deployed) vs no-change | crop-specific | crop-specific, change halved | projection test, halved vs x1.05 start |
|---|---|---|---|---|
| Onion | -40.9 % | -66.1 % | -12.1 % | -21.2 % |
| Potato | -2.8 % | -8.4 % | +3.6 % | -14.7 % |
| Tomato | -11.9 % | -21.7 % | +7.0 % | -1.3 % |
| Wheat | -6.3 % | -0.7 % | +7.8 % | +12.4 % |

(MAE, 2025 quarterly folds; positive = better.) A model trained on one crop alone is worse than the pooled one, because it reacts too
strongly to recent moves. Halving its predicted change helps Potato, Tomato and Wheat in the real-origin folds but **fails the projection
test for Potato and Tomato**, and Onion fails everything. Wheat's halved model is the only lead: it beats "no change" in 5 of 6 folds
(2024-Q3 to 2025-Q4: 116.0 / 141.4 / 153.9 / 87.4 / 88.7 / 88.2 against 135.7 / 152.5 / 178.1 / 99.5 / 89.7 / 86.7) and beats the starting
price in the projection test, **but in the held-out 2025-H2 period it is no better than "no change"** (88.5 vs 88.2 mean MAE), which
the policy requires. So no crop-specific model is deployed, and no threshold was changed. A Wheat model would need new data (the
2026 prices) or a method that holds up in 2025-H2 before it could be validated; it would also need its own reliability table before the
forecaster could mark it validated.


**Weather effect by crop** (`--only +weather`, `dataset/reports/environment_feature_eval_by_crop.json`; MAE without / with the six trailing
weather features, same folds and pairs): Brinjal 860 / 857, Cabbage 263 / 261, Cauliflower 507 / 496 (-2.2 %), Onion 375 / 377, Potato
187 / 195 (+4.3 % worse), Tomato 684 / 662 (-3.2 %), Wheat 119 / 122 (+2.5 % worse). The effect changes sign between crops (and between
quarters), so it is not a stable relationship the model can be said to have learned; weather stays out of the deployed model.
