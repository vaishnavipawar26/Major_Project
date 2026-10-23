"""Budget- and risk-aware plan: a decision layer that runs AFTER the recommendation model.

It never changes a score, rank, price or profit. It reads the finished results of the 7 crops (their cost, profit, low-end profit,
price-forecast reliability, arrivals) and the farmer's optional budget, priority and risk level, and answers "which crop is best FOR
YOU". Everything is derived from numbers already in the results; nothing is invented. See docs/budget_plan.md for the rules.
"""
from __future__ import annotations

from app.ml.price_prediction.monthly import STATE_SERIES

PRIORITIES = ("spend_less", "balanced", "highest_profit")
RISK_LEVELS = ("low", "medium", "high")
RISK_ORDER = {"low": 0, "medium": 1, "high": 2}

# ---- the rules, in one place ---------------------------------------------------------------------------------------------
# Risk is judged from the profit at the LOW end of the monthly model's expected price range (economics.net_profit_low),
# as a share of the upfront cost, together with whether the monthly model beat its simple baseline for that crop in testing.
#   reliable forecast (beats_baseline):
#       Low    : net_profit_low >= -10% of upfront cost
#       Medium : net_profit_low >= -40% of upfront cost
#       High   : anything worse
#   NO reliable forecast: never Low.  Medium if net_profit_low >= -40% of upfront cost, otherwise High.
RISK_THRESHOLDS = {"low": 0.10, "medium": 0.40}
# Balanced priority: score = profit / upfront cost - BALANCED_DOWNSIDE_WEIGHT * (share of upfront cost lost at the low end)
BALANCED_DOWNSIDE_WEIGHT = 0.5
# Supply note: the selling month's arrivals against that crop's average month (2023-2025), as a percentage
SUPPLY_NOTE_PCT = 25.0
SUPPLY_YEARS = "2023–2025"


def upfront_cost(econ: dict) -> float:
    """What the farmer pays before selling: cultivation plus storage. Marketing cost is a share of sales and is not upfront."""
    return float(econ["cultivation_cost"]) + float(econ["storage_cost"])


def risk_level(downside_pct: float, reliable: bool) -> str:
    """``downside_pct``: low-end profit as a share of upfront cost (negative = a loss)."""
    if reliable and downside_pct >= -RISK_THRESHOLDS["low"]:
        return "low"
    if downside_pct >= -RISK_THRESHOLDS["medium"]:      # also the best an unreliable forecast can get
        return "medium"
    return "high"


def supply_note(market: dict | None) -> dict | None:
    """A note only when the selling month's arrivals are 25% or more away from the crop's average month; else None."""
    seasonal = ((market or {}).get("explanation") or {}).get("seasonal") or {}
    pct = seasonal.get("arrivals_vs_avg_pct")
    if pct is None or abs(pct) < SUPPLY_NOTE_PCT:
        return None
    return {"kind": "high" if pct > 0 else "low", "pct": round(pct), "month": seasonal["month"], "years": SUPPLY_YEARS,
            "scope": "state" if (market or {}).get("series") == STATE_SERIES else "city"}


def crop_facts(r: dict, area: float, budget: float | None) -> dict:
    e, m = r["economics"], r["market"]
    f = {"crop": r["crop_name"], "eligible": bool(r["eligible"]), "unsuitable": None, "upfront": None, "upfront_per_acre": None,
         "fits_budget": None, "affordable_area": None, "extra_needed": None, "profit": None, "downside_profit": None,
         "downside_pct": None, "reliable_forecast": False, "risk_level": "high", "supply_note": supply_note(m)}
    if not r["feasible"]:
        f["unsuitable"] = "not_sellable"
    elif r["low_agronomic_suitability"]:
        f["unsuitable"] = "poor_fit"
    elif not r["profitable"]:
        f["unsuitable"] = "loss"
    if not e:
        return f
    up = upfront_cost(e)
    per_acre = up / area if area else up
    f.update(upfront=round(up), upfront_per_acre=round(per_acre), profit=e["net_profit"], downside_profit=e["net_profit_low"])
    f["downside_pct"] = round(e["net_profit_low"] / up, 3) if up else 0.0
    f["reliable_forecast"] = bool(m and m["reliability"]["beats_baseline"])
    f["risk_level"] = risk_level(f["downside_pct"], f["reliable_forecast"])
    if budget is not None:
        f["fits_budget"] = up <= budget
        if not f["fits_budget"]:
            f["extra_needed"] = round(up - budget)
            f["affordable_area"] = round(budget / per_acre, 4) if per_acre else None      # 4 decimals: a very small budget must not round to "0 acre"
    return f


def _sort_key(priority: str):
    if priority == "spend_less":
        return lambda f: (f["upfront"], -f["profit"])
    if priority == "highest_profit":
        return lambda f: (-f["profit"], -f["downside_profit"])
    # balanced: profit for each rupee spent, less a penalty for what could be lost at the low end
    return lambda f: -(f["profit"] / f["upfront"] - BALANCED_DOWNSIDE_WEIGHT * max(0.0, -f["downside_pct"]))


def build_plan(analysis: dict, budget: float | None, priority: str | None, risk: str | None, cost_basis: dict | None = None) -> dict:
    priority, risk = priority or "balanced", risk or "medium"
    area = analysis["area_acres"]
    facts = [crop_facts(r, area, budget) for r in analysis["results"]]
    passing, excluded = [], []
    for f in facts:
        if f["unsuitable"] or f["upfront"] is None:
            excluded.append({"crop": f["crop"], "code": f["unsuitable"] or "no_price", "params": {}})
        elif f["fits_budget"] is False:
            excluded.append({"crop": f["crop"], "code": "over_budget", "params": {"extra": f["extra_needed"], "area": f["affordable_area"]}})
        elif RISK_ORDER[f["risk_level"]] > RISK_ORDER[risk]:
            excluded.append({"crop": f["crop"], "code": "risk", "params": {"level": f["risk_level"]}})
        else:
            passing.append(f)
    passing.sort(key=_sort_key(priority))
    best = passing[0]["crop"] if passing else None
    plan = {"inputs": {"budget_inr": budget, "priority": priority, "risk_level": risk, "area_acres": area},
            "outcome": "ok" if passing else "none_fit", "best_for_you": best,
            "alternatives": [f["crop"] for f in passing[1:3]],
            "matches_standard": bool(best) and best == analysis.get("best_overall"),
            "crops": facts, "excluded": [x for x in excluded if x["crop"] != best],
            "fallback": None, "no_fit_reason": None, "cost_basis": cost_basis,
            "rules": {"risk_thresholds": RISK_THRESHOLDS, "balanced_downside_weight": BALANCED_DOWNSIDE_WEIGHT,
                      "supply_note_pct": SUPPLY_NOTE_PCT}}
    if not passing:
        suitable = [f for f in facts if not f["unsuitable"] and f["upfront"] is not None]
        if not suitable:
            plan["no_fit_reason"] = "no_suitable"
        else:
            affordable = [f for f in suitable if f["fits_budget"] is not False]
            plan["no_fit_reason"] = "risk" if affordable else "budget"
            pick = min(affordable or suitable, key=lambda f: f["upfront"])
            plan["fallback"] = {k: pick[k] for k in ("crop", "upfront", "upfront_per_acre", "extra_needed", "affordable_area", "risk_level", "profit", "downside_profit")}
    return plan
