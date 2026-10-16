"""Price forecast sources: selected market -> state median -> other market -> historical estimate.

The forecast starts on 2026-10-16 while the dataset ends on 2025-12-31, so the features come from the
seasonal reference date 2025-10-16 (see PriceForecaster._reference_date). A market with no report in
the 7 days before that date must still be forecast from its older reports or from another source.
"""
from datetime import date, timedelta

import pandas as pd
import pytest

from app.ml.price_prediction.features import STATE_MARKET, STATE_VARIETY
from app.ml.price_prediction.forecaster import SeriesRef, _Ctx, _Unusable
from app.services import price_service

TODAY = date(2026, 10, 16)
REF = date(2025, 10, 16)
CROPS = ("Brinjal", "Cabbage", "Cauliflower", "Onion", "Potato", "Tomato", "Wheat")
STATE = "Maharashtra"


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch):
    monkeypatch.setattr(price_service, "today", lambda: TODAY)


@pytest.fixture
def fc(client):
    return client.app.state.registry.price


def predict(client, user, market, crop, days=30, variety=None, path="predict"):
    body = {"state": STATE, "market": market, "commodity": crop,
            "target_date": (TODAY + timedelta(days=days)).isoformat()}
    if variety:
        body["variety"] = variety
    return client.post(f"/api/price-prediction/{path}", headers=user["headers"], json=body)


def markets(fc, crop, lo=180, hi=10**6):
    """(market, variety) of the crop's single-market series with lo <= reporting days < hi."""
    s = fc.support
    s = s[(s.Commodity == crop) & (s.Market != STATE_MARKET) & (s.observations >= lo) & (s.observations < hi)]
    return [(r.Market, r.Variety) for r in s.sort_values("observations", ascending=False).itertuples()]


def cut(fc, monkeypatch, key, last_day=None, rows=None):
    """Replace one series by a copy that ends on ``last_day`` (or keeps only its first ``rows`` days)."""
    s = fc._series[key]
    s2 = s[s["Date"] <= pd.Timestamp(last_day)] if last_day else s.iloc[:rows]
    monkeypatch.setattr(fc, "_series", {**fc._series, key: s2.reset_index(drop=True)})
    return s2



def key_of(market, crop, variety):
    return (STATE, market, crop, variety)


def last_report_before(fc, key, day):
    s = fc._series[key]
    return s.loc[s["observed"] & (s["Date"] <= pd.Timestamp(day)), "Date"].max().date()


def pick_market(fc, crop="Cauliflower", need_reports_by=date(2025, 10, 1)):
    """A well-reported market that has reports up to the cut date used by the tests."""
    for m, v in markets(fc, crop, 500):
        if last_report_before(fc, key_of(m, crop, v), REF) >= need_reports_by:
            return m, v
    pytest.skip("no well-reported market")


# 1 ------------------------------------------------------------------------------------------
def test_market_with_recent_reports_uses_its_own_data_and_the_trained_model(client, user, fc):
    for m, v in markets(fc, "Cauliflower", 500):
        if (REF - last_report_before(fc, key_of(m, "Cauliflower", v), REF)).days <= 7:
            r = predict(client, user, m, "Cauliflower", variety=v)
            assert r.status_code == 201, r.text
            s = r.json()["source"]
            assert (s["kind"], s["method"], s["fallback"]) == ("market", "trained_model", False)
            assert s["used_market"] == m and s["data_age_days"] <= 7
            return
    pytest.fail("no Cauliflower market with a report in the 7 days before the reference date")


# 2 + 8 --------------------------------------------------------------------------------------
def test_no_report_in_last_seven_days_uses_older_reports_with_the_trained_model(client, user, fc, monkeypatch):
    m, v = pick_market(fc)
    cut(fc, monkeypatch, key_of(m, "Cauliflower", v), last_day="2025-10-01")  # nothing for 15 days
    r = predict(client, user, m, "Cauliflower", variety=v)
    assert r.status_code == 201, r.text
    b = r.json()
    assert b["source"]["kind"] == "market" and b["source"]["method"] == "trained_model"
    assert b["source"]["data_age_days"] > 7 and b["source"]["fallback"] is True
    assert b["target"]["predicted_price"] > 0
    assert date.fromisoformat(b["dates"]["origin_observation_date"]) <= date(2025, 10, 1)


# 3 + 5 --------------------------------------------------------------------------------------
def test_market_without_reports_near_the_reference_date_falls_back_to_the_state_median(client, user, fc, monkeypatch):
    m, v = pick_market(fc)
    cut(fc, monkeypatch, key_of(m, "Cauliflower", v), last_day="2025-06-01")  # origin too old to reach the target
    r = predict(client, user, m, "Cauliflower", variety=v)
    assert r.status_code == 201, r.text
    s = r.json()["source"]
    assert (s["kind"], s["method"], s["used_market"]) == ("state_median", "trained_model", STATE_MARKET)
    assert s["requested_market"] == m and s["fallback"] is True
    # the saved history entry keeps the market the farmer chose
    item = client.get("/api/history/price", headers=user["headers"]).json()["items"][0]
    assert item["market"] == m


def test_market_with_too_little_data_uses_the_state_median(client, user, fc, monkeypatch):
    m, v = pick_market(fc)
    cut(fc, monkeypatch, key_of(m, "Cauliflower", v), rows=12)
    s = predict(client, user, m, "Cauliflower", variety=v).json()["source"]
    assert s["kind"] == "state_median" and s["method"] == "trained_model"


# 6 ------------------------------------------------------------------------------------------
def test_state_level_data_insufficient_uses_another_market(client, user, fc, monkeypatch):
    m, v = pick_market(fc)
    series = dict(fc._series)
    for k in ((STATE, m, "Cauliflower", v), (STATE, STATE_MARKET, "Cauliflower", STATE_VARIETY)):
        series[k] = series[k].iloc[:12].reset_index(drop=True)
    monkeypatch.setattr(fc, "_series", series)
    r = predict(client, user, m, "Cauliflower", variety=v)
    assert r.status_code == 201, r.text
    s = r.json()["source"]
    assert s["kind"] == "other_market" and s["method"] == "trained_model"
    assert s["used_market"] not in (m, STATE_MARKET) and s["fallback"] is True
    assert r.json()["series"]["commodity"] == "Cauliflower"  # never another crop


# 4 + 13 -------------------------------------------------------------------------------------
def test_forecast_start_in_2026_with_data_ending_in_2025_keeps_the_dates_apart(client, user, fc):
    b = predict(client, user, STATE_MARKET, "Cauliflower", days=30).json()
    d = b["dates"]
    assert d["forecast_start"] == "2026-10-16" and d["target_date"] == "2026-11-15"
    assert d["reference_date"] == "2025-10-16" and d["years_shifted"] == 1
    assert date.fromisoformat(d["latest_data_date"]) <= fc.data_end == date(2025, 12, 31)
    assert date.fromisoformat(d["origin_observation_date"]) <= REF
    assert b["input_date"] == "2026-10-16" and b["forecast_origin_date"].startswith("2026")


def test_inflation_is_applied_exactly_once(client, user, fc):
    b = predict(client, user, STATE_MARKET, "Cauliflower", days=20).json()
    p = b["projection"]
    assert p["price_level_factor"] == pytest.approx((1 + fc.inflation) ** 1, abs=1e-4)
    assert b["current_price"] == pytest.approx(p["reference_price"] * p["price_level_factor"], abs=0.02)
    # the historical estimate uses the same single factor for the same series and reference date
    ref = SeriesRef(STATE, STATE_MARKET, "Cauliflower", STATE_VARIETY)
    now = _Ctx(TODAY, REF, 1, 1 + fc.inflation)
    same_year = _Ctx(REF, REF, 0, 1.0)
    a = fc._forecast_baseline(ref, now, TODAY + timedelta(days=20))
    z = fc._forecast_baseline(ref, same_year, REF + timedelta(days=20))
    assert a["current_price"] == pytest.approx(z["current_price"] * (1 + fc.inflation), rel=1e-3)
    assert a["target"]["predicted_price"] == pytest.approx(z["target"]["predicted_price"] * (1 + fc.inflation), rel=1e-3)


# 7 ------------------------------------------------------------------------------------------
def test_market_with_fewer_than_180_reporting_days_is_listed_and_forecast(client, user, fc):
    opts = client.get("/api/price-prediction/options", headers=user["headers"]).json()
    short = markets(fc, "Cabbage", 30, 180) + markets(fc, "Tomato", 30, 180)
    assert short, "dataset has no 30-179 day series"
    for m, v in short[:4]:
        crop = fc.support[(fc.support.Market == m) & (fc.support.Variety == v)].Commodity.iloc[0]
        listed = next(c for c in opts["commodities"] if c["commodity"] == crop)
        assert m in {x["market"] for x in listed["markets"]}
        r = predict(client, user, m, crop, variety=v)
        assert r.status_code == 201, r.text
        assert r.json()["target"]["predicted_price"] > 0
    assert opts["min_listed_days"] == 30 and opts["unsupported_series"] == int((fc.support.observations < 30).sum())


# 9 ------------------------------------------------------------------------------------------
def test_historical_estimate_is_used_when_no_model_can_run(client, user, fc, monkeypatch):
    def no_model(*a, **k):
        raise _Unusable("model unavailable")
    monkeypatch.setattr(fc, "_forecast_model", no_model)
    m, v = pick_market(fc)
    r = predict(client, user, m, "Cauliflower", variety=v)
    assert r.status_code == 201, r.text
    b = r.json()
    assert b["source"]["method"] == "historical_baseline" and b["source"]["kind"] == "market"
    assert "no model" in b["model"]["algorithm"].lower()
    t = b["target"]
    assert t["lower"] <= t["predicted_price"] <= t["upper"] and t["predicted_price"] > 0
    assert t["beats_baseline"] is False and t["model_mae"] is None
    assert b["validated_days"] == 0 and b["advice"]["code"] == "UNAVAILABLE"
    assert b["forecast_origin_date"] == TODAY.isoformat()
    # explain does not invent reasons for a number that no model produced
    e = predict(client, user, m, "Cauliflower", variety=v, path="explain").json()
    assert e["explanations"] == [] and e["message"]


# 10 -----------------------------------------------------------------------------------------
def test_no_valid_records_for_the_crop_is_a_clear_error_not_a_made_up_price(client, user, fc, monkeypatch):
    monkeypatch.setattr(fc, "_series", {k: v for k, v in fc._series.items() if k[2] != "Onion"})
    r = predict(client, user, STATE_MARKET, "Onion")
    assert r.status_code == 422
    assert "price history" in r.json()["detail"].lower()
    # a crop whose series are all too short for even a historical estimate
    monkeypatch.setattr(fc, "_series", {k: (v.iloc[:2] if k[2] == "Wheat" else v) for k, v in fc._series.items()})
    r = predict(client, user, STATE_MARKET, "Wheat")
    assert r.status_code == 422 and "not enough valid historical wheat prices" in r.json()["detail"].lower()
    # other crops are not used as a substitute and still work
    assert predict(client, user, STATE_MARKET, "Potato").status_code == 201


# 11 -----------------------------------------------------------------------------------------
@pytest.mark.parametrize("crop", CROPS)
def test_every_crop_works_with_the_model_and_with_the_historical_estimate(client, user, fc, monkeypatch, crop):
    r = predict(client, user, STATE_MARKET, crop)
    assert r.status_code == 201, r.text
    assert r.json()["source"]["method"] == "trained_model"
    price_model = r.json()["target"]["predicted_price"]
    ref = SeriesRef(STATE, STATE_MARKET, crop, STATE_VARIETY)
    est = fc._forecast_baseline(ref, _Ctx(TODAY, REF, 1, 1 + fc.inflation), TODAY + timedelta(days=30))
    assert est["target"]["predicted_price"] > 0
    # an indicative estimate is in the same range as the trained model, not wildly different
    assert 0.4 < est["target"]["predicted_price"] / price_model < 2.5


# 12 -----------------------------------------------------------------------------------------
@pytest.mark.parametrize("days", [1, 2, 7, 12, 13, 30, 45, 59, 60])
def test_every_horizon_from_1_to_60_days_works(client, user, days):
    b = predict(client, user, STATE_MARKET, "Cauliflower", days=days).json()
    assert b["target"]["date"] == (TODAY + timedelta(days=days)).isoformat()
    assert b["target"]["predicted_price"] > 0 and len(b["path"]) >= b["target_horizon_days"]


def test_horizons_outside_1_to_60_days_are_rejected(client, user):
    for days in (0, -3, 61):
        assert predict(client, user, STATE_MARKET, "Cauliflower", days=days).status_code == 422


def test_horizons_with_a_stale_origin_still_return_a_price(client, user, fc, monkeypatch):
    """A market whose last report is old: far targets move to another source, near ones keep the market."""
    m, v = pick_market(fc)
    cut(fc, monkeypatch, key_of(m, "Cauliflower", v), last_day="2025-09-20")
    for days in (1, 30, 60):
        r = predict(client, user, m, "Cauliflower", days=days, variety=v)
        assert r.status_code == 201, (days, r.text)
        assert r.json()["target"]["predicted_price"] > 0


# 14 -----------------------------------------------------------------------------------------
def test_reports_after_the_reference_date_never_change_the_forecast(client, user, fc, monkeypatch):
    m, v = pick_market(fc)
    key = key_of(m, "Cauliflower", v)
    before_model = predict(client, user, m, "Cauliflower", variety=v, path="trend").json()
    ref = SeriesRef(*key)
    ctx = _Ctx(TODAY, REF, 1, 1 + fc.inflation)
    before_base = fc._forecast_baseline(ref, ctx, TODAY + timedelta(days=30))
    # make every report after the reference date absurd; a forecast that peeked would change
    s = fc._series[key].copy()
    late = s["Date"] > pd.Timestamp(REF)
    s.loc[late, ["price", "price_ffill"]] = s.loc[late, ["price", "price_ffill"]] * 10
    monkeypatch.setattr(fc, "_series", {**fc._series, key: s})
    after_model = predict(client, user, m, "Cauliflower", variety=v, path="trend").json()
    after_base = fc._forecast_baseline(ref, ctx, TODAY + timedelta(days=30))
    assert after_model["path"] == before_model["path"] and after_model["history"] == before_model["history"]
    assert after_base["path"] == before_base["path"] and after_base["current_price"] == before_base["current_price"]
