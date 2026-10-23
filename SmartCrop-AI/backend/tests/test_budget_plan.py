"""Budget- and risk-aware plan: the decision layer on top of the recommendation results (it never changes them)."""
import pytest

from app.ml.crop_recommendation.budget_plan import (RISK_THRESHOLDS, SUPPLY_NOTE_PCT, build_plan, risk_level, supply_note, upfront_cost)
from app.ml.price_prediction.monthly import STATE_SERIES


def crop(name, upfront, profit, low, *, reliable=True, eligible=True, feasible=True, viable=True, profitable=True, arrivals=None, series="Pune"):
    return {
        "crop_name": name, "eligible": eligible, "feasible": feasible, "low_agronomic_suitability": not viable, "profitable": profitable,
        "economics": {"cultivation_cost": upfront - 1000, "storage_cost": 1000, "net_profit": profit, "net_profit_low": low},
        "market": {"reliability": {"beats_baseline": reliable}, "series": series,
                   "explanation": {"seasonal": {"month": 2, "arrivals_vs_avg_pct": arrivals}}},
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
    assert p["outcome"] == "none_fit" and p["best_for_you"] is None and p["no_fit_reason"] == "budget"
    f = p["fallback"]
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
    assert {k: v for k, v in withplan.items() if k != "personal_plan"} == {k: v for k, v in plain.items() if k != "personal_plan"}   # nothing else moves


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
