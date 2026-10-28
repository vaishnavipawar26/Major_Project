"""60-day selling window: daily entries, planned-date price and best-alternative selection, on synthetic daily paths."""
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


def test_one_entry_per_day_for_60_days():
    w = build_window(forecast([1000.0] * 60, 5))
    assert [e["day"] for e in w["entries"]] == list(range(1, 61))
    assert w["entries"][0]["date"] == "2026-11-02" and w["entries"][-1]["date"] == "2026-12-31"
    assert w["end_date"] == "2026-12-31" and w["validated_days"] == 60 and w["days"] == 60


def test_window_crosses_month_and_year_boundaries_and_leap_days():
    import app.ml.price_prediction.window as W
    f = forecast([1000.0] * 60, 5)
    f["input_date"] = "2026-12-20"
    f["chart_path"] = [{**p, "date": (date(2026, 12, 20) + timedelta(days=p["horizon_days"])).isoformat()} for p in f["chart_path"]]
    w = W.build_window(f)
    dates = [e["date"] for e in w["entries"]]
    assert dates[0] == "2026-12-21" and "2027-01-01" in dates and dates[-1] == "2027-02-18" and len(set(dates)) == 60
    f["input_date"] = "2028-01-20"
    f["chart_path"] = [{**p, "date": (date(2028, 1, 20) + timedelta(days=p["horizon_days"])).isoformat()} for p in f["chart_path"]]
    assert "2028-02-29" in [e["date"] for e in W.build_window(f)["entries"]]


def test_every_day_record_names_crop_market_model_horizon_and_reason():
    f = forecast([1000.0] * 60, 5, validated=lambda h: h != 3)
    f["series"] = {"commodity": "Wheat", "market": "APMC X"}
    f["source"] = {"used_market": "APMC X"}
    for p in f["chart_path"]:
        p["model"] = "random_forest"
    e = {x["day"]: x for x in build_window(f)["entries"]}
    assert e[10]["crop"] == "Wheat" and e[10]["market"] == "APMC X" and e[10]["model"] == "random_forest" and e[10]["horizon_days"] == 10
    assert e[10]["reason"] is None and e[3]["status"] == NOT_VALIDATED and e[3]["reason"]


def test_days_past_the_models_horizon_are_unavailable_with_the_reason_never_filled():
    f = forecast([1000.0] * 48, 5, horizons=48)          # the model's path ends 12 days short of the window
    f["max_horizon_days"], f["forecast_origin_date"] = 60, (START - timedelta(days=12)).isoformat()
    w = build_window(f)
    late = [e for e in w["entries"] if e["day"] > 48]
    assert len(late) == 12 and all(e["status"] == UNAVAILABLE and e["predicted_price"] is None for e in late)
    assert "at most 60 days" in late[0]["reason"] and w["unavailable_days"] == 12 and w["validated_days"] == 48


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
    w = build_window(forecast([1000.0] * 60, 65, horizons=70))
    assert w["comparison"]["code"] == "outside_window"
    assert w["planned"]["date"] == "2027-01-05" and w["planned"]["in_window"] is False and w["planned"]["status"] == VALIDATED


def test_change_uses_first_and_last_validated_forecast_and_names_the_dates():
    prices = [1000.0 + h for h in range(1, 61)]          # day 1 = 1001 ... day 60 = 1060
    c = build_window(forecast(prices, 5))["change"]
    assert c["from_date"] == "2026-11-02" and c["from_price"] == 1001.0 and c["to_date"] == "2026-12-31" and c["to_price"] == 1060.0
    assert c["abs"] == 59.0 and c["pct"] == round(59 / 1001 * 100, 2) and c["is_window_end"] is True
    # unvalidated days at either end are not endpoints
    c = build_window(forecast(prices, 5, validated=lambda h: 5 <= h <= 40))["change"]
    assert c["from_date"] == "2026-11-06" and c["to_date"] == "2026-12-11" and c["is_window_end"] is False
    assert build_window(forecast(prices, 5, validated=lambda h: h == 7))["change"] is None   # one point: nothing comparable
    assert build_window(forecast(prices, 5, validated=lambda h: False))["change"] is None


def test_reference_says_whether_the_starting_price_is_adjusted():
    f = forecast([1000.0] * 60, 5)
    f["source"] = {"used_market": "APMC X"}
    r = build_window(f)["reference"]
    assert r["adjusted"] is False and r["price"] == 1000.0 and r["market"] == "APMC X"
    f["projection"] = {"reference_origin_date": "2025-10-16", "reference_price": 952.0, "years_ahead": 1, "inflation_annual_pct": 5.0}
    r = build_window(f)["reference"]
    assert r["adjusted"] is True and r["reported_price"] == 952.0 and r["reported_date"] == "2025-10-16" and r["adjustment_pct_per_year"] == 5.0
    f["current_price"] = 0
    assert build_window(f)["reference"] is None


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


def test_each_day_is_labelled_validated_experimental_or_unavailable_and_counted():
    prices = [1000.0] * 60
    prices[11] = None
    w = build_window(forecast(prices, 5, validated=lambda h: h > 20))
    kinds = [e["series"] for e in w["entries"]]
    assert kinds.count("experimental") == 19 and kinds.count("unavailable") == 1 and kinds.count("validated") == 40
    assert w["counts"] == {"validated": 40, "experimental": 19, "unavailable": 1}
    assert all(e["predicted_price"] is None for e in w["entries"] if e["series"] == "unavailable")
