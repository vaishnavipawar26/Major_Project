"""Decision rules of the smart selling recommendation, on synthetic forecast paths."""
import math
from datetime import date, timedelta

import pytest

from app.ml.price_prediction.selling_advice import STORAGE, best_time_to_sell, reliable_peak
from app.schemas.price_prediction import SellingAdvice

ORIGIN = date(2026, 11, 1)
BAND = math.log(1.05)  # model's usual error: about ±5%


def make_path(prices, band=BAND, validated=None):
    """One forecast point per day; ``prices[i]`` is the price ``i + 1`` days ahead."""
    return [{"horizon_days": h, "date": (ORIGIN + timedelta(days=h)).isoformat(),
             "predicted_price": p, "lower": p and p * 0.9, "upper": p and p * 1.1,
             "beats_baseline": validated is None or h in validated, "_band": band}
            for h, p in enumerate(prices, start=1)]


def advise(prices, target_h, commodity="Potato", path=None, **kw):
    a = best_time_to_sell(path or make_path(prices, **kw), target_h, commodity, False)
    SellingAdvice(**a)  # always matches the API schema
    return a


def check_maths(a):
    """Extra money, % difference and waiting days follow the documented formulas."""
    extra = a["recommended_price"] - a["target_price"]
    assert a["extra_per_quintal"] == pytest.approx(extra, abs=0.01)
    assert a["extra_pct"] == pytest.approx(extra / a["target_price"] * 100, abs=0.01)
    days = (date.fromisoformat(a["recommended_date"]) - date.fromisoformat(a["target_date"])).days
    assert a["wait_days"] == days


# Case A
def test_better_future_date_is_recommended():
    prices = [1000.0] * 30
    prices[11] = 1100.0  # 12 days ahead, +10% vs the planned date (5 days ahead)
    a = advise(prices, 5)
    assert a["code"] == "WAIT" and a["label"] == "A better selling date may be available"
    assert a["recommended_horizon_days"] == 12 and a["wait_days"] == 7
    assert a["extra_per_quintal"] == 100.0 and a["extra_pct"] == 10.0
    assert a["alternative"]["meaningful"] and not a["needs_special_storage"]
    assert "₹100" in a["explanation"] and "before storage costs" in a["explanation"]
    check_maths(a)


def test_wait_beyond_farm_storage_needs_proper_storage_and_gives_farm_option():
    prices = [1000.0] * 60
    prices[9] = 1080.0   # 5 days after the planned date: within farm storage
    prices[39] = 1200.0  # 35 days after: needs cold storage for potato
    a = advise(prices, 5)
    assert STORAGE["Potato"]["farm_hold_days"] < 35 <= STORAGE["Potato"]["max_hold_days"]
    assert a["code"] == "WAIT" and a["wait_days"] == 35 and a["needs_special_storage"]
    assert a["farm_option"]["horizon_days"] == 10
    assert "cold storage" in a["reason"]
    check_maths(a)


# Case B
def test_higher_past_price_is_reported_but_not_recommended():
    prices = [1000.0] * 30
    prices[2] = 1300.0  # 3 days ahead, before the planned date
    a = advise(prices, 10)
    assert a["code"] == "SELL_ON_TARGET" and a["recommended_horizon_days"] == 10
    assert a["best_before"]["horizon_days"] == 3 and a["best_after"] is None
    assert "highest predicted price in the available forecast" in a["explanation"]
    assert a["peak"]["horizon_days"] == 3
    check_maths(a)


# Case C
def test_planned_date_is_best():
    prices = [1000.0 - h for h in range(30)]
    prices[4] = 1200.0
    a = advise(prices, 5)
    assert a["code"] == "SELL_ON_TARGET" and a["label"] == "Sell on your planned date"
    assert a["best_before"] is None and a["best_after"] is None and a["alternative"] is None
    assert a["extra_per_quintal"] == 0 and a["wait_days"] == 0
    assert "forecast window only" in a["reason"]  # not claimed as the season's peak


# Case D
def test_higher_price_after_storage_limit_is_never_recommended():
    prices = [1000.0] * 30
    prices[19] = 1300.0  # 15 days after the planned date; tomatoes keep about 7 days
    a = advise(prices, 5, commodity="Tomato")
    assert a["code"] == "STORAGE_LIMIT" and a["label"] == "Storage conditions may limit waiting"
    assert a["recommended_horizon_days"] == 5 and a["wait_days"] == 0
    assert a["beyond_storage"]["horizon_days"] == 20
    assert a["best_after"]["horizon_days"] == 20 and a["alternative"] is None


# Case E
def test_small_gain_within_model_error_is_not_recommended():
    prices = [1000.0] * 30
    prices[11] = 1012.3  # +1.23%, far below the ±5% usual error
    a = advise(prices, 5)
    assert a["code"] == "NO_CLEAR_DIFFERENCE" and a["label"] == "No clear advantage from waiting"
    assert a["recommended_horizon_days"] == 5 and a["wait_days"] == 0
    alt = a["alternative"]
    assert alt["days_from_target"] == 7 and not alt["meaningful"]
    assert alt["extra_pct"] == pytest.approx(1.23)
    assert "small compared with forecast uncertainty" in a["explanation"]


# Case F
@pytest.mark.parametrize("bad", [float("nan"), 0.0, -5.0, None, float("inf")])
def test_invalid_planned_price_gives_no_comparison(bad):
    prices = [1000.0] * 30
    prices[4] = bad
    a = advise(prices, 5)
    assert a["code"] == "UNAVAILABLE" and a["label"] == "Reliable comparison unavailable"
    assert a["target_price"] is None and a["recommended_price"] is None
    assert a["extra_per_quintal"] is None and a["alternative"] is None
    assert "mandi prices" in a["reason"]


def test_missing_planned_date_gives_no_comparison():
    path = [p for p in make_path([1000.0] * 30) if p["horizon_days"] != 5]
    a = advise(None, 5, path=path)
    assert a["code"] == "UNAVAILABLE" and a["target_date"] is None


def test_unvalidated_planned_date_gives_no_comparison():
    a = advise([1000.0] * 30, 5, validated={1, 2, 3})
    assert a["code"] == "UNAVAILABLE" and a["target_price"] == 1000.0


def test_invalid_alternative_prices_are_ignored():
    prices = [1000.0] * 30
    prices[8] = float("nan")
    prices[9] = 0.0
    a = advise(prices, 5)
    assert a["code"] == "SELL_ON_TARGET"


def test_peak_is_the_same_highest_validated_price_everywhere():
    prices = [1000.0] * 30
    prices[25] = 5000.0  # highest, but not validated
    prices[11] = 1100.0
    path = make_path(prices, validated=set(range(1, 21)))
    a = advise(None, 5, path=path)
    assert reliable_peak(path)["horizon_days"] == 12
    assert a["peak"]["date"] == a["recommended_date"] == path[11]["date"]
