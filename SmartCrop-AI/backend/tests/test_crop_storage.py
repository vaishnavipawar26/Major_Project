"""Crop storage configuration and the storage-aware selling recommendation.

Storage figures are general post-harvest guidance (see ml/price_prediction/crop_storage.py for the sources), so these tests check the
SHAPE and the RULES of the configuration (every supported crop, sourced, different per crop type, never invented) and the recommendation
logic on synthetic forecast paths. They do not assert that any crop keeps for an exact number of days in real life."""
import json
from datetime import date, timedelta

import pytest

from app.ml.common import paths
from app.ml.price_prediction import crop_storage as cs
from app.ml.price_prediction.window import VALIDATED, build_window

START = date(2026, 11, 1)
SUPPORTED = ["Brinjal", "Cabbage", "Cauliflower", "Onion", "Potato", "Tomato", "Wheat"]


def forecast(prices, planned_day, validated=lambda h: True):
    """prices[h-1] = predicted price h days after START (None = no prediction); default 1000."""
    path = []
    for h in range(1, 61):
        p = prices[h - 1] if h <= len(prices) else 1000.0
        path.append({"horizon_days": h, "date": (START + timedelta(days=h)).isoformat(), "predicted_price": p,
                     "lower": p and p * 0.9, "upper": p and p * 1.1, "beats_baseline": validated(h)})
    return {"input_date": START.isoformat(), "target_date": (START + timedelta(days=planned_day)).isoformat(),
            "current_price": 1000.0, "forecast_origin_date": START.isoformat(), "chart_path": path}


def plan_of(crop, prices, planned_day, facility="ordinary", profile=None, **kw):
    w = build_window(forecast(prices, planned_day, **kw), storage=cs.storage_plans(crop))
    key = cs.plan_key(facility, profile or cs.CROPS[crop]["default_profile"])
    return w, w["storage"]["plans"][key]


# ------------------------------------------------------------------------------------------------ the configuration
def test_every_crop_the_price_model_supports_has_storage_guidance_and_nothing_else_is_invented():
    meta = json.loads((paths.MODELS_DIR / "price_prediction" / "metadata.json").read_text(encoding="utf-8"))
    assert sorted(cs.supported_crops()) == sorted(meta["commodities"]) == SUPPORTED


def test_every_figure_has_sources_a_range_and_is_marked_approximate():
    for crop, c in cs.CROPS.items():
        assert c["category"] and c["perishability"]
        for pk, p in c["profiles"].items():
            assert p["conditions"] and p["risks"] and p["advice"], (crop, pk)
            assert set(p["facilities"]) == set(cs.FACILITIES)
            for fk, f in p["facilities"].items():
                if f["days"] is None:
                    assert f["sources"] == [] and "No reliable figure" in f["basis"]      # a gap is stated, never filled in
                    continue
                assert isinstance(f["days"], int) and f["days"] >= 0 and f["range"] and f["basis"], (crop, pk, fk)
                assert f["sources"], f"{crop}/{pk}/{fk} has no source"
                assert f["confidence"] in ("moderate", "low")
                for s in f["sources"]:
                    assert cs.SOURCES[s]["url"].startswith("https://") and cs.SOURCES[s]["publisher"] and cs.SOURCES[s]["title"]
        plan = cs.resolve(crop)
        assert plan["approximate"] is True and plan["uncertainty"] and plan["sources"]


def test_crop_types_do_not_share_one_storage_duration():
    ordinary = {c: cs.resolve(c)["hold_days"] for c in SUPPORTED}
    fresh = [ordinary[c] for c in ("Tomato", "Brinjal", "Cauliflower", "Cabbage")]
    assert max(fresh) <= 14                                    # fresh vegetables: days to about two weeks, not months
    assert min(ordinary[c] for c in ("Onion", "Potato", "Wheat")) >= 60      # bulbs, tubers and dry grain are kept for months
    assert len(set(ordinary.values())) >= 5                    # no single figure applied to everything
    assert ordinary["Brinjal"] < ordinary["Tomato"]            # brinjal spoils fastest (NHB: 1-4 days in shade)


def test_the_default_is_ordinary_farm_storage_and_cold_storage_is_never_assumed():
    for crop in SUPPORTED:
        sp = cs.storage_plans(crop)
        assert sp["default"].startswith("ordinary:")
        assert cs.resolve(crop)["facility"] == "ordinary" and cs.resolve(crop)["facility_used"] == "ordinary"


def test_a_facility_without_a_reliable_figure_falls_back_and_says_so():
    cauli = cs.resolve("Cauliflower", "improved")
    assert cauli["fallback"] and cauli["facility_used"] == "ordinary" and cauli["hold_days"] == cs.resolve("Cauliflower")["hold_days"]
    wheat = cs.resolve("Wheat", "cold")
    assert wheat["fallback"] and wheat["facility_used"] == "improved"
    onion = cs.resolve("Onion", "cold")
    assert onion["fallback"] and onion["facility_used"] == "improved"


def test_better_storage_never_gives_a_shorter_time_than_ordinary_storage():
    for crop in SUPPORTED:
        o = cs.resolve(crop, "ordinary")["hold_days"]
        assert cs.resolve(crop, "improved")["hold_days"] >= o and cs.resolve(crop, "cold")["hold_days"] >= o, crop


def test_uncured_onion_and_undried_wheat_are_not_treated_like_dry_stock():
    for crop, profile in (("Onion", "uncured"), ("Wheat", "moist")):
        for fk in cs.FACILITIES:
            p = cs.resolve(crop, fk, profile)
            assert p["hold_days"] == 0 and "no safe holding" in p["range"]
        assert cs.resolve(crop)["hold_days"] > 0               # the dry / cured default does keep


def test_low_confidence_figures_carry_an_extra_warning():
    low = cs.resolve("Cabbage")
    assert low["confidence"] == "low" and "low-confidence" in low["uncertainty"]
    assert "low-confidence" not in cs.resolve("Brinjal")["uncertainty"]


def test_unknown_crops_get_no_storage_time_instead_of_a_guess():
    p = cs.resolve("Cotton")
    assert p["supported"] is False and p["hold_days"] == 0 and p["sources"] == [] and "no storage guidance" in p["uncertainty"].lower()
    sp = cs.storage_plans("Maize")
    w = build_window(forecast([1000.0] * 60, 5), storage=sp)       # must not crash, and must not recommend waiting
    assert w["comparison"]["wait_days"] <= 0 and w["storage"]["plans"][sp["default"]]["hold_days"] == 0   # never recommends waiting


def test_the_older_summary_is_derived_from_the_same_configuration():
    from app.ml.price_prediction.selling_advice import STORAGE
    for crop in SUPPORTED:
        assert STORAGE[crop]["farm_hold_days"] == cs.resolve(crop)["hold_days"]
        assert STORAGE[crop]["max_hold_days"] == max(cs.resolve(crop, f)["hold_days"] for f in cs.FACILITIES)


# ------------------------------------------------------------------------------------------------ the recommendation
def test_example_a_brinjal_a_higher_price_19_days_later_is_not_recommended_under_ordinary_storage():
    prices = [1572.0] * 60                     # planned day 6 (7 Nov): 1,572
    prices[24] = 1730.0                        # day 25 (26 Nov), 19 days after the planned date: the highest forecast price
    for facility in ("ordinary", "improved", "cold"):
        w, plan = plan_of("Brinjal", prices, 6, facility)
        c = plan["comparison"]
        assert c["code"] == "planned_is_best" and c["date"] == "2026-11-07" and c["price"] == 1572.0
        assert c["highest"] == {"date": "2026-11-26", "price": 1730.0, "within_storage": False}
        assert c["beyond_storage"] == {"date": "2026-11-26", "price": 1730.0}
        assert c["wait_days"] == 0 and c["diff"] == 0.0
    assert plan_of("Brinjal", prices, 6)[1]["hold_days"] == 2


def test_storage_deadline_is_the_planned_date_plus_the_holding_days():
    prices = [1000.0] * 60
    prices[9] = 1200.0                          # day 10
    w, plan = plan_of("Tomato", prices, 5)      # planned day 5, tomato ordinary = 7 days
    assert plan["hold_days"] == 7 and plan["deadline"] == (START + timedelta(days=12)).isoformat()
    c = plan["comparison"]
    assert c["code"] == "alternative" and c["date"] == (START + timedelta(days=10)).isoformat() and c["wait_days"] == 5
    assert c["deadline"] == plan["deadline"] and c["days_left"] == 2          # sold 5 days into a 7-day limit
    assert c["highest"]["within_storage"] is True


def test_example_d_tomato_a_cool_chamber_makes_a_later_date_feasible_but_ordinary_storage_does_not():
    prices = [1000.0] * 60
    prices[19] = 1300.0                        # day 20: 15 days after planned day 5
    _, ordinary = plan_of("Tomato", prices, 5, "ordinary")
    _, chamber = plan_of("Tomato", prices, 5, "improved")                 # 14 days
    _, cold = plan_of("Tomato", prices, 5, "cold")                        # 14 days
    for p in (ordinary, chamber, cold):
        assert p["comparison"]["code"] == "planned_is_best"               # 15 days is beyond even the best tomato storage
        assert p["comparison"]["beyond_storage"]["price"] == 1300.0
    prices[17] = 1250.0                         # day 18: 13 days after planned day 5
    _, ordinary = plan_of("Tomato", prices, 5, "ordinary")
    _, chamber = plan_of("Tomato", prices, 5, "improved")
    assert ordinary["comparison"]["code"] == "planned_is_best"
    assert chamber["comparison"]["code"] == "alternative" and chamber["comparison"]["price"] == 1250.0 and chamber["comparison"]["wait_days"] == 13


def test_example_b_dry_wheat_can_use_later_dates_but_the_fresh_vegetable_limit_is_not_applied_to_it():
    prices = [1000.0] * 60
    prices[24] = 1100.0                        # day 25: 20 days after planned day 5
    _, wheat = plan_of("Wheat", prices, 5, "ordinary", "dry")
    assert wheat["comparison"]["code"] == "alternative" and wheat["comparison"]["wait_days"] == 20 and wheat["comparison"]["price"] == 1100.0
    _, tomato = plan_of("Tomato", prices, 5, "ordinary")
    assert tomato["comparison"]["code"] == "planned_is_best"             # the same path, a fresh vegetable: not feasible
    _, moist = plan_of("Wheat", prices, 5, "ordinary", "moist")          # damp grain is not held at all
    assert moist["comparison"]["code"] == "planned_is_best" and moist["hold_days"] == 0


def test_example_c_onion_depends_on_curing():
    prices = [1000.0] * 60
    prices[19] = 1150.0                        # day 20
    _, cured = plan_of("Onion", prices, 5, "ordinary", "cured")
    _, uncured = plan_of("Onion", prices, 5, "ordinary", "uncured")
    assert cured["comparison"]["code"] == "alternative" and cured["comparison"]["wait_days"] == 15
    assert uncured["comparison"]["code"] == "planned_is_best" and uncured["comparison"]["beyond_storage"]["price"] == 1150.0


def test_cotton_style_dry_goods_and_vegetables_never_share_rules():
    veg = {c for c in SUPPORTED if cs.CROPS[c]["category"] == "Fresh vegetable"}
    assert veg == {"Tomato", "Brinjal", "Cauliflower", "Cabbage"}
    for c in set(SUPPORTED) - veg:
        assert cs.resolve(c)["hold_days"] > max(cs.resolve(v)["hold_days"] for v in veg)


def test_the_best_feasible_date_is_the_highest_price_among_feasible_dates_and_earlier_dates_are_always_feasible():
    prices = [1000.0] * 60
    prices[2] = 1100.0                          # day 3, before the planned day 10
    prices[11] = 1050.0                         # day 12, inside brinjal's limit? (ordinary 2 days -> deadline day 12)
    prices[14] = 5000.0                         # day 15, beyond the deadline
    w, plan = plan_of("Brinjal", prices, 10)
    c = plan["comparison"]
    assert c["code"] == "alternative" and c["date"] == "2026-11-04" and c["price"] == 1100.0 and c["wait_days"] == -7
    assert c["highest"]["price"] == 5000.0 and c["highest"]["within_storage"] is False       # highest price shown separately
    assert c["beyond_storage"]["price"] == 5000.0


def test_planned_date_is_recommended_when_no_better_feasible_date_exists_with_zero_difference():
    _, plan = plan_of("Potato", [1000.0] * 60, 5)
    c = plan["comparison"]
    assert (c["code"], c["wait_days"], c["diff"], c["diff_pct"]) == ("planned_is_best", 0, 0.0, 0.0) and c["date"] == plan["comparison"]["date"]
    assert c["days_left"] == plan["hold_days"]


def test_missing_or_unvalidated_forecast_days_are_never_recommended_or_invented():
    prices = [1000.0] * 60
    prices[9] = 9000.0                          # not validated
    prices[11] = None                           # no prediction
    prices[13] = 1060.0
    w, plan = plan_of("Potato", prices, 5, validated=lambda h: h != 10)
    assert plan["comparison"]["date"] == (START + timedelta(days=14)).isoformat() and plan["comparison"]["price"] == 1060.0
    by = {e["date"]: e for e in w["entries"]}
    assert by[plan["comparison"]["date"]]["status"] == VALIDATED
    _, none = plan_of("Potato", [1000.0] * 60, 5, validated=lambda h: False)
    assert none["comparison"]["code"] == "unavailable" and none["comparison"]["price"] is None


def test_every_plan_of_every_crop_agrees_with_the_same_forecast_entries():
    prices = [1000.0 + (h * 37) % 211 for h in range(1, 61)]
    for crop in SUPPORTED:
        w = build_window(forecast(prices, 8), storage=cs.storage_plans(crop))
        entries = {e["date"]: e["predicted_price"] for e in w["entries"] if e["status"] == VALIDATED}
        assert w["storage"]["default"].startswith("ordinary:")
        assert w["comparison"] == w["storage"]["plans"][w["storage"]["default"]]["comparison"]
        for key, plan in w["storage"]["plans"].items():
            c = plan["comparison"]
            assert c["price"] == entries[c["date"]], (crop, key)               # the recommended price IS a forecast value
            assert c["highest"]["price"] == max(entries.values()) == w["highest"]["price"]
            assert c["date"] <= plan["deadline"]
            if c["code"] == "alternative":
                assert c["price"] > w["planned"]["price"] and c["price"] == max(v for d, v in entries.items() if d <= plan["deadline"])
