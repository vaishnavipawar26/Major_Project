"""30-day selling window: daily entries, planned-date price and best-alternative selection, on synthetic daily paths."""
from datetime import date, timedelta

import pytest

from app.ml.price_prediction.window import NOT_VALIDATED, UNAVAILABLE, VALIDATED, build_window

START = date(2026, 11, 1)


def forecast(prices, planned_day, validated=lambda h: True, horizons=60):
    """A forecast dict: prices[h-1] is the price h days after START (None = no prediction)."""
    path = []
    for h in range(1, horizons + 1):
        p = prices[h - 1] if h <= len(prices) else 1000.0
        path.append({"horizon_days": h, "date": (START + timedelta(days=h)).isoformat(), "predicted_price": p,
                     "lower": p and p * 0.9, "upper": p and p * 1.1, "beats_baseline": validated(h)})
    return {"input_date": START.isoformat(), "target_date": (START + timedelta(days=planned_day)).isoformat(),
            "current_price": 1000.0, "forecast_origin_date": START.isoformat(), "chart_path": path}


def test_one_entry_per_day_for_30_days():
    w = build_window(forecast([1000.0] * 60, 5))
    assert [e["day"] for e in w["entries"]] == list(range(1, 31))
    assert w["entries"][0]["date"] == "2026-11-02" and w["entries"][-1]["date"] == "2026-12-01"
    assert w["end_date"] == "2026-12-01" and w["validated_days"] == 30


def test_planned_date_uses_its_own_daily_prediction():
    prices = [1000.0 + h for h in range(1, 61)]
    w = build_window(forecast(prices, 7))
    assert w["planned"]["date"] == "2026-11-08" and w["planned"]["price"] == prices[6]
    assert w["planned"]["price"] == next(e for e in w["entries"] if e["date"] == "2026-11-08")["predicted_price"]


def test_alternative_is_highest_validated_price_with_exact_formulas():
    prices = [1000.0] * 60
    prices[14] = 1150.0   # day 15
    prices[21] = 1100.0   # day 22
    c = build_window(forecast(prices, 5))["comparison"]
    assert c["code"] == "alternative" and c["date"] == "2026-11-16" and c["price"] == 1150.0
    assert c["diff"] == 150.0 and c["diff_pct"] == 15.0 and c["wait_days"] == 10


def test_earliest_date_wins_a_tie():
    prices = [1000.0] * 60
    prices[9] = prices[19] = 1200.0
    assert build_window(forecast(prices, 2))["comparison"]["date"] == "2026-11-11"


def test_planned_date_already_best():
    prices = [1000.0] * 60
    prices[4] = 1300.0
    c = build_window(forecast(prices, 5))["comparison"]
    assert c["code"] == "planned_is_best" and c["diff"] == 0 and c["wait_days"] == 0


def test_earlier_date_can_be_best_and_has_negative_wait():
    prices = [1000.0] * 60
    prices[2] = 1100.0
    c = build_window(forecast(prices, 10))["comparison"]
    assert c["code"] == "alternative" and c["wait_days"] == -7 and c["diff"] == 100.0


def test_unvalidated_and_missing_days_are_never_the_alternative():
    prices = [1000.0] * 60
    prices[9] = 5000.0     # day 10: high but not validated
    prices[11] = None      # day 12: no prediction
    prices[14] = 1050.0    # day 15: validated
    w = build_window(forecast(prices, 3, validated=lambda h: h != 10))
    by = {e["day"]: e for e in w["entries"]}
    assert by[10]["status"] == NOT_VALIDATED and by[12]["status"] == UNAVAILABLE and by[12]["predicted_price"] is None
    assert w["comparison"]["date"] == "2026-11-16" and w["highest"]["price"] == 1050.0


def test_no_validated_planned_price_gives_no_comparison():
    w = build_window(forecast([1000.0] * 60, 5, validated=lambda h: False))
    assert w["comparison"]["code"] == "unavailable" and w["comparison"]["reason"] == "planned_not_validated"
    assert w["highest"] is None and w["change"] is None and w["planned"]["status"] == NOT_VALIDATED


def test_planned_outside_window_is_not_substituted():
    w = build_window(forecast([1000.0] * 60, 45))
    assert w["comparison"]["code"] == "outside_window"
    assert w["planned"]["date"] == "2026-12-16" and w["planned"]["in_window"] is False and w["planned"]["status"] == VALIDATED


def test_change_over_window_and_zero_reference_price():
    prices = [1000.0] * 60
    prices[29] = 1100.0
    w = build_window(forecast(prices, 5))
    assert w["change"] == {"to_date": "2026-12-01", "pct": 10.0, "is_window_end": True}
    f = forecast(prices, 5)
    f["current_price"] = 0
    assert build_window(f)["change"] is None


@pytest.mark.parametrize("bad", [0, -5, float("nan"), float("inf")])
def test_invalid_prices_are_unavailable(bad):
    prices = [1000.0] * 60
    prices[9] = bad
    w = build_window(forecast(prices, 3))
    assert next(e for e in w["entries"] if e["day"] == 10)["status"] == UNAVAILABLE


def test_dates_beyond_the_crop_keeps_are_not_recommended():
    prices = [1000.0] * 60
    prices[9] = 1100.0    # day 10: inside a 14-day hold
    prices[24] = 1300.0   # day 25: beyond it
    c = build_window(forecast(prices, 3), hold_days=14)["comparison"]
    assert c["date"] == "2026-11-11" and c["price"] == 1100.0
    assert c["beyond_storage"] == {"date": "2026-11-26", "price": 1300.0}
    assert build_window(forecast(prices, 3))["comparison"]["date"] == "2026-11-26"


def test_window_carries_the_reliability_result_so_the_page_can_say_why():
    f = forecast([1000.0] * 60, 5, validated=lambda h: False)
    f["policy"] = {"mode": "context_only", "band": "1-7", "reasons": ["Real-origin backtest: model -17.2% vs no-change."]}
    f["last_validated_days"] = 0
    v = build_window(f)["validation"]
    assert v["mode"] == "context_only" and v["reasons"] == ["Real-origin backtest: model -17.2% vs no-change."] and v["validated_up_to_days"] == 0
    assert build_window(forecast([1000.0] * 60, 5))["validation"]["mode"] is None   # no policy in the forecast: nothing is claimed


def test_experimental_comparison_only_when_nothing_is_validated_and_never_mixed_in():
    prices = [1000.0] * 60
    prices[14] = 1200.0
    w = build_window(forecast(prices, 5, validated=lambda h: False))
    assert w["comparison"]["code"] == "unavailable" and w["validated_days"] == 0 and w["highest"] is None
    e = w["experimental"]
    assert e["validated"] is False and e["planned"]["price"] == 1000.0
    assert e["comparison"]["code"] == "alternative" and e["comparison"]["date"] == "2026-11-16" and e["comparison"]["diff"] == 200.0
    # with validated days the validated comparison stands alone
    assert build_window(forecast(prices, 5))["experimental"] is None
    # a missing prediction on the planned date gives no experimental comparison either
    prices[4] = None
    assert build_window(forecast(prices, 5, validated=lambda h: False))["experimental"] is None
