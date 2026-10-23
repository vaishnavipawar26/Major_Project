# Phase B Stage A, Task 4: handling projection forecasts (final)

Generated 2026-10-23T08:08:02+00:00. ₹/quintal. A simulated user's price records end at the end of the reference year. P1 = 2023 → 2024 (model-free only); P2 = 2024 → 2025, origins Jan–Jun 2025 only (the 2025-H2 confirmation origins were **not** built). Models for P2 are fitted on pairs with targets before 2025-01-01.

## P1: 2023 → 2024 (model-free)

Cases: 108,322; origin months covered: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].

**All cases**

| method | n | MAE | WAPE_pct | direction_acc_pct | n_meaningful | up_share_of_meaningful_pct |
|---|---|---|---|---|---|---|
| latest_known | 108322 | 879.7 | 39.1 | – | 92225 | 59.1 |
| reference_x1.05 | 108322 | 900.3 | 40.1 | – | 93836 | 77.1 |
| reference_x1.00 | 108322 | 923.6 | 41.1 | – | 98552 | 80.3 |


**Versus the latest known price (95 % CI, origin-week bootstrap):**

* reference_x1.05 is not distinguishable from **latest known price** (skill -2.3 %, 95 % CI -12.0 … +6.4)
* reference_x1.00 is not distinguishable from **latest known price** (skill -5.0 %, 95 % CI -13.9 … +3.7)

**By horizon band (MAE)**

| band | n | latest_known | reference_x1.05 | reference_x1.00 |
|---|---|---|---|---|
| 1-7 | 12596 | 851.0 | 786.5 | 812.9 |
| 8-14 | 12688 | 868.4 | 822.6 | 848.8 |
| 15-30 | 29053 | 879.6 | 870.3 | 894.8 |
| 31-60 | 53985 | 889.1 | 961.3 | 982.4 |

**By crop (MAE) and the best of the three no-model anchors**

| crop | n | latest_known | reference_x1.05 | reference_x1.00 | best anchor |
|---|---|---|---|---|---|
| Brinjal | 15055 | 1,842.3 | 985.5 | 981.5 | reference_x1.00 |
| Cabbage | 14149 | 474.4 | 608.9 | 628.0 | latest_known |
| Cauliflower | 14128 | 771.3 | 786.7 | 800.9 | latest_known |
| Onion | 17817 | 1,179.4 | 1,295.6 | 1,338.1 | latest_known |
| Potato | 8822 | 956.9 | 916.7 | 976.7 | reference_x1.05 |
| Tomato | 15427 | 1,014.6 | 1,726.2 | 1,682.3 | latest_known |
| Wheat | 22924 | 211.1 | 224.9 | 290.3 | latest_known |

**Exact horizons (MAE)**

| h | n | latest_known | reference_x1.05 | reference_x1.00 |
|---|---|---|---|---|
| 1 | 1795 | 828.0 | 770.2 | 799.0 |
| 7 | 1782 | 816.5 | 790.4 | 812.8 |
| 14 | 1829 | 880.0 | 845.8 | 873.4 |
| 30 | 1840 | 915.0 | 889.5 | 913.0 |
| 60 | 1842 | 890.1 | 977.0 | 1,000.0 |


## P2: 2024 → 2025-H1

Cases: 96,817; origin months covered: [1, 2, 3, 4, 5, 6].

**All cases**

| method | n | MAE | WAPE_pct | direction_acc_pct | n_meaningful | up_share_of_meaningful_pct |
|---|---|---|---|---|---|---|
| latest_known | 96817 | 575.6 | 35.0 | – | 84129 | 39.3 |
| reference_x1.05 | 96817 | 549.1 | 33.4 | – | 79921 | 35.8 |
| reference_x1.00 | 96817 | 526.1 | 32.0 | – | 82347 | 42.5 |
| trailing_yoy | 96817 | 804.5 | 48.9 | – | 86525 | 21.2 |
| v1_model_on_ref_x1.05 | 96817 | 505.2 | 30.7 | 61.4 | 79921 | 35.8 |
| v2_model_on_ref_x1.05 | 96817 | 499.7 | 30.4 | 62.0 | 79921 | 35.8 |


**Versus the latest known price (95 % CI, origin-week bootstrap):**

* reference_x1.05 is not distinguishable from **latest known price** (skill +4.6 %, 95 % CI -14.9 … +19.1)
* reference_x1.00 is not distinguishable from **latest known price** (skill +8.6 %, 95 % CI -10.3 … +22.7)
* trailing_yoy is WORSE than **latest known price** (skill -39.8 %, 95 % CI -64.6 … -21.0)
* v1_model_on_ref_x1.05 beats **latest known price** (skill +12.2 %, 95 % CI +2.0 … +20.6)
* v2_model_on_ref_x1.05 beats **latest known price** (skill +13.2 %, 95 % CI +2.3 … +21.5)
* v1 model beats **its own anchor (reference × 1.05)** (skill +8.0 %, 95 % CI +0.1 … +14.2)
* v2 model beats **its own anchor (reference × 1.05)** (skill +9.0 %, 95 % CI +0.1 … +16.2)

**By horizon band (MAE)**

| band | n | latest_known | reference_x1.05 | reference_x1.00 | trailing_yoy | v1_model_on_ref_x1.05 | v2_model_on_ref_x1.05 |
|---|---|---|---|---|---|---|---|
| 1-7 | 13664 | 568.7 | 571.3 | 544.2 | 848.0 | 546.9 | 545.7 |
| 8-14 | 13145 | 576.8 | 550.3 | 526.3 | 822.4 | 521.7 | 517.5 |
| 15-30 | 27681 | 569.5 | 544.2 | 521.0 | 801.8 | 513.8 | 509.0 |
| 31-60 | 42327 | 581.4 | 544.8 | 523.5 | 786.7 | 480.9 | 473.4 |

**By crop (MAE) and the best of the three no-model anchors**

| crop | n | latest_known | reference_x1.05 | reference_x1.00 | trailing_yoy | v1_model_on_ref_x1.05 | v2_model_on_ref_x1.05 | best anchor |
|---|---|---|---|---|---|---|---|---|
| Brinjal | 13068 | 929.1 | 954.5 | 924.7 | 1,024.1 | 654.6 | 646.1 | reference_x1.00 |
| Cabbage | 12525 | 322.9 | 532.4 | 490.1 | 1,072.6 | 555.7 | 553.5 | latest_known |
| Cauliflower | 12809 | 753.7 | 785.6 | 756.4 | 1,037.4 | 652.2 | 628.4 | latest_known |
| Onion | 15708 | 1,052.0 | 457.2 | 445.0 | 810.7 | 545.5 | 550.5 | reference_x1.00 |
| Potato | 10081 | 337.6 | 345.9 | 317.5 | 1,006.3 | 371.6 | 376.1 | reference_x1.00 |
| Tomato | 13828 | 358.2 | 677.4 | 634.8 | 741.4 | 665.2 | 648.6 | latest_known |
| Wheat | 18798 | 266.4 | 208.8 | 215.6 | 247.7 | 187.5 | 188.9 | reference_x1.05 |

**Exact horizons (MAE)**

| h | n | latest_known | reference_x1.05 | reference_x1.00 | trailing_yoy | v1_model_on_ref_x1.05 | v2_model_on_ref_x1.05 |
|---|---|---|---|---|---|---|---|
| 1 | 2047 | 557.8 | 585.3 | 557.0 | 862.9 | 573.6 | 574.7 |
| 7 | 1947 | 565.4 | 574.7 | 552.6 | 844.2 | 540.1 | 537.3 |
| 14 | 1863 | 590.2 | 547.8 | 525.7 | 826.0 | 528.3 | 525.7 |
| 30 | 1622 | 571.1 | 549.5 | 530.3 | 787.7 | 483.8 | 479.1 |
| 60 | 1237 | 618.3 | 558.4 | 535.3 | 793.5 | 470.3 | 462.6 |


## Is the best anchor stable across the two year pairs?

| crop | best in P1 | best in P2 | same |
|---|---|---|---|
| Brinjal | reference_x1.00 | reference_x1.00 | True |
| Cabbage | latest_known | latest_known | True |
| Cauliflower | latest_known | latest_known | True |
| Onion | latest_known | reference_x1.00 | False |
| Potato | reference_x1.05 | reference_x1.00 | False |
| Tomato | latest_known | latest_known | True |
| Wheat | latest_known | reference_x1.05 | False |


## Production historical projection (P2 subset, scored separately)

Cases: 20,000.

| method | n | MAE | WAPE_pct |
|---|---|---|---|
| historical_projection | 20000 | 687.1 | 41.7 |
| latest_known | 20000 | 575.1 | 34.9 |
| reference_x1.05 | 20000 | 551.0 | 33.5 |
| v1_model_on_ref_x1.05 | 20000 | 505.7 | 30.7 |
| v2_model_on_ref_x1.05 | 20000 | 501.0 | 30.4 |

* historical projection is WORSE than **latest known price** (skill -19.5 %, 95 % CI -42.8 … -1.5)
* historical projection is WORSE than **reference × 1.05** (skill -24.7 %, 95 % CI -29.2 … -20.3)
* Its own displayed range covered 57 % (mean width 104 % of the forecast; 30 % fell below it).

## Ranges: calibrated on one year pair, checked on the other (80 % nominal)

**Anchor: latest_known**

| scope | coverage_pct | below_pct | above_pct | mean_width_pct_of_start | n |
|---|---|---|---|---|---|
| calibrate on P1 -> check on P2 (all) | 47.0 | 35.3 | 17.6 | 126.2 | 96817 |
| calibrate on P2 -> check on P1 (all) | 44.3 | 19.7 | 35.9 | 116.8 | 108322 |
| calibrate on P1 -> check on P2, 1-7 days | 49.9 | 33.1 | 17.0 | 125.5 | 13664 |
| calibrate on P1 -> check on P2, 8-14 days | 48.4 | 34.1 | 17.5 | 123.8 | 13145 |
| calibrate on P1 -> check on P2, 15-30 days | 48.1 | 35.0 | 16.9 | 127.6 | 27681 |
| calibrate on P1 -> check on P2, 31-60 days | 45.0 | 36.6 | 18.3 | 126.2 | 42327 |
| calibrate on P2 -> check on P1, 1-7 days | 47.7 | 18.6 | 33.6 | 115.5 | 12596 |
| calibrate on P2 -> check on P1, 8-14 days | 46.5 | 19.9 | 33.6 | 115.2 | 12688 |
| calibrate on P2 -> check on P1, 15-30 days | 45.6 | 19.2 | 35.2 | 117.4 | 29053 |
| calibrate on P2 -> check on P1, 31-60 days | 42.4 | 20.2 | 37.4 | 117.2 | 53985 |


**Anchor: reference_x1.05**

| scope | coverage_pct | below_pct | above_pct | mean_width_pct_of_start | n |
|---|---|---|---|---|---|
| calibrate on P1 -> check on P2 (all) | 58.6 | 38.8 | 2.6 | 178.6 | 96817 |
| calibrate on P2 -> check on P1 (all) | 52.3 | 4.5 | 43.2 | 94.3 | 108322 |
| calibrate on P1 -> check on P2, 1-7 days | 54.1 | 43.8 | 2.1 | 156.5 | 13664 |
| calibrate on P1 -> check on P2, 8-14 days | 55.3 | 42.1 | 2.6 | 161.3 | 13145 |
| calibrate on P1 -> check on P2, 15-30 days | 57.5 | 39.8 | 2.7 | 174.0 | 27681 |
| calibrate on P1 -> check on P2, 31-60 days | 61.8 | 35.6 | 2.6 | 194.0 | 42327 |
| calibrate on P2 -> check on P1, 1-7 days | 52.2 | 3.2 | 44.6 | 83.8 | 12596 |
| calibrate on P2 -> check on P1, 8-14 days | 53.1 | 4.2 | 42.6 | 88.7 | 12688 |
| calibrate on P2 -> check on P1, 15-30 days | 54.3 | 4.4 | 41.3 | 96.0 | 29053 |
| calibrate on P2 -> check on P1, 31-60 days | 51.1 | 4.9 | 44.0 | 97.1 | 53985 |


## Pre-registered policy applied to these numbers

| Rule | Result |
|---|---|
| reference_x1.05 replaces latest known price (CI low > 0 in both pairs) | **not adopted** (P1 -2.3 %, CI -12.0…+6.4; P2 +4.6 %, CI -14.9…+19.1) |
| reference_x1.00 replaces latest known price (CI low > 0 in both pairs) | **not adopted** (P1 -5.0 %, CI -13.9…+3.7; P2 +8.6 %, CI -10.3…+22.7) |
| v1 model adjustment (beats own anchor and latest known, CI low > 0) | **adopted** (vs anchor +8.0 %, CI +0.1…+14.2; vs latest known +12.2 %, CI +2.0…+20.6) |
| v2 model adjustment (beats own anchor and latest known, CI low > 0) | **adopted** (vs anchor +9.0 %, CI +0.1…+16.2; vs latest known +13.2 %, CI +2.3…+21.5) |
| a range around the latest_known anchor is shown (≥ 75 % coverage in both directions) | **no** |
| a range around the reference_x1.05 anchor is shown (≥ 75 % coverage in both directions) | **no** |

**Recommendation (not applied to production):** See the numbers: at least one pre-registered condition was met; the applicable part of the policy may be used.

Frozen in `phaseB_projection_decision.json` (sha256 `fde01ded5c38c31af83dbd55ac4a4d4750d65243d65ca9ccff2b986cf069bc62`).

## Limitations

* Only two year pairs exist, and the model comparison exists for one of them (P2). A different pair of years could rank the methods differently.
* P2 covers origins January–June 2025 AND only targets before 1 July 2025, so no confirmation-period price is touched; this drops long horizons for May–June origins.
* In P1 the simulated user's records end 31 Dec 2023 and the 2023 history is short (first 30 days cannot be origins).
* Trailing-12-month growth needs two full years, so it exists only for P2.
* The historical projection is scored on a random subset of P2 because its range needs a per-case weekly resample.
* Nothing here changes production; the recommendation is for how a future version could present the result.