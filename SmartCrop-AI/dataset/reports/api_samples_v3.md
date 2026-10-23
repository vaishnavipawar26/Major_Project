# Six real predictions through the API (in-process, temporary SQLite; today = 2026-10-23)

Each section shows the result-page text rendered by the real `PriceResult` component from the API response, then the full `v3` explanation JSON the explanation page receives.

Note: *Days ahead* is counted from the market's last report in the reference year, which can be earlier than the same calendar day (e.g. 17 Oct 2025 for APMC Mumbai), so it can exceed the number of days requested.

## 1 Tomato · APMC Mumbai · 12 days

- policy: **context_only** (15-30 days) · range coverage measured: 71.2% (n=7874), range shown: True
- result page label: Your selling date 4 Nov 2026
- **result-page headline:** No clear direction — expected to stay near ₹4,250 (latest recorded price, 31 Dec 2025)The model is not used to predict a rise or fall for this crop and distance. In testing, estimates like this missed by about ₹935 per quintal.
- range line: None
- selling advice badge: Reliable comparison unavailable

```json
{
 "schema_version": 3,
 "method": "SHAP values of the model are summed per group in log space; the predicted change in rupees is split in proportion: inr_g = start * s_g * (exp(L) - 1) / L, with L the model's log price ratio, so the group effects and the baseline drift add up exactly to the predicted change. Effects are on the starting price shown.",
 "context_only": true,
 "context_reason": "In testing, the model did not reliably beat keeping the latest price for Tomato, 15-30 days ahead, so it is not used to predict a rise or fall.",
 "headline": {
  "code": "no_clear_direction",
  "text": "No clear direction for Tomato by 4 Nov 2026. In testing, the model did not reliably beat keeping the latest price for Tomato, 15-30 days ahead, so it is not used to predict a rise or fall. The records below are context only.",
  "predicted_price": null,
  "start_price": 1890.0,
  "change_inr": null,
  "change_pct": null,
  "typical_miss_inr": 934.57,
  "range": null,
  "range_hidden": false,
  "range_coverage_pct": null,
  "target_date": "2026-11-04",
  "horizon_days": 18,
  "band": "15-30"
 },
 "banner": {
  "text": "No 2026 market data yet — this forecast replays the same season of 2025.",
  "detail": "The starting price is the 17 Oct 2025 price plus 5% for a year's inflation. Every figure below is dated from 2025 records.",
  "reference_date": "2025-10-17"
 },
 "cards": [
  {
   "group": "supply",
   "title": "Supply (arrivals)",
   "direction": null,
   "inr_effect": null,
   "inr_effect_rounded": null,
   "log_contribution": null,
   "effect_text": "Shown as context. It is not used to claim a rise or fall.",
   "evidence": "Reported arrivals at APMC Mumbai, 18 Sep–17 Oct 2025: 183 a day (as reported), close to the October average of 2023 and 2024 (192 a day).",
   "evidence_available": true,
   "mechanism": null,
   "agreement": {
    "flag": "context",
    "text": "No model push is shown for this crop; these records are for information."
   }
  },
  {
   "group": "market",
   "title": "Your selected market",
   "direction": null,
   "inr_effect": null,
   "inr_effect_rounded": null,
   "log_contribution": null,
   "effect_text": "Shown as context. It is not used to claim a rise or fall.",
   "evidence": "APMC Mumbai's price averaged 37% above the Maharashtra median for Tomato over 21 Jul–17 Oct 2025 (₹2,617 vs ₹1,907, 72 reporting days).",
   "evidence_available": true,
   "mechanism": null,
   "agreement": {
    "flag": "context",
    "text": "No model push is shown for this crop; these records are for information."
   }
  },
  {
   "group": "trend",
   "title": "Recent price trend",
   "direction": null,
   "inr_effect": null,
   "inr_effect_rounded": null,
   "log_contribution": null,
   "effect_text": "Shown as context. It is not used to claim a rise or fall.",
   "evidence": "Price on 17 Oct 2025: ₹1,800; +71% since 17 Sep 2025 (30 days) and +20% since 19 Jul 2025 (90 days).",
   "evidence_available": true,
   "mechanism": null,
   "agreement": {
    "flag": "context",
    "text": "No model push is shown for this crop; these records are for information."
   }
  },
  {
   "group": "last_year",
   "title": "Compared with last year",
   "direction": null,
   "inr_effect": null,
   "inr_effect_rounded": null,
   "log_contribution": null,
   "effect_text": "Shown as context. It is not used to claim a rise or fall.",
   "evidence": "Price on 17 Oct 2025: ₹1,800, 57% lower than on 17 Oct 2024 (₹4,200).",
   "evidence_available": true,
   "mechanism": null,
   "agreement": {
    "flag": "context",
    "text": "No model push is shown for this crop; these records are for information."
   }
  },
  {
   "group": "seasonal",
   "title": "Seasonal pattern",
   "direction": null,
   "inr_effect": null,
   "inr_effect_rounded": null,
   "log_contribution": null,
   "effect_text": "Shown as context. It is not used to claim a rise or fall.",
   "evidence": "Tomato: in 2024 the price changed -49% between 17 Oct 2024 and 4 Nov 2024; in 2023 the price changed +20% between 17 Oct 2023 and 4 Nov 2023 (average -14%).",
   "evidence_available": true,
   "mechanism": null,
   "agreement": {
    "flag": "context",
    "text": "No model push is shown for this crop; these records are for information."
   }
  }
 ],
 "other_factors": null,
 "evidence_not_used_by_model": [],
 "market_breakdown": {
  "applicable": true,
  "context_only": true,
  "market": "APMC Mumbai",
  "text": "Over 21 Jul–17 Oct 2025, APMC Mumbai averaged ₹2,617 against ₹1,907 at the median Maharashtra market: a premium of +₹710 (recorded prices, not a forecast).",
  "evidence": "APMC Mumbai traded 37% above the Maharashtra median over that period."
 },
 "trust": {
  "scenario": "projection",
  "cell": "Tomato|15-30",
  "available": true,
  "n": 7874,
  "mae": 934.5684,
  "wape_pct": 44.1537,
  "baseline": "starting price (reference-year price x 1.05, model ratio = 1)",
  "baseline_mae": 1105.3036,
  "beats_baseline": true,
  "direction_acc_pct": 58.3143,
  "n_meaningful_moves": 7012,
  "range_coverage_pct": 71.2471,
  "range_mean_width_pct": 111.179,
  "lines": [
   "In 7,874 backtest forecasts for Tomato, 15-30 days ahead, the average miss was about ₹935 per quintal (44%); the baseline “starting price (reference-year price x 1.05, model ratio = 1)” missed by ₹1,105.",
   "The model beat that baseline here.",
   "It called the direction right in 58% of the 7,012 cases where the price moved by more than 5% (32% of those moves were rises).",
   "The 80% range contained the actual price in 71% of these forecasts (it should be about 80%)."
  ],
  "warnings": [
   "The range was too narrow in past tests: actual prices fell outside it 29% of the time, so treat it as a minimum spread.",
   "These figures come from tests of the same kind of forecast (starting from last year's prices), which is less accurate than forecasting from current prices."
  ]
 },
 "checks": {
  "inr_sum": null,
  "predicted_change_inr": null,
  "reconstruction_error": 0.0
 },
 "policy": {
  "mode": "context_only",
  "band": "15-30",
  "reasons": [
   "Validation folds 2024-H2 and 2025-H1: the model did not beat keeping the latest price in both (skill +14.7% / -23.6%)."
  ]
 }
}
```

## 2 Wheat · state median · 7 days

- policy: **model** (1-7 days) · range coverage measured: 23.3% (n=4712), range shown: False
- result page label: Expected market price on 30 Oct 2026
- **result-page headline:** ₹2,659 per quintal
- range line: Range not shown — in testing the real price rarely fell inside it
- selling advice badge: None

```json
{
 "schema_version": 3,
 "method": "SHAP values of the model are summed per group in log space; the predicted change in rupees is split in proportion: inr_g = start * s_g * (exp(L) - 1) / L, with L the model's log price ratio, so the group effects and the baseline drift add up exactly to the predicted change. Effects are on the starting price shown.",
 "headline": {
  "code": "about_the_same",
  "text": "About the same: the model's expected change for Wheat (₹18) is smaller than its typical miss in backtests (about ₹277 per quintal at this distance), so no rise or fall is claimed.",
  "predicted_price": 2658.95,
  "start_price": 2640.75,
  "change_inr": 18.2,
  "change_pct": 0.69,
  "typical_miss_inr": 277.26,
  "range": null,
  "range_hidden": true,
  "range_coverage_pct": 23.3022,
  "target_date": "2026-10-30",
  "horizon_days": 7,
  "band": "1-7"
 },
 "banner": {
  "text": "No 2026 market data yet — this forecast replays the same season of 2025.",
  "detail": "The starting price is the 23 Oct 2025 price plus 5% for a year's inflation. Every figure below is dated from 2025 records.",
  "reference_date": "2025-10-23"
 },
 "cards": [
  {
   "group": "trend",
   "title": "Recent price trend",
   "direction": "up",
   "inr_effect": 18.27,
   "inr_effect_rounded": 18,
   "effect_text": "Recent price trend pushed the forecast up by about ₹18.",
   "log_contribution": 0.006894,
   "evidence": "Price on 23 Oct 2025: ₹2,515; -2% since 23 Sep 2025 (30 days) and about unchanged since 25 Jul 2025 (90 days).",
   "evidence_available": true,
   "mechanism": null,
   "agreement": {
    "flag": "disagree",
    "text": "The price has been falling recently, but the model pushed the forecast higher. The reason is not visible from the records shown."
   }
  },
  {
   "group": "seasonal",
   "title": "Seasonal pattern",
   "direction": "up",
   "inr_effect": 14.19,
   "inr_effect_rounded": 14,
   "effect_text": "Seasonal pattern pushed the forecast up by about ₹14.",
   "log_contribution": 0.005357,
   "evidence": "Wheat: in 2024 the price changed +2% between 23 Oct 2024 and 30 Oct 2024; in 2023 the price changed +3% between 23 Oct 2023 and 30 Oct 2023 (average +2%).",
   "evidence_available": true,
   "mechanism": null,
   "agreement": {
    "flag": "agree",
    "text": "In earlier years prices rose over this period, and the model pushed the forecast higher."
   }
  },
  {
   "group": "market",
   "title": "Maharashtra median prices",
   "direction": "down",
   "inr_effect": -11.39,
   "inr_effect_rounded": -11,
   "effect_text": "Maharashtra median prices pushed the forecast down by about ₹11.",
   "log_contribution": -0.004297,
   "evidence": "This forecast is for the Maharashtra median, so no single-market comparison applies.",
   "evidence_available": false,
   "mechanism": null,
   "agreement": {
    "flag": "no_evidence",
    "text": "No comparable records, so the evidence cannot be compared with the model's push."
   }
  },
  {
   "group": "supply",
   "title": "Supply (arrivals)",
   "direction": "up",
   "inr_effect": 2.1,
   "inr_effect_rounded": 2,
   "effect_text": "Supply (arrivals) had almost no effect on the forecast.",
   "log_contribution": 0.000792,
   "evidence": "Reported arrivals across the markets that reported, 24 Sep–23 Oct 2025: 935 a day (as reported), 26% above the October average of 2023 and 2024 (739 a day).",
   "evidence_available": true,
   "mechanism": "More supply usually lowers prices.",
   "agreement": {
    "flag": "disagree",
    "text": "Arrivals above the usual level normally go with lower prices, but the model pushed the forecast higher. The reason is not visible from the records shown."
   }
  }
 ],
 "other_factors": {
  "inr_total": -4.98,
  "inr_total_rounded": -5,
  "text": "Other factors: −₹5",
  "parts": [
   {
    "label": "Current price level",
    "inr": -63.97,
    "meaning": null
   },
   {
    "label": "This crop's usual behaviour in past data",
    "inr": 31.02,
    "meaning": null
   },
   {
    "label": "How many days ahead",
    "inr": -0.81,
    "meaning": null
   },
   {
    "label": "Recent price swings",
    "inr": 11.3,
    "meaning": null
   },
   {
    "label": "Week number and day of the week",
    "inr": 5.39,
    "meaning": null
   },
   {
    "label": "The model's usual drift over past data (baseline)",
    "inr": 12.09,
    "meaning": null
   }
  ],
  "swing_evidence": "Over the 30 days to 23 Oct 2025 the price typically moved about 1.5% from one reported day to the next.",
  "note": "Price level, the crop's usual pattern in past data, days ahead, recent swings and the model's baseline drift. The model gives no reason for these beyond the patterns it learned, so none is claimed."
 },
 "evidence_not_used_by_model": [
  {
   "group": "last_year",
   "title": "Compared with last year",
   "evidence": "Price on 23 Oct 2025: ₹2,515, 10% lower than on 23 Oct 2024 (₹2,780).",
   "note": "Measured from the records, but the forecast model does not use it, so it did not move this forecast."
  }
 ],
 "market_breakdown": {
  "applicable": false,
  "text": "This forecast is for the Maharashtra median, so there is no single-market premium."
 },
 "trust": {
  "scenario": "projection",
  "cell": "Wheat|1-7",
  "available": true,
  "n": 4712,
  "mae": 277.2601,
  "wape_pct": 10.4982,
  "baseline": "starting price (reference-year price x 1.05, model ratio = 1)",
  "baseline_mae": 291.2017,
  "beats_baseline": true,
  "direction_acc_pct": 61.6805,
  "n_meaningful_moves": 3249,
  "range_coverage_pct": 23.3022,
  "range_mean_width_pct": 8.5273,
  "lines": [
   "In 4,712 backtest forecasts for Wheat, 1-7 days ahead, the average miss was about ₹277 per quintal (10%); the baseline “starting price (reference-year price x 1.05, model ratio = 1)” missed by ₹291.",
   "The model beat that baseline here.",
   "It called the direction right in 62% of the 3,249 cases where the price moved by more than 5% (8% of those moves were rises).",
   "The 80% range contained the actual price in 23% of these forecasts (it should be about 80%)."
  ],
  "warnings": [
   "The range was too narrow in past tests: actual prices fell outside it 77% of the time, so treat it as a minimum spread.",
   "These figures come from tests of the same kind of forecast (starting from last year's prices), which is less accurate than forecasting from current prices."
  ]
 },
 "checks": {
  "inr_sum": 18.19,
  "predicted_change_inr": 18.199312,
  "reconstruction_error": 0.0
 },
 "policy": {
  "mode": "model",
  "band": "1-7",
  "reasons": [
   "The model beat its baseline in both backtests and was not rejected in validation."
  ]
 }
}
```

## 3 Brinjal · APMC Mumbai · 10 days

- policy: **model** (15-30 days) · range coverage measured: 75.4% (n=7117), range shown: True
- result page label: Expected market price on 2 Nov 2026
- **result-page headline:** ₹3,392 per quintal
- range line: Range ₹2,266 – ₹5,941 · the real price fell in this range in about 75% of past tests
- selling advice badge: Storage conditions may limit waiting

```json
{
 "schema_version": 3,
 "method": "SHAP values of the model are summed per group in log space; the predicted change in rupees is split in proportion: inr_g = start * s_g * (exp(L) - 1) / L, with L the model's log price ratio, so the group effects and the baseline drift add up exactly to the predicted change. Effects are on the starting price shown.",
 "headline": {
  "code": "about_the_same",
  "text": "About the same: the model's expected change for Brinjal (₹32) is smaller than its typical miss in backtests (about ₹1,053 per quintal at this distance), so no rise or fall is claimed.",
  "predicted_price": 3391.92,
  "start_price": 3360.0,
  "change_inr": 31.92,
  "change_pct": 0.95,
  "typical_miss_inr": 1053.26,
  "range": [
   2265.52,
   5940.53
  ],
  "range_hidden": false,
  "range_coverage_pct": 75.3688,
  "target_date": "2026-11-02",
  "horizon_days": 16,
  "band": "15-30"
 },
 "banner": {
  "text": "No 2026 market data yet — this forecast replays the same season of 2025.",
  "detail": "The starting price is the 17 Oct 2025 price plus 5% for a year's inflation. Every figure below is dated from 2025 records.",
  "reference_date": "2025-10-17"
 },
 "cards": [
  {
   "group": "seasonal",
   "title": "Seasonal pattern",
   "direction": "up",
   "inr_effect": 104.96,
   "inr_effect_rounded": 100,
   "effect_text": "Seasonal pattern pushed the forecast up by about ₹100.",
   "log_contribution": 0.031091,
   "evidence": "Brinjal: in 2024 the price changed +52% between 17 Oct 2024 and 2 Nov 2024; in 2023 the price changed +0% between 17 Oct 2023 and 2 Nov 2023 (average +26%).",
   "evidence_available": true,
   "mechanism": null,
   "agreement": {
    "flag": "agree",
    "text": "In earlier years prices rose over this period, and the model pushed the forecast higher."
   }
  },
  {
   "group": "trend",
   "title": "Recent price trend",
   "direction": "up",
   "inr_effect": 30.5,
   "inr_effect_rounded": 30,
   "effect_text": "Recent price trend pushed the forecast up by about ₹30.",
   "log_contribution": 0.009033,
   "evidence": "Price on 17 Oct 2025: ₹3,200; +7% since 17 Sep 2025 (30 days) and +3% since 19 Jul 2025 (90 days).",
   "evidence_available": true,
   "mechanism": null,
   "agreement": {
    "flag": "agree",
    "text": "The price has been rising recently, and the model pushed the forecast higher."
   }
  },
  {
   "group": "supply",
   "title": "Supply (arrivals)",
   "direction": "down",
   "inr_effect": -4.68,
   "inr_effect_rounded": -5,
   "effect_text": "Supply (arrivals) had almost no effect on the forecast.",
   "log_contribution": -0.001387,
   "evidence": "Reported arrivals at APMC Mumbai, 18 Sep–17 Oct 2025: 72 a day (as reported), 63% above the October average of 2023 and 2024 (44 a day).",
   "evidence_available": true,
   "mechanism": "More supply usually lowers prices.",
   "agreement": {
    "flag": "agree",
    "text": "Arrivals above the usual level normally go with lower prices, and the model pushed the forecast lower."
   }
  },
  {
   "group": "market",
   "title": "Your selected market",
   "direction": "up",
   "inr_effect": 0.12,
   "inr_effect_rounded": 0,
   "effect_text": "Your selected market had almost no effect on the forecast.",
   "log_contribution": 3.7e-05,
   "evidence": "APMC Mumbai's price averaged 2% above the Maharashtra median for Brinjal over 21 Jul–17 Oct 2025 (₹2,558 vs ₹2,514, 72 reporting days).",
   "evidence_available": true,
   "mechanism": null,
   "agreement": {
    "flag": "no_reading",
    "text": "These records are shown for information; by themselves they do not point clearly to higher or lower prices."
   }
  }
 ],
 "other_factors": {
  "inr_total": -98.97,
  "inr_total_rounded": -100,
  "text": "Other factors: −₹100",
  "parts": [
   {
    "label": "Current price level",
    "inr": -182.04,
    "meaning": null
   },
   {
    "label": "This crop's usual behaviour in past data",
    "inr": 52.06,
    "meaning": null
   },
   {
    "label": "How many days ahead",
    "inr": -4.39,
    "meaning": null
   },
   {
    "label": "Recent price swings",
    "inr": -6.51,
    "meaning": null
   },
   {
    "label": "Week number and day of the week",
    "inr": 7.3,
    "meaning": null
   },
   {
    "label": "The model's usual drift over past data (baseline)",
    "inr": 34.61,
    "meaning": null
   }
  ],
  "swing_evidence": "Over the 30 days to 17 Oct 2025 the price typically moved about 10.1% from one reported day to the next.",
  "note": "Price level, the crop's usual pattern in past data, days ahead, recent swings and the model's baseline drift. The model gives no reason for these beyond the patterns it learned, so none is claimed."
 },
 "evidence_not_used_by_model": [
  {
   "group": "last_year",
   "title": "Compared with last year",
   "evidence": "Price on 17 Oct 2025: ₹3,200, 33% higher than on 17 Oct 2024 (₹2,400).",
   "note": "Measured from the records, but the forecast model does not use it, so it did not move this forecast."
  }
 ],
 "market_breakdown": {
  "applicable": true,
  "median_market_price": 3066.82,
  "selected_market_price": 3391.92,
  "premium_inr": 325.1,
  "market": "APMC Mumbai",
  "target_date": "2026-11-02",
  "text": "At the median Maharashtra market: ₹3,067. APMC Mumbai premium: +₹325 (forecasts for 2 Nov 2026).",
  "evidence": "APMC Mumbai traded 2% above the Maharashtra median over 21 Jul–17 Oct 2025."
 },
 "trust": {
  "scenario": "projection",
  "cell": "Brinjal|15-30",
  "available": true,
  "n": 7117,
  "mae": 1053.2589,
  "wape_pct": 33.1728,
  "baseline": "starting price (reference-year price x 1.05, model ratio = 1)",
  "baseline_mae": 1153.9816,
  "beats_baseline": true,
  "direction_acc_pct": 69.0564,
  "n_meaningful_moves": 6263,
  "range_coverage_pct": 75.3688,
  "range_mean_width_pct": 111.072,
  "lines": [
   "In 7,117 backtest forecasts for Brinjal, 15-30 days ahead, the average miss was about ₹1,053 per quintal (33%); the baseline “starting price (reference-year price x 1.05, model ratio = 1)” missed by ₹1,154.",
   "The model beat that baseline here.",
   "It called the direction right in 69% of the 6,263 cases where the price moved by more than 5% (56% of those moves were rises).",
   "The 80% range contained the actual price in 75% of these forecasts (it should be about 80%)."
  ],
  "warnings": [
   "These figures come from tests of the same kind of forecast (starting from last year's prices), which is less accurate than forecasting from current prices."
  ]
 },
 "checks": {
  "inr_sum": 31.93,
  "predicted_change_inr": 31.920792,
  "reconstruction_error": 0.0
 },
 "policy": {
  "mode": "model",
  "band": "15-30",
  "reasons": [
   "The model beat its baseline in both backtests and was not rejected in validation."
  ]
 }
}
```

## 4 Cauliflower · state median · 12 days

- policy: **model** (8-14 days) · range coverage measured: 65.2% (n=3204), range shown: True
- result page label: Expected market price on 4 Nov 2026
- **result-page headline:** ₹1,937 per quintal
- range line: Range ₹1,261 – ₹2,972 · the real price fell in this range in about 65% of past tests
- selling advice badge: Sell on your planned date

```json
{
 "schema_version": 3,
 "method": "SHAP values of the model are summed per group in log space; the predicted change in rupees is split in proportion: inr_g = start * s_g * (exp(L) - 1) / L, with L the model's log price ratio, so the group effects and the baseline drift add up exactly to the predicted change. Effects are on the starting price shown.",
 "headline": {
  "code": "about_the_same",
  "text": "About the same: the model's expected change for Cauliflower (₹6) is smaller than its typical miss in backtests (about ₹715 per quintal at this distance), so no rise or fall is claimed.",
  "predicted_price": 1936.88,
  "start_price": 1942.5,
  "change_inr": -5.62,
  "change_pct": -0.29,
  "typical_miss_inr": 714.99,
  "range": [
   1260.84,
   2972.45
  ],
  "range_hidden": false,
  "range_coverage_pct": 65.231,
  "target_date": "2026-11-04",
  "horizon_days": 12,
  "band": "8-14"
 },
 "banner": {
  "text": "No 2026 market data yet — this forecast replays the same season of 2025.",
  "detail": "The starting price is the 23 Oct 2025 price plus 5% for a year's inflation. Every figure below is dated from 2025 records.",
  "reference_date": "2025-10-23"
 },
 "cards": [
  {
   "group": "seasonal",
   "title": "Seasonal pattern",
   "direction": "up",
   "inr_effect": 32.62,
   "inr_effect_rounded": 35,
   "effect_text": "Seasonal pattern pushed the forecast up by about ₹35.",
   "log_contribution": 0.016817,
   "evidence": "Cauliflower: in 2024 the price changed +4% between 23 Oct 2024 and 4 Nov 2024; in 2023 the price changed -11% between 23 Oct 2023 and 4 Nov 2023 (average -3%).",
   "evidence_available": true,
   "mechanism": null,
   "agreement": {
    "flag": "no_reading",
    "text": "These records are shown for information; by themselves they do not point clearly to higher or lower prices."
   }
  },
  {
   "group": "trend",
   "title": "Recent price trend",
   "direction": "up",
   "inr_effect": 19.77,
   "inr_effect_rounded": 20,
   "effect_text": "Recent price trend pushed the forecast up by about ₹20.",
   "log_contribution": 0.010195,
   "evidence": "Price on 23 Oct 2025: ₹1,850; +7% since 23 Sep 2025 (30 days) and +23% since 25 Jul 2025 (90 days).",
   "evidence_available": true,
   "mechanism": null,
   "agreement": {
    "flag": "agree",
    "text": "The price has been rising recently, and the model pushed the forecast higher."
   }
  },
  {
   "group": "market",
   "title": "Maharashtra median prices",
   "direction": "down",
   "inr_effect": -7.52,
   "inr_effect_rounded": -8,
   "effect_text": "Maharashtra median prices pushed the forecast down by about ₹8.",
   "log_contribution": -0.003878,
   "evidence": "This forecast is for the Maharashtra median, so no single-market comparison applies.",
   "evidence_available": false,
   "mechanism": null,
   "agreement": {
    "flag": "no_evidence",
    "text": "No comparable records, so the evidence cannot be compared with the model's push."
   }
  },
  {
   "group": "supply",
   "title": "Supply (arrivals)",
   "direction": "up",
   "inr_effect": 1.11,
   "inr_effect_rounded": 1,
   "effect_text": "Supply (arrivals) had almost no effect on the forecast.",
   "log_contribution": 0.000574,
   "evidence": "Reported arrivals across the markets that reported, 24 Sep–23 Oct 2025: 3,980 a day (as reported), 66% above the October average of 2023 and 2024 (2,402 a day).",
   "evidence_available": true,
   "mechanism": "More supply usually lowers prices.",
   "agreement": {
    "flag": "disagree",
    "text": "Arrivals above the usual level normally go with lower prices, but the model pushed the forecast higher. The reason is not visible from the records shown."
   }
  }
 ],
 "other_factors": {
  "inr_total": -51.61,
  "inr_total_rounded": -50,
  "text": "Other factors: −₹50",
  "parts": [
   {
    "label": "Current price level",
    "inr": -24.48,
    "meaning": null
   },
   {
    "label": "This crop's usual behaviour in past data",
    "inr": -68.61,
    "meaning": null
   },
   {
    "label": "How many days ahead",
    "inr": 18.43,
    "meaning": null
   },
   {
    "label": "Recent price swings",
    "inr": 7.11,
    "meaning": null
   },
   {
    "label": "Week number and day of the week",
    "inr": 0.77,
    "meaning": null
   },
   {
    "label": "The model's usual drift over past data (baseline)",
    "inr": 15.17,
    "meaning": null
   }
  ],
  "swing_evidence": "Over the 30 days to 23 Oct 2025 the price typically moved about 11.0% from one reported day to the next.",
  "note": "Price level, the crop's usual pattern in past data, days ahead, recent swings and the model's baseline drift. The model gives no reason for these beyond the patterns it learned, so none is claimed."
 },
 "evidence_not_used_by_model": [
  {
   "group": "last_year",
   "title": "Compared with last year",
   "evidence": "Price on 23 Oct 2025: ₹1,850, 24% lower than on 23 Oct 2024 (₹2,420).",
   "note": "Measured from the records, but the forecast model does not use it, so it did not move this forecast."
  }
 ],
 "market_breakdown": {
  "applicable": false,
  "text": "This forecast is for the Maharashtra median, so there is no single-market premium."
 },
 "trust": {
  "scenario": "projection",
  "cell": "Cauliflower|8-14",
  "available": true,
  "n": 3204,
  "mae": 714.9936,
  "wape_pct": 36.9675,
  "baseline": "starting price (reference-year price x 1.05, model ratio = 1)",
  "baseline_mae": 819.9931,
  "beats_baseline": true,
  "direction_acc_pct": 69.0747,
  "n_meaningful_moves": 2810,
  "range_coverage_pct": 65.231,
  "range_mean_width_pct": 83.3097,
  "lines": [
   "In 3,204 backtest forecasts for Cauliflower, 8-14 days ahead, the average miss was about ₹715 per quintal (37%); the baseline “starting price (reference-year price x 1.05, model ratio = 1)” missed by ₹820.",
   "The model beat that baseline here.",
   "It called the direction right in 69% of the 2,810 cases where the price moved by more than 5% (32% of those moves were rises).",
   "The 80% range contained the actual price in 65% of these forecasts (it should be about 80%)."
  ],
  "warnings": [
   "The range was too narrow in past tests: actual prices fell outside it 35% of the time, so treat it as a minimum spread.",
   "These figures come from tests of the same kind of forecast (starting from last year's prices), which is less accurate than forecasting from current prices."
  ]
 },
 "checks": {
  "inr_sum": -5.63,
  "predicted_change_inr": -5.621242,
  "reconstruction_error": 2e-08
 },
 "policy": {
  "mode": "model",
  "band": "8-14",
  "reasons": [
   "The model beat its baseline in both backtests and was not rejected in validation."
  ]
 }
}
```

## 5 Onion · state median · 14 days

- policy: **context_only** (8-14 days) · range coverage measured: 3.5% (n=4820), range shown: False
- result page label: Your selling date 6 Nov 2026
- **result-page headline:** No clear direction — expected to stay near ₹1,600 (latest recorded price, 31 Dec 2025)The model is not used to predict a rise or fall for this crop and distance. In testing, estimates like this missed by about ₹2,155 per quintal.
- range line: None
- selling advice badge: Reliable comparison unavailable

```json
{
 "schema_version": 3,
 "method": "SHAP values of the model are summed per group in log space; the predicted change in rupees is split in proportion: inr_g = start * s_g * (exp(L) - 1) / L, with L the model's log price ratio, so the group effects and the baseline drift add up exactly to the predicted change. Effects are on the starting price shown.",
 "context_only": true,
 "context_reason": "In testing, the model did not reliably beat keeping the latest price for Onion, 8-14 days ahead, so it is not used to predict a rise or fall.",
 "headline": {
  "code": "no_clear_direction",
  "text": "No clear direction for Onion by 6 Nov 2026. In testing, the model did not reliably beat keeping the latest price for Onion, 8-14 days ahead, so it is not used to predict a rise or fall. The records below are context only.",
  "predicted_price": null,
  "start_price": 1050.0,
  "change_inr": null,
  "change_pct": null,
  "typical_miss_inr": 2155.44,
  "range": null,
  "range_hidden": false,
  "range_coverage_pct": null,
  "target_date": "2026-11-06",
  "horizon_days": 14,
  "band": "8-14"
 },
 "banner": {
  "text": "No 2026 market data yet — this forecast replays the same season of 2025.",
  "detail": "The starting price is the 23 Oct 2025 price plus 5% for a year's inflation. Every figure below is dated from 2025 records.",
  "reference_date": "2025-10-23"
 },
 "cards": [
  {
   "group": "supply",
   "title": "Supply (arrivals)",
   "direction": null,
   "inr_effect": null,
   "inr_effect_rounded": null,
   "log_contribution": null,
   "effect_text": "Shown as context. It is not used to claim a rise or fall.",
   "evidence": "Reported arrivals across the markets that reported, 24 Sep–23 Oct 2025: 17,791 a day (as reported), close to the October average of 2023 and 2024 (17,152 a day).",
   "evidence_available": true,
   "mechanism": null,
   "agreement": {
    "flag": "context",
    "text": "No model push is shown for this crop; these records are for information."
   }
  },
  {
   "group": "market",
   "title": "Maharashtra median prices",
   "direction": null,
   "inr_effect": null,
   "inr_effect_rounded": null,
   "log_contribution": null,
   "effect_text": "Shown as context. It is not used to claim a rise or fall.",
   "evidence": "This forecast is for the Maharashtra median, so no single-market comparison applies.",
   "evidence_available": false,
   "mechanism": null,
   "agreement": {
    "flag": "context",
    "text": "No model push is shown for this crop; these records are for information."
   }
  },
  {
   "group": "trend",
   "title": "Recent price trend",
   "direction": null,
   "inr_effect": null,
   "inr_effect_rounded": null,
   "log_contribution": null,
   "effect_text": "Shown as context. It is not used to claim a rise or fall.",
   "evidence": "Price on 23 Oct 2025: ₹1,000; -5% since 23 Sep 2025 (30 days) and -18% since 25 Jul 2025 (90 days).",
   "evidence_available": true,
   "mechanism": null,
   "agreement": {
    "flag": "context",
    "text": "No model push is shown for this crop; these records are for information."
   }
  },
  {
   "group": "last_year",
   "title": "Compared with last year",
   "direction": null,
   "inr_effect": null,
   "inr_effect_rounded": null,
   "log_contribution": null,
   "effect_text": "Shown as context. It is not used to claim a rise or fall.",
   "evidence": "Price on 23 Oct 2025: ₹1,000, 75% lower than on 23 Oct 2024 (₹4,000).",
   "evidence_available": true,
   "mechanism": null,
   "agreement": {
    "flag": "context",
    "text": "No model push is shown for this crop; these records are for information."
   }
  },
  {
   "group": "seasonal",
   "title": "Seasonal pattern",
   "direction": null,
   "inr_effect": null,
   "inr_effect_rounded": null,
   "log_contribution": null,
   "effect_text": "Shown as context. It is not used to claim a rise or fall.",
   "evidence": "Onion: in 2024 the price changed +10% between 23 Oct 2024 and 6 Nov 2024; in 2023 the price changed +12% between 23 Oct 2023 and 6 Nov 2023 (average +11%).",
   "evidence_available": true,
   "mechanism": null,
   "agreement": {
    "flag": "context",
    "text": "No model push is shown for this crop; these records are for information."
   }
  }
 ],
 "other_factors": null,
 "evidence_not_used_by_model": [],
 "market_breakdown": {
  "applicable": false,
  "text": "This forecast is for the Maharashtra median, so there is no single-market premium."
 },
 "trust": {
  "scenario": "projection",
  "cell": "Onion|8-14",
  "available": true,
  "n": 4820,
  "mae": 2155.4396,
  "wape_pct": 170.0626,
  "baseline": "starting price (reference-year price x 1.05, model ratio = 1)",
  "baseline_mae": 2264.0375,
  "beats_baseline": true,
  "direction_acc_pct": 46.4248,
  "n_meaningful_moves": 4797,
  "range_coverage_pct": 3.4647,
  "range_mean_width_pct": 46.3971,
  "lines": [
   "In 4,820 backtest forecasts for Onion, 8-14 days ahead, the average miss was about ₹2,155 per quintal (170%); the baseline “starting price (reference-year price x 1.05, model ratio = 1)” missed by ₹2,264.",
   "The model beat that baseline here.",
   "It called the direction right in 46% of the 4,797 cases where the price moved by more than 5% (0% of those moves were rises).",
   "The 80% range contained the actual price in 3% of these forecasts (it should be about 80%)."
  ],
  "warnings": [
   "The range was too narrow in past tests: actual prices fell outside it 97% of the time, so treat it as a minimum spread.",
   "These figures come from tests of the same kind of forecast (starting from last year's prices), which is less accurate than forecasting from current prices."
  ]
 },
 "checks": {
  "inr_sum": null,
  "predicted_change_inr": null,
  "reconstruction_error": 0.0
 },
 "policy": {
  "mode": "context_only",
  "band": "8-14",
  "reasons": [
   "Real-origin backtest (origins 2025-H2, n=7,389): model -17.2% vs no-change.",
   "Validation fold A (2025-H1), pooled model vs no-change: -6.0% (market-bootstrap 95% CI -11.7 to -0.8)."
  ]
 }
}
```

## 6 Cabbage · state median · 55 days

- policy: **model** (31-60 days) · range coverage measured: 79.3% (n=10952), range shown: True
- result page label: Expected market price on 17 Dec 2026
- **result-page headline:** ₹1,221 per quintal
- range line: Range ₹666 – ₹1,955 · the real price fell in this range in about 79% of past tests
- selling advice badge: Sell on your planned date

```json
{
 "schema_version": 3,
 "method": "SHAP values of the model are summed per group in log space; the predicted change in rupees is split in proportion: inr_g = start * s_g * (exp(L) - 1) / L, with L the model's log price ratio, so the group effects and the baseline drift add up exactly to the predicted change. Effects are on the starting price shown.",
 "headline": {
  "code": "about_the_same",
  "text": "About the same: the model's expected change for Cabbage (₹144) is smaller than its typical miss in backtests (about ₹420 per quintal at this distance), so no rise or fall is claimed.",
  "predicted_price": 1220.65,
  "start_price": 1365.0,
  "change_inr": -144.35,
  "change_pct": -10.58,
  "typical_miss_inr": 419.86,
  "range": [
   666.0,
   1955.04
  ],
  "range_hidden": false,
  "range_coverage_pct": 79.3371,
  "target_date": "2026-12-17",
  "horizon_days": 55,
  "band": "31-60"
 },
 "banner": {
  "text": "No 2026 market data yet — this forecast replays the same season of 2025.",
  "detail": "The starting price is the 23 Oct 2025 price plus 5% for a year's inflation. Every figure below is dated from 2025 records.",
  "reference_date": "2025-10-23"
 },
 "cards": [
  {
   "group": "seasonal",
   "title": "Seasonal pattern",
   "direction": "down",
   "inr_effect": -85.05,
   "inr_effect_rounded": -85,
   "effect_text": "Seasonal pattern pushed the forecast down by about ₹85.",
   "log_contribution": -0.065852,
   "evidence": "Cabbage: in 2024 the price changed -20% between 23 Oct 2024 and 17 Dec 2024; in 2023 the price changed -14% between 23 Oct 2023 and 17 Dec 2023 (average -17%).",
   "evidence_available": true,
   "mechanism": null,
   "agreement": {
    "flag": "agree",
    "text": "In earlier years prices fell over this period, and the model pushed the forecast lower."
   }
  },
  {
   "group": "trend",
   "title": "Recent price trend",
   "direction": "down",
   "inr_effect": -20.59,
   "inr_effect_rounded": -20,
   "effect_text": "Recent price trend pushed the forecast down by about ₹20.",
   "log_contribution": -0.01594,
   "evidence": "Price on 23 Oct 2025: ₹1,300; +30% since 23 Sep 2025 (30 days) and +13% since 25 Jul 2025 (90 days).",
   "evidence_available": true,
   "mechanism": null,
   "agreement": {
    "flag": "disagree",
    "text": "The price has been rising recently, but the model pushed the forecast lower. The reason is not visible from the records shown."
   }
  },
  {
   "group": "market",
   "title": "Maharashtra median prices",
   "direction": "down",
   "inr_effect": -2.6,
   "inr_effect_rounded": -3,
   "effect_text": "Maharashtra median prices had almost no effect on the forecast.",
   "log_contribution": -0.002016,
   "evidence": "This forecast is for the Maharashtra median, so no single-market comparison applies.",
   "evidence_available": false,
   "mechanism": null,
   "agreement": {
    "flag": "no_evidence",
    "text": "No comparable records, so the evidence cannot be compared with the model's push."
   }
  },
  {
   "group": "supply",
   "title": "Supply (arrivals)",
   "direction": "down",
   "inr_effect": -2.32,
   "inr_effect_rounded": -2,
   "effect_text": "Supply (arrivals) had almost no effect on the forecast.",
   "log_contribution": -0.001793,
   "evidence": "Reported arrivals across the markets that reported, 24 Sep–23 Oct 2025: 388 a day (as reported), 19% below the October average of 2023 and 2024 (477 a day).",
   "evidence_available": true,
   "mechanism": "Less supply usually supports prices.",
   "agreement": {
    "flag": "disagree",
    "text": "Arrivals below the usual level normally go with higher prices, but the model pushed the forecast lower. The reason is not visible from the records shown."
   }
  }
 ],
 "other_factors": {
  "inr_total": -33.81,
  "inr_total_rounded": -35,
  "text": "Other factors: −₹35",
  "parts": [
   {
    "label": "Current price level",
    "inr": 58.14,
    "meaning": null
   },
   {
    "label": "This crop's usual behaviour in past data",
    "inr": -103.61,
    "meaning": null
   },
   {
    "label": "How many days ahead",
    "inr": -10.68,
    "meaning": null
   },
   {
    "label": "Week number and day of the week",
    "inr": -1.39,
    "meaning": null
   },
   {
    "label": "The model's usual drift over past data (baseline)",
    "inr": 23.83,
    "meaning": null
   }
  ],
  "swing_evidence": "Over the 30 days to 23 Oct 2025 the price typically moved about 8.5% from one reported day to the next.",
  "note": "Price level, the crop's usual pattern in past data, days ahead, recent swings and the model's baseline drift. The model gives no reason for these beyond the patterns it learned, so none is claimed."
 },
 "evidence_not_used_by_model": [
  {
   "group": "last_year",
   "title": "Compared with last year",
   "evidence": "Price on 23 Oct 2025: ₹1,300, 13% lower than on 23 Oct 2024 (₹1,500).",
   "note": "Measured from the records, but the forecast model does not use it, so it did not move this forecast."
  }
 ],
 "market_breakdown": {
  "applicable": false,
  "text": "This forecast is for the Maharashtra median, so there is no single-market premium."
 },
 "trust": {
  "scenario": "projection",
  "cell": "Cabbage|31-60",
  "available": true,
  "n": 10952,
  "mae": 419.8585,
  "wape_pct": 33.7798,
  "baseline": "starting price (reference-year price x 1.05, model ratio = 1)",
  "baseline_mae": 617.2439,
  "beats_baseline": true,
  "direction_acc_pct": 76.5691,
  "n_meaningful_moves": 9735,
  "range_coverage_pct": 79.3371,
  "range_mean_width_pct": 94.1564,
  "lines": [
   "In 10,952 backtest forecasts for Cabbage, 31-60 days ahead, the average miss was about ₹420 per quintal (34%); the baseline “starting price (reference-year price x 1.05, model ratio = 1)” missed by ₹617.",
   "The model beat that baseline here.",
   "It called the direction right in 77% of the 9,735 cases where the price moved by more than 5% (28% of those moves were rises).",
   "The 80% range contained the actual price in 79% of these forecasts (it should be about 80%)."
  ],
  "warnings": [
   "These figures come from tests of the same kind of forecast (starting from last year's prices), which is less accurate than forecasting from current prices."
  ]
 },
 "checks": {
  "inr_sum": -144.37,
  "predicted_change_inr": -144.353074,
  "reconstruction_error": 0.0
 },
 "policy": {
  "mode": "model",
  "band": "31-60",
  "reasons": [
   "The model beat its baseline in both backtests and was not rejected in validation."
  ]
 }
}
```
