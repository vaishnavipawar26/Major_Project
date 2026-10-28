# Forecast model search v2 (Onion, Potato, Tomato, Wheat; all four horizon bands)

Skill % = 1 - MAE / baseline MAE, shown as real-origin / projection for folds C | A | T. Adoption needs >= 2% in all six numbers.

| crop | band | half | quarter | learned | state_half | ridge_learned |
|---|---|---|---|---|---|---|
| Onion | 1-7 | +1/+2 +1/-2 -1/+1 | +1/+1 +1/-1 +0/+0 | -7/+4 +0/-2 -6/+1 | n/a n/a n/a | -9/+4 +1/-2 -9/+1 |
| Onion | 15-30 | +14/+11 -2/-11 -20/+0 | +12/+6 +2/-5 -6/+0 | -20/+17 -0/-9 -68/-1 | n/a n/a n/a | +6/+18 +2/-11 -61/-2 |
| Onion | 31-60 | +25/+20 +7/-20 -76/-4 | +20/+11 +8/-8 -23/-2 | -14/+31 +9/-16 -247/-12 | n/a n/a n/a | +2/+33 +7/-27 -258/-16 |
| Onion | 8-14 | +9/+6 +1/-6 -4/+2 | +8/+3 +2/-3 -0/+1 | -10/+9 +0/-6 -13/+2 | n/a n/a n/a | -4/+10 +7/-5 -20/+1 |
| Potato | 1-7 | +2/+0 +5/+2 +3/+1 | +2/+0 +3/+1 +2/+0 | +1/+0 +5/+2 +1/+2 | n/a n/a n/a | +1/+0 +3/+2 -1/+2 |
| Potato | 15-30 | +4/+0 +5/-6 +5/+4 | +3/+0 +4/-3 +3/+2 | +5/+0 -1/-15 +6/+7 | n/a n/a n/a | +1/-1 +4/-9 +0/+10 |
| Potato | 31-60 | +5/-0 -1/-13 +4/+5 | +2/-0 +2/-5 +2/+3 | +6/-1 -25/-35 +4/+10 | n/a n/a n/a | +5/-2 -11/-22 -5/+18 |
| Potato | 8-14 | +4/+0 +6/-2 +5/+2 | +2/+0 +4/-1 +3/+1 | +1/+0 +7/-3 +4/+4 | n/a n/a n/a | +2/-0 +7/-2 +1/+5 |
| Tomato | 1-7 | +1/+5 +2/+1 +2/+1 | +1/+2 +2/+1 +2/+1 | -1/+6 +1/+1 +0/+1 | n/a n/a n/a | +4/+8 +2/+3 +1/+3 |
| Tomato | 15-30 | +4/+22 -11/-9 +9/+11 | +4/+13 +1/-2 +8/+8 | +1/+26 +0/+0 +8/+9 | n/a n/a n/a | +22/+25 -8/+6 +3/+6 |
| Tomato | 31-60 | +15/+41 +10/+9 +21/+31 | +10/+28 +10/+12 +14/+21 | +16/+45 +12/+12 +19/+28 | n/a n/a n/a | +36/+55 +18/+34 +8/+19 |
| Tomato | 8-14 | +3/+11 -3/-4 +4/+2 | +3/+6 +1/-1 +4/+2 | +1/+14 -0/-2 +4/+2 | n/a n/a n/a | +11/+14 -1/+1 +2/+3 |
| Wheat | 1-7 | +6/+6 +4/+7 +5/+3 | +4/+3 +3/+4 +3/+2 | +7/+10 +2/+11 +5/+5 | n/a n/a n/a | +5/+10 -1/+11 +1/+4 |
| Wheat | 15-30 | +11/+11 +9/+9 +5/+1 | +6/+6 +6/+6 +4/+1 | +12/+18 +8/+12 +3/-0 | n/a n/a n/a | +7/+17 +6/+12 -2/-0 |
| Wheat | 31-60 | +13/+15 +14/+14 -4/-5 | +8/+8 +8/+8 +0/-2 | +17/+24 +18/+18 -20/-13 | n/a n/a n/a | +13/+24 +17/+17 -21/-11 |
| Wheat | 8-14 | +11/+8 +8/+8 +7/+3 | +6/+4 +5/+4 +5/+2 | +14/+12 +8/+11 +8/+3 | n/a n/a n/a | +10/+13 +6/+11 +4/+3 |

## Adoptable

* Tomato 31-60: half (worst of the six scores +9.2%)
* Tomato 31-60: learned (worst of the six scores +12.0%)
* Tomato 31-60: quarter (worst of the six scores +9.7%)
* Tomato 31-60: ridge_learned (worst of the six scores +7.8%)
* Wheat 1-7: half (worst of the six scores +3.2%)
* Wheat 8-14: half (worst of the six scores +2.8%)
* Wheat 8-14: learned (worst of the six scores +3.2%)
* Wheat 8-14: ridge_learned (worst of the six scores +2.8%)
