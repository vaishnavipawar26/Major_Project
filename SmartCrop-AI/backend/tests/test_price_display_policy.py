"""What the result and history pages are allowed to show: no model price for context-only cells, range only with enough measured coverage."""
import copy
from datetime import date, timedelta

import pytest

from app.ml.price_prediction import freshness
from app.ml.price_prediction.features import STATE_MARKET
from app.services import price_service

TODAY = date(2026, 10, 23)
STATE = "Maharashtra"


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch):
    monkeypatch.setattr(price_service, "today", lambda: TODAY)
    monkeypatch.setattr(freshness, "gate_mode", lambda: "auto")


@pytest.fixture
def fc(client):
    return client.app.state.registry.price


def req(crop, days, market=STATE_MARKET):
    return {"state": STATE, "market": market, "commodity": crop, "target_date": (TODAY + timedelta(days=days)).isoformat()}


def test_context_only_forecast_carries_the_latest_recorded_price_with_its_real_date(client, user):
    b = client.post("/api/price-prediction/predict", headers=user["headers"], json=req("Onion", 14)).json()
    assert b["policy"]["mode"] == "context_only"
    lr = b["latest_recorded"]
    assert lr["price"] > 0 and lr["date"] <= "2025-12-31"          # a real record, not today's date and not the estimated start price
    a = b["advice"]
    assert a["code"] == "UNAVAILABLE" and a["target_price"] is None and a["recommended_price"] is None and a["peak"] is None


def test_model_cell_keeps_price_and_advice(client, user):
    b = client.post("/api/price-prediction/trend", headers=user["headers"], json=req("Cauliflower", 12)).json()
    assert b["policy"]["mode"] == "model" and b["advice"]["target_price"] is not None


def test_range_is_hidden_below_40_percent_measured_coverage_and_shown_from_40(client, user, fc, monkeypatch):
    base = copy.deepcopy(fc.reliability_table)
    key = "Cauliflower|8-14"
    for cov, shown in ((39.9, False), (40.0, True), (82.0, True)):
        t = copy.deepcopy(base)
        t["scenarios"]["projection"]["cells"][key]["range_coverage_pct"] = cov
        monkeypatch.setattr(fc, "reliability_table", t)
        ri = client.post("/api/price-prediction/trend", headers=user["headers"], json=req("Cauliflower", 12)).json()["range_info"]
        assert ri["shown"] is shown and ri["coverage_pct"] == cov and ri["scope"] == "projection", cov
        assert ri["min_coverage_to_show_pct"] == 40.0 and ri["n"] > 100


def test_unmeasured_coverage_is_reported_as_unknown_not_invented(client, user, fc, monkeypatch):
    monkeypatch.setattr(fc, "reliability_table", None)
    ri = client.post("/api/price-prediction/trend", headers=user["headers"], json=req("Cauliflower", 12)).json()["range_info"]
    assert ri["coverage_pct"] is None and ri["shown"] is True and ri["n"] is None


def test_history_items_carry_policy_and_latest_recorded_price(client, user):
    client.post("/api/price-prediction/predict", headers=user["headers"], json=req("Onion", 14))
    client.post("/api/price-prediction/predict", headers=user["headers"], json=req("Cauliflower", 12))
    items = {i["commodity"]: i for i in client.get("/api/history/price", headers=user["headers"]).json()["items"]}
    assert items["Onion"]["policy"]["mode"] == "context_only" and items["Cauliflower"]["policy"]["mode"] == "model"
    assert items["Onion"]["latest_recorded"]["price"] > 0 and items["Onion"]["latest_recorded"]["date"] <= "2025-12-31"
    one = client.get(f"/api/history/price/{items['Onion']['id']}", headers=user["headers"]).json()
    assert one["policy"]["mode"] == "context_only" and one["predicted_price"] > 0   # the stored number is untouched; the page decides what to show
    recent = client.get("/api/history/summary", headers=user["headers"]).json()["recent_predictions"]
    assert {i["commodity"]: i["policy"]["mode"] for i in recent} == {"Onion": "context_only", "Cauliflower": "model"}
