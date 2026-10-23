# Result-page and explanation headlines, side by side (six real predictions)

Rendered by the real `PriceResult`, `PriceExplanation` and `History` components from the live API responses (in-process, temporary SQLite; today = 2026-10-23, after the +2% policy margin). Where the two headlines are identical the check column says so.

| # | Crop · market · days asked | Policy | Result-page headline | Explanation headline | Same? |
|---|---|---|---|---|---|
| 1 | Tomato · APMC Mumbai · 12 | context-only (15-30) | Latest recorded price: ₹4,250 (31 Dec 2025, 10 months ago). No forecast for this crop. | Latest recorded price: ₹4,250 (31 Dec 2025, 10 months ago). No forecast for this crop. | yes |
| 2 | Wheat · state median · 7 | context-only (1-7) | Latest recorded price: ₹2,600 (31 Dec 2025, 10 months ago). No forecast for this crop. | Latest recorded price: ₹2,600 (31 Dec 2025, 10 months ago). No forecast for this crop. | yes |
| 3 | Brinjal · APMC Mumbai · 10 | model (15-30) | About the same as the starting price (₹3,360) | About the same as the starting price (₹3,360) | yes |
| 4 | Cauliflower · state median · 12 | model (8-14) | About the same as the starting price (₹1,943) | About the same as the starting price (₹1,943) | yes |
| 5 | Onion · state median · 14 | context-only (8-14) | Latest recorded price: ₹1,600 (31 Dec 2025, 10 months ago). No forecast for this crop. | Latest recorded price: ₹1,600 (31 Dec 2025, 10 months ago). No forecast for this crop. | yes |
| 6 | Cabbage · state median · 55 | model (31-60) | About the same as the starting price (₹1,365) | About the same as the starting price (₹1,365) | yes |

## Days ahead and history

| # | Result page | Explanation | History row |
|---|---|---|---|
| 1 | 12 days from today · counts from this market's last report (17 Oct 2025), so the estimate covers 18 days | 12 days from today · counts from this market's last report (17 Oct 2025), so the estimate covers 18 days | No clear directionLatest recorded price: ₹4,250 (31 Dec 2025, 10 months ago). No forecast for this crop.for 4 Nov 2026 |
| 2 | 7 days from today | 7 days from today | No clear directionLatest recorded price: ₹2,600 (31 Dec 2025, 10 months ago). No forecast for this crop.for 30 Oct 2026 |
| 3 | 10 days from today · counts from this market's last report (17 Oct 2025), so the estimate covers 16 days | 10 days from today · counts from this market's last report (17 Oct 2025), so the estimate covers 16 days | About the same as the starting price (₹3,360)model estimate ₹3,392for 2 Nov 2026 |
| 4 | 12 days from today | 12 days from today | About the same as the starting price (₹1,943)model estimate ₹1,937for 4 Nov 2026 |
| 5 | 14 days from today | 14 days from today | No clear directionLatest recorded price: ₹1,600 (31 Dec 2025, 10 months ago). No forecast for this crop.for 6 Nov 2026 |
| 6 | 55 days from today | 55 days from today | About the same as the starting price (₹1,365)model estimate ₹1,221for 17 Dec 2026 |
