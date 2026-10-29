# Stale-records walk-forward evaluation (Onion, Potato, Tomato)

Generated 2026-10-29T00:31:11+00:00 by `scripts/evaluate_stale_forecasts.py`. Records end 302 days before each forecast start; every model is trained only on targets before the fold's earliest end of records. MAE / WAPE in Rs per quintal; lower is better.

## Onion

| band | candidate | MAE C | MAE A | MAE T | mean MAE | WAPE % C / A / T |
|---|---|---|---|---|---|---|
| 1-14 | crop_xgb | 1,171 | 563 | 2,082 | 1,272 | 37 / 37 / 164 |
| 1-14 | crop_xgb_half | 1,202 | 573 | 2,085 | 1,287 | 38 / 38 / 164 |
| 1-14 | crop_rf | 1,140 | 636 | 2,110 | 1,295 | 36 / 42 / 166 |
| 1-14 | crop_rf_rate | 1,172 | 640 | 2,134 | 1,315 | 37 / 42 / 168 |
| 1-14 | flat_last_year | 1,241 | 595 | 2,117 | 1,318 | 39 / 39 / 166 |
| 1-14 | seasonal_last_year | 1,169 | 675 | 2,114 | 1,319 | 37 / 45 / 166 |
| 1-14 | crop_xgb_rate_half | 1,223 | 615 | 2,125 | 1,321 | 39 / 41 / 167 |
| 1-14 | crop_xgb_rate | 1,212 | 637 | 2,140 | 1,330 | 38 / 42 / 168 |
| 1-14 | pooled_prod | 1,518 | 612 | 1,957 | 1,362 | 48 / 40 / 154 |
| 1-14 | flat_latest | 1,040 | 1,090 | 2,039 | 1,390 | 33 / 72 / 160 |
| 1-14 | latest_x_season | 1,022 | 1,236 | 2,130 | 1,463 | 32 / 82 / 168 |
| 15-30 | pooled_prod | 1,345 | 641 | 1,744 | 1,243 | 42 / 43 / 140 |
| 15-30 | crop_xgb_half | 1,288 | 589 | 2,196 | 1,358 | 41 / 40 / 176 |
| 15-30 | crop_xgb | 1,198 | 611 | 2,303 | 1,371 | 38 / 41 / 184 |
| 15-30 | flat_last_year | 1,375 | 583 | 2,157 | 1,372 | 43 / 39 / 173 |
| 15-30 | crop_xgb_rate_half | 1,329 | 635 | 2,222 | 1,395 | 42 / 43 / 178 |
| 15-30 | seasonal_last_year | 1,156 | 785 | 2,257 | 1,399 | 36 / 53 / 181 |
| 15-30 | flat_latest | 1,084 | 1,067 | 2,100 | 1,417 | 34 / 72 / 168 |
| 15-30 | crop_rf_rate | 1,195 | 726 | 2,341 | 1,421 | 38 / 49 / 187 |
| 15-30 | crop_rf | 1,191 | 692 | 2,397 | 1,427 | 37 / 47 / 192 |
| 15-30 | crop_xgb_rate | 1,319 | 704 | 2,340 | 1,455 | 42 / 47 / 187 |
| 15-30 | latest_x_season | 1,149 | 1,438 | 2,418 | 1,668 | 36 / 97 / 194 |
| 31-60 | pooled_prod | 1,485 | 634 | 1,700 | 1,273 | 46 / 47 / 137 |
| 31-60 | flat_last_year | 1,641 | 535 | 2,109 | 1,428 | 51 / 40 / 170 |
| 31-60 | flat_latest | 1,172 | 1,002 | 2,251 | 1,475 | 36 / 74 / 181 |
| 31-60 | crop_xgb_half | 1,466 | 612 | 2,404 | 1,494 | 45 / 45 / 193 |
| 31-60 | seasonal_last_year | 1,133 | 886 | 2,485 | 1,501 | 35 / 66 / 200 |
| 31-60 | crop_xgb_rate_half | 1,518 | 649 | 2,428 | 1,532 | 47 / 48 / 195 |
| 31-60 | crop_xgb | 1,272 | 734 | 2,818 | 1,608 | 39 / 54 / 227 |
| 31-60 | crop_rf | 1,335 | 815 | 2,854 | 1,668 | 41 / 60 / 230 |
| 31-60 | crop_rf_rate | 1,288 | 869 | 2,965 | 1,707 | 40 / 64 / 238 |
| 31-60 | crop_xgb_rate | 1,506 | 833 | 2,891 | 1,744 | 46 / 62 / 232 |
| 31-60 | latest_x_season | 1,460 | 1,706 | 2,967 | 2,044 | 45 / 126 / 239 |

## Potato

| band | candidate | MAE C | MAE A | MAE T | mean MAE | WAPE % C / A / T |
|---|---|---|---|---|---|---|
| 1-14 | crop_rf | 1,070 | 378 | 1,143 | 864 | 43 / 24 / 75 |
| 1-14 | flat_latest | 1,106 | 712 | 780 | 866 | 45 / 45 / 52 |
| 1-14 | crop_xgb | 1,085 | 375 | 1,145 | 868 | 44 / 24 / 76 |
| 1-14 | crop_xgb_half | 1,054 | 401 | 1,154 | 870 | 43 / 25 / 76 |
| 1-14 | flat_last_year | 1,022 | 439 | 1,166 | 876 | 41 / 28 / 77 |
| 1-14 | crop_rf_rate | 1,051 | 420 | 1,162 | 878 | 43 / 27 / 77 |
| 1-14 | crop_xgb_rate_half | 1,050 | 419 | 1,167 | 879 | 43 / 26 / 77 |
| 1-14 | crop_xgb_rate | 1,077 | 402 | 1,169 | 883 | 44 / 25 / 77 |
| 1-14 | seasonal_last_year | 1,024 | 494 | 1,145 | 888 | 41 / 31 / 76 |
| 1-14 | latest_x_season | 1,106 | 809 | 803 | 906 | 45 / 51 / 53 |
| 1-14 | pooled_prod | 1,239 | 415 | 1,117 | 924 | 50 / 26 / 74 |
| 15-30 | flat_latest | 1,023 | 697 | 820 | 847 | 43 / 44 / 54 |
| 15-30 | crop_rf | 1,007 | 381 | 1,156 | 848 | 42 / 24 / 76 |
| 15-30 | pooled_prod | 977 | 415 | 1,156 | 849 | 41 / 26 / 76 |
| 15-30 | crop_xgb_half | 989 | 402 | 1,177 | 856 | 41 / 26 / 77 |
| 15-30 | flat_last_year | 946 | 439 | 1,189 | 858 | 40 / 28 / 78 |
| 15-30 | crop_xgb | 1,030 | 381 | 1,169 | 860 | 43 / 24 / 76 |
| 15-30 | crop_rf_rate | 1,035 | 394 | 1,164 | 864 | 43 / 25 / 76 |
| 15-30 | crop_xgb_rate_half | 1,038 | 402 | 1,186 | 875 | 44 / 26 / 78 |
| 15-30 | seasonal_last_year | 944 | 568 | 1,124 | 879 | 40 / 36 / 74 |
| 15-30 | crop_xgb_rate | 1,119 | 379 | 1,186 | 895 | 47 / 24 / 78 |
| 15-30 | latest_x_season | 1,023 | 938 | 830 | 931 | 43 / 60 / 54 |
| 31-60 | pooled_prod | 852 | 446 | 1,179 | 826 | 37 / 29 / 77 |
| 31-60 | crop_rf | 928 | 395 | 1,159 | 828 | 41 / 25 / 76 |
| 31-60 | flat_last_year | 858 | 440 | 1,196 | 831 | 38 / 28 / 79 |
| 31-60 | flat_latest | 932 | 682 | 886 | 833 | 41 / 44 / 58 |
| 31-60 | crop_xgb_half | 913 | 414 | 1,189 | 839 | 40 / 26 / 78 |
| 31-60 | crop_xgb | 968 | 404 | 1,184 | 852 | 42 / 26 / 78 |
| 31-60 | crop_rf_rate | 1,061 | 384 | 1,144 | 863 | 46 / 25 / 75 |
| 31-60 | seasonal_last_year | 866 | 679 | 1,109 | 885 | 38 / 43 / 73 |
| 31-60 | crop_xgb_rate_half | 1,071 | 394 | 1,196 | 887 | 47 / 25 / 79 |
| 31-60 | crop_xgb_rate | 1,239 | 376 | 1,199 | 938 | 54 / 24 / 79 |
| 31-60 | latest_x_season | 944 | 1,138 | 885 | 989 | 41 / 73 / 58 |

## Tomato

| band | candidate | MAE C | MAE A | MAE T | mean MAE | WAPE % C / A / T |
|---|---|---|---|---|---|---|
| 1-14 | flat_latest | 1,264 | 1,048 | 1,153 | 1,155 | 50 / 92 / 54 |
| 1-14 | crop_xgb | 1,896 | 901 | 893 | 1,230 | 75 / 79 / 42 |
| 1-14 | crop_xgb_half | 1,973 | 796 | 971 | 1,246 | 78 / 70 / 46 |
| 1-14 | pooled_prod | 1,965 | 799 | 1,088 | 1,284 | 78 / 70 / 51 |
| 1-14 | crop_xgb_rate | 2,051 | 861 | 1,091 | 1,334 | 81 / 76 / 51 |
| 1-14 | crop_xgb_rate_half | 2,066 | 794 | 1,149 | 1,336 | 82 / 70 / 54 |
| 1-14 | crop_rf | 2,114 | 958 | 948 | 1,340 | 84 / 84 / 45 |
| 1-14 | latest_x_season | 1,370 | 1,333 | 1,338 | 1,347 | 54 / 117 / 63 |
| 1-14 | seasonal_last_year | 1,939 | 796 | 1,328 | 1,354 | 77 / 70 / 63 |
| 1-14 | crop_rf_rate | 2,088 | 888 | 1,134 | 1,370 | 83 / 78 / 53 |
| 1-14 | flat_last_year | 2,130 | 750 | 1,234 | 1,371 | 84 / 66 / 58 |
| 1-14 | band_46_60_half | 2,558 | 1,059 | 901 | 1,506 | 101 / 93 / 42 |
| 15-30 | flat_latest | 1,100 | 963 | 1,299 | 1,120 | 49 / 79 / 60 |
| 15-30 | pooled_prod | 1,718 | 1,130 | 800 | 1,216 | 77 / 92 / 37 |
| 15-30 | crop_xgb_half | 1,914 | 970 | 861 | 1,248 | 85 / 79 / 40 |
| 15-30 | crop_xgb_rate_half | 2,027 | 980 | 877 | 1,295 | 90 / 80 / 41 |
| 15-30 | crop_xgb | 1,707 | 1,364 | 850 | 1,307 | 76 / 111 / 40 |
| 15-30 | seasonal_last_year | 1,776 | 1,012 | 1,233 | 1,340 | 79 / 83 / 57 |
| 15-30 | band_46_60_half | 2,146 | 1,195 | 800 | 1,381 | 96 / 98 / 37 |
| 15-30 | crop_xgb_rate | 1,986 | 1,391 | 826 | 1,401 | 89 / 114 / 38 |
| 15-30 | crop_rf | 1,913 | 1,469 | 831 | 1,404 | 85 / 120 / 39 |
| 15-30 | flat_last_year | 2,369 | 776 | 1,126 | 1,424 | 106 / 63 / 52 |
| 15-30 | crop_rf_rate | 2,055 | 1,512 | 865 | 1,477 | 92 / 124 / 40 |
| 15-30 | latest_x_season | 1,421 | 1,943 | 1,839 | 1,734 | 63 / 159 / 86 |
| 31-60 | crop_xgb_half | 1,390 | 908 | 713 | 1,003 | 69 / 63 / 34 |
| 31-60 | pooled_prod | 1,088 | 1,288 | 689 | 1,022 | 54 / 89 / 33 |
| 31-60 | band_46_60_half | 1,436 | 995 | 658 | 1,030 | 71 / 69 / 32 |
| 31-60 | crop_xgb_rate_half | 1,541 | 930 | 672 | 1,048 | 76 / 64 / 32 |
| 31-60 | flat_latest | 1,131 | 995 | 1,304 | 1,143 | 56 / 69 / 63 |
| 31-60 | seasonal_last_year | 1,294 | 1,010 | 1,207 | 1,170 | 64 / 70 / 58 |
| 31-60 | crop_xgb | 1,050 | 1,742 | 801 | 1,197 | 52 / 120 / 39 |
| 31-60 | crop_rf | 1,295 | 1,883 | 758 | 1,312 | 64 / 130 / 37 |
| 31-60 | flat_last_year | 2,280 | 750 | 1,136 | 1,389 | 112 / 52 / 55 |
| 31-60 | crop_xgb_rate | 1,542 | 1,942 | 806 | 1,430 | 76 / 134 / 39 |
| 31-60 | crop_rf_rate | 1,649 | 2,225 | 845 | 1,573 | 81 / 153 / 41 |
| 31-60 | latest_x_season | 1,907 | 3,273 | 2,364 | 2,515 | 94 / 226 / 114 |
| 46-60 | crop_xgb_half | 1,228 | 862 | 652 | 914 | 62 / 56 / 32 |
| 46-60 | band_46_60_half | 1,274 | 926 | 610 | 936 | 64 / 61 / 30 |
| 46-60 | pooled_prod | 945 | 1,316 | 660 | 974 | 47 / 86 / 33 |
| 46-60 | flat_last_year | 2,177 | 780 | 1,131 | 1,363 | 109 / 51 / 56 |

## Starting price against the price reported on the start day

| crop | start | MAE C / A / T | WAPE % C / A / T |
|---|---|---|---|
| Onion | last_year | 1,246 / 601 / 1,968 | 40 / 40 / 158 |
| Onion | last_year_x1.05 | 1,185 / 624 / 2,128 | 38 / 41 / 171 |
| Onion | latest_report | 1,014 / 1,142 / 2,192 | 33 / 75 / 176 |
| Potato | last_year | 1,128 / 421 / 1,035 | 45 / 26 / 67 |
| Potato | last_year_x1.05 | 1,060 / 463 / 1,163 | 42 / 29 / 75 |
| Potato | latest_report | 1,138 / 711 / 836 | 45 / 45 / 54 |
| Tomato | last_year | 1,940 / 693 / 1,342 | 74 / 63 / 67 |
| Tomato | last_year_x1.05 | 2,016 / 757 / 1,415 | 77 / 68 / 70 |
| Tomato | latest_report | 1,335 / 1,069 / 889 | 51 / 97 / 44 |

## One method for all 60 days (the app's current method is pooled_prod)

Replace the current method only with a candidate at least +2% better on the mean fold MAE and better in two of three folds.

### Onion

| candidate | MAE C | MAE A | MAE T | mean fold MAE | WAPE % (all folds) |
|---|---|---|---|---|---|
| pooled_prod | 1,456 | 630 | 1,783 | 1,290 | 66 |
| flat_last_year | 1,472 | 562 | 2,125 | 1,386 | 71 |
| crop_xgb_half | 1,354 | 596 | 2,258 | 1,403 | 72 |
| seasonal_last_year | 1,148 | 808 | 2,319 | 1,425 | 73 |
| flat_latest | 1,116 | 1,040 | 2,150 | 1,435 | 73 |
| crop_xgb_rate_half | 1,395 | 637 | 2,287 | 1,440 | 74 |
| crop_xgb | 1,227 | 660 | 2,471 | 1,453 | 74 |
| crop_rf | 1,249 | 739 | 2,521 | 1,503 | 77 |
| crop_rf_rate | 1,234 | 776 | 2,561 | 1,524 | 78 |
| crop_xgb_rate | 1,384 | 752 | 2,529 | 1,555 | 79 |
| latest_x_season | 1,269 | 1,522 | 2,582 | 1,791 | 91 |

Decision: keep the current method (lowest mean MAE: pooled_prod, +0.0% vs current).

### Potato

| candidate | MAE C | MAE A | MAE T | mean fold MAE | WAPE % (all folds) |
|---|---|---|---|---|---|
| crop_rf | 982 | 387 | 1,154 | 841 | 45 |
| flat_latest | 996 | 693 | 839 | 843 | 46 |
| flat_last_year | 919 | 440 | 1,186 | 848 | 46 |
| crop_xgb_half | 966 | 408 | 1,176 | 850 | 46 |
| pooled_prod | 975 | 430 | 1,156 | 853 | 46 |
| crop_xgb | 1,012 | 391 | 1,169 | 857 | 46 |
| crop_rf_rate | 1,052 | 395 | 1,154 | 867 | 47 |
| crop_xgb_rate_half | 1,058 | 402 | 1,185 | 882 | 48 |
| seasonal_last_year | 923 | 603 | 1,123 | 883 | 48 |
| crop_xgb_rate | 1,170 | 383 | 1,187 | 913 | 49 |
| latest_x_season | 1,003 | 1,003 | 848 | 951 | 52 |

Decision: keep the current method (lowest mean MAE: crop_rf, +1.5% vs current).

### Tomato

| candidate | MAE C | MAE A | MAE T | mean fold MAE | WAPE % (all folds) |
|---|---|---|---|---|---|
| crop_xgb_half | 1,666 | 897 | 824 | 1,129 | 61 |
| flat_latest | 1,153 | 999 | 1,262 | 1,138 | 61 |
| pooled_prod | 1,461 | 1,130 | 828 | 1,140 | 61 |
| crop_xgb_rate_half | 1,794 | 911 | 859 | 1,188 | 64 |
| crop_xgb | 1,423 | 1,442 | 840 | 1,235 | 66 |
| band_46_60_half | 1,888 | 1,063 | 764 | 1,238 | 66 |
| seasonal_last_year | 1,573 | 959 | 1,247 | 1,260 | 67 |
| crop_rf | 1,652 | 1,554 | 830 | 1,345 | 72 |
| flat_last_year | 2,269 | 757 | 1,160 | 1,395 | 75 |
| crop_xgb_rate | 1,780 | 1,540 | 889 | 1,403 | 75 |
| crop_rf_rate | 1,860 | 1,720 | 929 | 1,503 | 81 |
| latest_x_season | 1,651 | 2,462 | 1,939 | 2,017 | 108 |

Decision: keep the current method (lowest mean MAE: crop_xgb_half, +0.9% vs current).

