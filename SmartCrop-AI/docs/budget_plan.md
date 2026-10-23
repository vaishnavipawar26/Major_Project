# Budget- and risk-aware plan

An optional layer on top of the crop recommendation. It runs **after** the recommendation model and only reads its results:
it never changes a score, rank, price or profit. If the farmer enters no budget, priority or risk level, nothing is added to
the response (`personal_plan` is null) and every page looks as before.

Code: `backend/app/ml/crop_recommendation/budget_plan.py` (rules are constants at the top of that file).
Stored with the history record in three nullable columns: `budget_inr`, `priority`, `risk_level` (migration `0003_budget_plan`).

## Data used (nothing invented)
| Figure | Source |
|---|---|
| Upfront cost | `economics.cultivation_cost + economics.storage_cost` for the whole field. Cultivation = `crop_economics.csv` cost per acre (2024 prices, `approximate_assumption`) x 1.05 per year to the planting year x acres. **Marketing cost is not upfront** (a share of sales) |
| Estimated profit | `economics.net_profit` (unchanged) |
| If the price is at the low end of its expected range | `economics.net_profit_low`: profit at the monthly model's 80% range lower bound |
| Reliable forecast | the monthly price model's `beats_baseline` for that crop (CV error below the simple "latest price + inflation" guess). `crop_policy.json` (the daily 1-60 day model) is **not** used here |
| Supply note | the selling month's arrivals against that crop's average month, 2023-2025 (`market.supply_check` of the monthly model): on the city's own series when it has every calendar month observed, otherwise on all Maharashtra markets (`scope: "state"`, and the note says "Maharashtra-wide") |

## Risk level (per crop)
`downside = net_profit_low / upfront cost` (negative = a loss at the low end)

| Forecast | Low | Medium | High |
|---|---|---|---|
| Reliable (`beats_baseline`) | downside >= -10% | downside >= -40% | anything worse |
| **Not** reliable | **never Low** | downside >= -40% | anything worse |

Thresholds: `RISK_THRESHOLDS = {"low": 0.10, "medium": 0.40}`. The supply note is shown for information; it does not change the level.

## Choosing the crop
1. Keep only crops that the existing model calls suitable: enough soil/weather values in range, sellable in the selling month, and
   expected to make a profit (`eligible`).
2. Drop crops whose upfront cost is above the budget (listed as "needs Rs Z more" / "your budget covers N acre").
3. Drop crops riskier than the farmer's level (Low -> Low only; Medium -> Low/Medium; High -> all).
4. Rank by priority:
   * **Spend less**: lowest upfront cost first (tie: higher profit).
   * **Balanced**: `profit / upfront - 0.5 x max(0, -downside)` (`BALANCED_DOWNSIDE_WEIGHT`), highest first.
   * **Highest profit**: highest profit first (tie: smaller downside).
5. `best_for_you` is the first; up to two more are alternatives. `matches_standard` says whether it equals the standard #1.

If nothing passes, the plan says so plainly and offers the cheapest *suitable* crop, with its full cost for the field, the extra money
needed and the area the budget does cover. Costs are approximate estimates (2024 prices + 5% a year).
