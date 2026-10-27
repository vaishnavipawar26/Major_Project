"""Budget- and risk-aware plan: the decision layer on top of the recommendation results (it never changes them)."""
import pytest

from app.ml.price_prediction.monthly import STATE_SERIES
from app.ml.crop_recommendation.budget_plan import (RISK_THRESHOLDS, SUPPLY_NOTE_PCT, build_plan, risk_level, supply_note, upfront_cost)


def crop(name, upfront, profit, low, *, reliable=True, eligible=True, feasible=True, viable=True, profitable=True, arrivals=None, series="Pune"):
    return {
        "crop_name": name, "eligible": eligible, "feasible": feasible, "low_agronomic_suitability": not viable, "profitable": profitable,
        "economics": {"cultivation_cost": upfront - 1000, "storage_cost": 1000, "net_profit": profit, "net_profit_low": low,
                      "gross_revenue": upfront + profit, "marketing_cost": 0},
        "market": {"reliability": {"beats_baseline": reliable}, "series": series, "target_month": "2027-02",
                   "supply_check": None if arrivals is None else {"arrivals_vs_avg_pct": arrivals, "scope": "state" if series == STATE_SERIES else "city"}},
    }


def analysis(*results, best="A", area=1.0):
    return {"results": list(results), "best_overall": best, "area_acres": area}


# A: cheap and steady, B: dearer with more profit and a deeper downside, C: cheapest but a rough forecast
A = lambda **k: crop("A", 50000, 20000, -2000, **k)       # downside -4% of cost: Low
B = lambda **k: crop("B", 80000, 60000, -20000, **k)      # downside -25%: Medium
C = lambda **k: crop("C", 30000, 15000, -20000, reliable=False, **k)   # no reliable forecast, -67% at the low end: High


def test_upfront_cost_is_cultivation_plus_storage_not_marketing():
    assert upfront_cost({"cultivation_cost": 60000, "storage_cost": 1500, "total_cost": 70000}) == 61500


@pytest.mark.parametrize("pct,reliable,expected", [
    (0.05, True, "low"), (-0.10, True, "low"), (-0.1001, True, "medium"), (-0.40, True, "medium"), (-0.4001, True, "high"),
    # no reliable forecast: never Low; Medium down to -40%, else High
    (0.20, False, "medium"), (-0.01, False, "medium"), (-0.40, False, "medium"), (-0.4001, False, "high")])
def test_risk_level_thresholds(pct, reliable, expected):
    assert risk_level(pct, reliable) == expected
    assert RISK_THRESHOLDS == {"low": 0.10, "medium": 0.40}


def test_an_unreliable_forecast_is_never_low_but_can_be_medium():
    mild = crop("M", 50000, 20000, -2000, reliable=False)        # -4% at the low end: Low if reliable
    assert build_plan(analysis(mild), None, "balanced", "high")["crops"][0]["risk_level"] == "medium"
    assert build_plan(analysis(mild), None, "balanced", "low")["best_for_you"] is None      # so a Low-risk farmer is not offered it
    assert build_plan(analysis(C()), None, "balanced", "high")["crops"][0]["risk_level"] == "high"


def test_budget_filter_affordable_area_and_extra_needed():
    p = build_plan(analysis(A(), B(), C()), 60000, "highest_profit", "high")
    by = {f["crop"]: f for f in p["crops"]}
    assert by["A"]["fits_budget"] is True and by["A"]["affordable_area"] is None
    assert by["B"]["fits_budget"] is False and by["B"]["extra_needed"] == 20000
    assert by["B"]["affordable_area"] == 0.75                 # 60,000 / 80,000 per acre
    assert p["best_for_you"] == "A" and p["alternatives"] == ["C"]
    assert {"crop": "B", "code": "over_budget", "params": {"extra": 20000, "area": 0.75}} in p["excluded"]


def test_affordable_area_uses_cost_per_acre_of_the_whole_field():
    p = build_plan(analysis(crop("A", 100000, 30000, -3000), area=2.0), 25000, "balanced", "high")
    f = p["crops"][0]
    assert f["upfront_per_acre"] == 50000 and f["affordable_area"] == 0.5 and f["extra_needed"] == 75000


def test_downside_profit_is_the_existing_low_end_profit():
    f = build_plan(analysis(B()), None, None, None)["crops"][0]
    assert f["downside_profit"] == -20000 and f["profit"] == 60000 and f["downside_pct"] == -0.25


def test_risk_exclusion_by_the_farmers_level():
    for level, expected in (("low", {"A"}), ("medium", {"A", "B"}), ("high", {"A", "B", "C"})):
        p = build_plan(analysis(A(), B(), C()), None, "highest_profit", level)
        shown = {p["best_for_you"], *p["alternatives"]}
        assert shown == expected, level
    p = build_plan(analysis(A(), B(), C()), None, "highest_profit", "low")
    assert {"crop": "B", "code": "risk", "params": {"level": "medium"}} in p["excluded"]
    assert {"crop": "C", "code": "risk", "params": {"level": "high"}} in p["excluded"]


def test_spend_less_ranks_cheapest_first_with_profit_as_tie_break():
    p = build_plan(analysis(A(), B(), C(), crop("D", 50000, 30000, -3000)), None, "spend_less", "high")
    assert [p["best_for_you"], *p["alternatives"]] == ["C", "D", "A"]      # 30,000 first; the two at 50,000 tie, the higher profit (D) first


def test_highest_profit_ranks_by_profit_then_downside():
    p = build_plan(analysis(A(), B(), crop("E", 70000, 60000, -5000)), None, "highest_profit", "high")
    assert [p["best_for_you"], *p["alternatives"]] == ["E", "B", "A"]     # E and B earn the same: the smaller downside first


def test_balanced_is_profit_per_rupee_with_a_downside_penalty():
    # X: profit/cost 0.8 but loses 60% at the low end; Y: 0.5 and loses 5%. Score X = 0.8 - 0.5*0.6 = 0.5, Y = 0.5 - 0.5*0.05 = 0.475
    X = crop("X", 50000, 40000, -30000)
    Y = crop("Y", 50000, 25000, -2500)
    assert build_plan(analysis(X, Y), None, "balanced", "high")["best_for_you"] == "X"
    Z = crop("Z", 50000, 25000, -1000)                                    # 0.5 - 0.01 = 0.49 now beats X only if X's penalty grows
    X2 = crop("X", 50000, 40000, -40000)                                  # 0.8 - 0.4 = 0.4
    assert build_plan(analysis(X2, Z), None, "balanced", "high")["best_for_you"] == "Z"


def test_only_suitable_sellable_profitable_crops_are_ever_picked():
    p = build_plan(analysis(crop("P", 40000, 90000, 10000, viable=False), crop("Q", 40000, 90000, 10000, feasible=False),
                            crop("R", 40000, -500, -9000, profitable=False), A(), best="A"), None, "highest_profit", "high")
    assert p["best_for_you"] == "A"
    assert {(x["crop"], x["code"]) for x in p["excluded"]} == {("P", "poor_fit"), ("Q", "not_sellable"), ("R", "loss")}


def test_matches_standard_number_one_flag():
    assert build_plan(analysis(A(), B(), best="A"), None, "spend_less", "high")["matches_standard"] is True
    assert build_plan(analysis(A(), B(), best="B"), None, "spend_less", "high")["matches_standard"] is False


def test_no_crop_fits_the_budget_shows_the_cheapest_suitable_one_and_the_money_needed():
    p = build_plan(analysis(A(), B(), crop("W", 30000, 9000, -2000, viable=False)), 10000, "spend_less", "low")
    # the whole field cannot be paid for, but 0.2 acre of A can: a smaller-area option, never W (not suitable)
    assert p["outcome"] == "partial" and p["best_for_you"] == "A" and p["partial"]["area_acres"] == 0.2 and p["fallback"] is None
    f = p["crops"][0]
    assert f["crop"] == "A" and f["extra_needed"] == 40000 and f["affordable_area"] == 0.2      # the cheaper W is not suitable, so not offered
    assert any(x["crop"] == "W" and x["code"] == "poor_fit" for x in p["excluded"])


def test_no_crop_within_the_risk_level_even_though_the_budget_is_fine():
    p = build_plan(analysis(B(), C()), 500000, "balanced", "low")
    assert p["no_fit_reason"] == "risk" and p["fallback"]["crop"] == "C" and p["fallback"]["extra_needed"] is None


def test_no_suitable_crop_at_all():
    p = build_plan(analysis(crop("P", 40000, 90000, 10000, viable=False)), 100000, "balanced", "high")
    assert p["no_fit_reason"] == "no_suitable" and p["fallback"] is None


def test_without_a_budget_every_crop_fits():
    p = build_plan(analysis(A(), B()), None, "balanced", "high")
    assert all(f["fits_budget"] is None for f in p["crops"]) and p["best_for_you"]


@pytest.mark.parametrize("pct,expected", [(25.0, "high"), (24.9, None), (-25.0, "low"), (-24.9, None), (60, "high"), (None, None)])
def test_supply_note_thresholds(pct, expected):
    n = supply_note(crop("A", 1, 1, 1, arrivals=pct)["market"])
    assert (n["kind"] if n else None) == expected
    assert SUPPLY_NOTE_PCT == 25.0


def test_supply_note_says_when_the_whole_state_was_used():
    assert supply_note(crop("A", 1, 1, 1, arrivals=40, series=STATE_SERIES)["market"])["scope"] == "state"
    assert supply_note(crop("A", 1, 1, 1, arrivals=40, series="Pune")["market"])["scope"] == "city"


# ---------------------------------------------------------------- through the API
BASE = {"nitrogen": 115, "phosphorus": 60, "potassium": 75, "temperature": 21, "humidity": 70, "ph": 6.3, "rainfall": 90, "soil_type": "sandy_loam",
        "city": "Pune", "planting_month": 10, "selling_month": 2, "planting_year": 2026, "area_acres": 1}


def test_empty_inputs_return_exactly_the_standard_output(client, user):
    plain = client.post("/api/crop-recommendation/analyze", headers=user["headers"], json=BASE).json()
    assert plain["personal_plan"] is None
    withplan = client.post("/api/crop-recommendation/analyze", headers=user["headers"], json={**BASE, "budget_inr": 80000, "priority": "balanced", "risk_level": "medium"}).json()
    assert withplan["personal_plan"]["best_for_you"] == "Brinjal"
    moved = {"personal_plan", "recommended_crop", "recommendation_basis"}        # the headline crop may follow the plan; every score, rank, price and profit stays
    assert {k: v for k, v in withplan.items() if k not in moved} == {k: v for k, v in plain.items() if k not in moved}   # nothing else moves


def test_plan_inputs_are_saved_and_history_returns_them_with_the_pick(client, user):
    r = client.post("/api/crop-recommendation/recommend", headers=user["headers"], json={**BASE, "budget_inr": 80000, "priority": "spend_less", "risk_level": "high"})
    assert r.status_code == 201 and r.json()["personal_plan"]["inputs"]["budget_inr"] == 80000
    old = client.post("/api/crop-recommendation/recommend", headers=user["headers"], json=BASE).json()
    items = {i["id"]: i for i in client.get("/api/history/recommendations", headers=user["headers"]).json()["items"]}
    mine, plain = items[r.json()["id"]], items[old["id"]]
    assert (mine["budget_inr"], mine["priority"], mine["risk_level"]) == (80000, "spend_less", "high")
    assert mine["personal_pick"] == r.json()["personal_plan"]["best_for_you"]
    assert (plain["budget_inr"], plain["priority"], plain["risk_level"], plain["personal_pick"]) == (None, None, None, None)


@pytest.mark.parametrize("bad", [{"budget_inr": 0}, {"budget_inr": -5}, {"priority": "cheapest"}, {"risk_level": "extreme"}])
def test_invalid_plan_inputs_are_rejected(client, user, bad):
    assert client.post("/api/crop-recommendation/analyze", headers=user["headers"], json={**BASE, **bad}).status_code == 422


def test_a_very_small_budget_never_rounds_the_affordable_area_to_zero():
    f = build_plan(analysis(crop("A", 100000, 30000, -3000)), 100, "balanced", "high")["crops"][0]
    assert f["affordable_area"] == 0.001 and f["extra_needed"] == 99900
    assert build_plan(analysis(crop("A", 100000, 30000, -3000)), 5, "balanced", "high")["crops"][0]["affordable_area"] == 0.0001


def test_the_supply_check_in_a_real_result_says_which_series_it_used(client, user):
    """The monthly model reports the arrivals comparison itself: the city's own series when it has every calendar month, else Maharashtra-wide."""
    from datetime import date
    body = {**BASE, "city": "Pune"}
    r = client.post("/api/crop-recommendation/analyze", headers=user["headers"], json=body).json()
    by = {x["crop_name"]: x["market"] for x in r["results"]}
    for crop, m in by.items():
        sc = m["supply_check"]
        assert sc is None or (sc["scope"] in ("city", "state") and isinstance(sc["arrivals_vs_avg_pct"], float))
        assert (sc["scope"] == "state") if m["series"] == STATE_SERIES and sc else True        # a state series can only be compared with itself
    assert by["Wheat"]["series"] == STATE_SERIES                                                   # Pune has too few wheat reports for its own series


def test_the_month_history_is_what_the_series_really_sold_for_in_that_month(client, user):
    r = client.post("/api/crop-recommendation/analyze", headers=user["headers"], json=BASE).json()
    for x in r["results"]:
        h = x["market"]["month_history"]
        assert h is not None and 0 < h["low"] <= h["high"] and h["years"] and set(h["years"]) <= {2023, 2024, 2025} and h["n"] >= len(h["years"]) >= 1


def test_priority_and_risk_work_without_a_budget(client, user):
    """No budget: the plan still picks the best suitable crop for the priority and risk level, with no budget figures anywhere."""
    r = client.post("/api/crop-recommendation/analyze", headers=user["headers"], json={**BASE, "priority": "spend_less", "risk_level": "medium"}).json()
    p = r["personal_plan"]
    assert p["inputs"]["budget_inr"] is None and p["outcome"] == "ok" and p["best_for_you"]
    assert all(f["fits_budget"] is None and f["extra_needed"] is None and f["affordable_area"] is None for f in p["crops"])
    assert not any(x["code"] == "over_budget" for x in p["excluded"])
    ranked = sorted((f for f in p["crops"] if not f["unsuitable"] and f["risk_level"] != "high"), key=lambda f: (f["upfront"], -f["profit"]))
    assert p["best_for_you"] == ranked[0]["crop"]                                          # spend less: the cheapest suitable crop within the risk level
    plain = client.post("/api/crop-recommendation/analyze", headers=user["headers"], json=BASE).json()
    assert plain["personal_plan"] is None                                                   # both left at the defaults and no budget: nothing, as today


# ---------------------------------------------------------------- stage 2: priority, budget, smaller area
def test_highest_profit_picks_onion_over_wheat_even_when_wheat_scores_better():
    onion = crop("Onion", 70000, 90000, -5000)
    wheat = crop("Wheat", 28000, 20000, -1000)
    p = build_plan(analysis(wheat, onion, best="Wheat"), None, "highest_profit", "high")      # Wheat is the standard (score) #1
    assert p["best_for_you"] == "Onion" and p["alternatives"] == ["Wheat"] and p["matches_standard"] is False
    assert p["compare"] == ["Onion", "Wheat"] and p["full_field_best"]["crop"] == "Onion"
    assert build_plan(analysis(wheat, onion, best="Wheat"), None, "spend_less", "high")["best_for_you"] == "Wheat"   # another priority, another pick


def test_onion_is_not_picked_when_it_fails_a_suitability_check():
    onion = crop("Onion", 70000, 90000, 10000, viable=False)
    wheat = crop("Wheat", 28000, 20000, -1000)
    p = build_plan(analysis(wheat, onion, best="Wheat"), None, "highest_profit", "high")
    assert p["best_for_you"] == "Wheat" and {"crop": "Onion", "code": "poor_fit", "params": {}} in p["excluded"]


def test_budget_too_small_for_the_field_gives_a_smaller_area_with_scaled_money():
    onion = crop("Onion", 140000, 90000, -10000)           # 2-acre field: 70,000 an acre
    onion["economics"].update(gross_revenue=250000, marketing_cost=17500)
    p = build_plan(analysis(onion, best="Onion", area=2.0), 52500, "highest_profit", "high")
    assert p["outcome"] == "partial" and p["best_for_you"] == "Onion"
    o = p["partial"]
    assert o["area_acres"] == 0.75 and o["guntha"] == 30                      # 52,500 / 70,000 per acre, in whole guntha
    assert (o["upfront"], o["revenue"], o["profit"]) == (52500, 93750, 33750)  # each is 0.375 x the full-field figure
    assert o["upfront"] <= 52500
    assert p["full_field_best"]["crop"] == "Onion" and p["full_field_best"]["extra_needed"] == 87500


def test_smaller_area_is_rounded_down_to_whole_guntha_so_it_stays_in_budget():
    p = build_plan(analysis(crop("A", 40000, 20000, -1000)), 31000, "balanced", "high")      # 0.775 acre = 31 guntha exactly; 30,999 would be 30
    assert p["partial"]["guntha"] == 31
    q = build_plan(analysis(crop("A", 40000, 20000, -1000)), 30999, "balanced", "high")
    assert q["partial"]["guntha"] == 30 and q["partial"]["upfront"] <= 30999


def test_smaller_area_obeys_priority_and_risk():
    cheap = crop("C", 100000, 30000, -3000)              # 30% of cost
    rich = crop("R", 100000, 80000, -9000)               # 80% of cost
    p = build_plan(analysis(cheap, rich), 50000, "highest_profit", "high")
    assert p["best_for_you"] == "R" and p["alternatives"] == ["C"]
    risky = crop("R", 100000, 80000, -60000)             # -60% at the low end: High risk
    assert build_plan(analysis(cheap, risky), 50000, "highest_profit", "low")["best_for_you"] == "C"


def test_budget_too_small_even_for_a_practical_plot_gives_no_option_and_says_so():
    p = build_plan(analysis(crop("A", 100000, 30000, -3000)), 5000, "balanced", "high")       # 0.05 acre < the 0.1 acre minimum
    assert p["outcome"] == "none_fit" and p["best_for_you"] is None and p["partial"] is None and p["no_fit_reason"] == "budget"
    assert p["fallback"]["crop"] == "A" and p["fallback"]["extra_needed"] == 95000


def test_no_suitable_crop_means_no_recommendation_at_all():
    p = build_plan(analysis(crop("P", 40000, 90000, 10000, viable=False), crop("Q", 40000, -100, -900, profitable=False), best=None), 500000, "highest_profit", "high")
    assert p["outcome"] == "none_fit" and p["best_for_you"] is None and p["no_fit_reason"] == "no_suitable"
    assert p["partial"] is None and p["full_field_best"] is None and p["compare"] == []


def test_recommended_crop_follows_the_plan_through_the_api(client, user):
    plain = client.post("/api/crop-recommendation/analyze", headers=user["headers"], json=BASE).json()
    assert plain["recommended_crop"] == plain["best_overall"] and plain["recommendation_basis"] == "score"
    r = client.post("/api/crop-recommendation/analyze", headers=user["headers"], json={**BASE, "priority": "highest_profit", "risk_level": "high"}).json()
    assert r["recommended_crop"] == r["personal_plan"]["best_for_you"] and r["recommendation_basis"] == "plan"
    profits = {f["crop"]: f["profit"] for f in r["personal_plan"]["crops"] if not f["unsuitable"]}
    assert r["recommended_crop"] == max(profits, key=profits.get)
