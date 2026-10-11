import math
from datetime import date, timedelta

import pytest

from app.ml.price_prediction.features import STATE_MARKET, STATE_VARIETY
from app.services import price_service

TODAY = date(2025, 6, 16)  # inside the dataset, so real later prices exist for comparison
STATE_REQ = {"state": "Maharashtra", "market": STATE_MARKET, "commodity": "Onion",
             "target_date": "2025-06-30"}


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch):
    monkeypatch.setattr(price_service, "today", lambda: TODAY)


def test_options_lists_crops_and_forecast_window(client, user):
    r = client.get("/api/price-prediction/options", headers=user["headers"])
    assert r.status_code == 200
    body = r.json()
    crops = {c["commodity"] for c in body["commodities"]}
    assert crops == {"Brinjal", "Cabbage", "Cauliflower", "Onion", "Potato", "Tomato", "Wheat"}
    assert body["today"] == TODAY.isoformat() and body["max_horizon_days"] == 60
    onion = next(c for c in body["commodities"] if c["commodity"] == "Onion")
    assert onion["markets"][0]["is_state_aggregate"] is True
    assert onion["markets"][0]["default_variety"] == STATE_VARIETY
    assert all(1 <= h <= 60 for h in onion["validated_horizons"])


def test_predict_starts_today_and_returns_a_daily_path(client, user):
    # a client-sent start date is ignored: new predictions always start today
    r = client.post("/api/price-prediction/predict", headers=user["headers"],
                    json={**STATE_REQ, "as_of": "2025-01-01"})
    assert r.status_code == 201, r.text
    b = r.json()
    assert b["input_date"] == TODAY.isoformat()
    assert b["series"]["variety"] == STATE_VARIETY  # variety chosen automatically
    origin = date.fromisoformat(b["forecast_origin_date"])
    assert origin <= TODAY

    path = b["path"]
    dates = [date.fromisoformat(p["date"]) for p in path]
    assert dates == [origin + timedelta(days=i) for i in range(1, len(path) + 1)]
    assert len(path) == max(b["target_horizon_days"], b["last_validated_days"])
    assert sum(p["beats_baseline"] for p in path) <= b["validated_days"]
    # every date gets its own model prediction (not one price repeated)
    assert len({p["predicted_price"] for p in path}) > len(path) // 2

    t = b["target"]
    assert t["date"] == STATE_REQ["target_date"]
    assert t == path[b["target_horizon_days"] - 1]
    assert t["lower"] <= t["predicted_price"] <= t["upper"]
    assert t["actual_price"] is not None  # inside the dataset -> comparable with reality

    a = b["advice"]
    assert a["target_price"] == t["predicted_price"]
    rec = next((p for p in path if p["date"] == a["recommended_date"]), None)
    if a["recommended_horizon_days"] == 0:
        assert a["recommended_price"] == b["current_price"]
    else:
        assert rec is not None and a["recommended_price"] == rec["predicted_price"]
    assert a["wait_days"] == a["recommended_horizon_days"] - b["target_horizon_days"]
    assert "not a guarantee" in a["disclaimer"]

    hist = client.get("/api/history/price", headers=user["headers"]).json()
    item = hist["items"][0]
    assert hist["total"] == 1 and item["id"] == b["id"]
    assert TODAY + timedelta(days=item["horizon_days"]) == date.fromisoformat(STATE_REQ["target_date"])
    assert item["predicted_price"] == t["predicted_price"]


def test_trend_matches_predict_and_reopens_saved_dates(client, user):
    p = client.post("/api/price-prediction/predict", headers=user["headers"], json=STATE_REQ).json()
    t = client.post("/api/price-prediction/trend", headers=user["headers"],
                    json={**STATE_REQ, "as_of": p["input_date"]}).json()
    assert t["path"] == p["path"] and t["advice"] == p["advice"]
    assert all(h["date"] <= t["forecast_origin_date"] for h in t["history"])
    assert all(a["date"] > t["forecast_origin_date"] for a in t["actual_after_origin"])


def test_target_date_must_be_inside_the_forecast_window(client, user):
    for target in ("2025-06-16", "2025-06-10", "2025-08-20"):
        r = client.post("/api/price-prediction/predict", headers=user["headers"],
                        json={**STATE_REQ, "target_date": target})
        assert r.status_code == 422, target


def test_shap_values_add_up_to_prediction(client, user):
    """SHAP additivity: base value + sum of contributions == model output (not fabricated)."""
    t = client.post("/api/price-prediction/trend", headers=user["headers"], json=STATE_REQ).json()
    e = client.post("/api/price-prediction/explain", headers=user["headers"], json=STATE_REQ)
    assert e.status_code == 200
    exps = e.json()["explanations"]
    assert exps[0]["date"] == STATE_REQ["target_date"]
    for exp in exps:
        total = exp["base_value"] + sum(f["shap_value"] for f in exp["technical"])
        f = next(x for x in t["path"] if x["horizon_days"] == exp["horizon_days"])
        assert abs(total - math.log(f["predicted_price"] / t["current_price"])) < 2e-3
        assert len(exp["farmer_explanation"]) == 3
        assert {f["impact"] for f in exp["factors"]} <= {"higher", "lower", "small"}
        assert all("shap" not in s.lower() for s in exp["farmer_explanation"])


def test_future_start_is_seasonal_projection(client, user, monkeypatch):
    """Starting after the dataset reuses the same calendar day a year earlier + inflation."""
    ref = client.post("/api/price-prediction/trend", headers=user["headers"],
                      json={**STATE_REQ, "as_of": "2025-10-10", "target_date": "2025-10-20"}).json()
    monkeypatch.setattr(price_service, "today", lambda: date(2026, 10, 10))
    r = client.post("/api/price-prediction/predict", headers=user["headers"],
                    json={**STATE_REQ, "target_date": "2026-10-20"})
    assert r.status_code == 201, r.text
    b = r.json()
    p = b["projection"]
    assert p["years_ahead"] == 1 and p["reference_origin_date"] == ref["forecast_origin_date"]
    assert b["forecast_origin_date"] == "2026" + ref["forecast_origin_date"][4:]
    assert abs(b["current_price"] - ref["current_price"] * p["price_level_factor"]) < 0.02
    assert b["history_is_reference"] is True and b["actual_after_origin"] == []
    assert all(x["actual_price"] is None for x in b["path"])
    n = min(len(b["path"]), len(ref["path"]))
    assert [x["change_pct"] for x in b["path"][:n]] == [x["change_pct"] for x in ref["path"][:n]]


def test_unknown_series_rejected(client, user):
    r = client.post("/api/price-prediction/predict", headers=user["headers"],
                    json={**STATE_REQ, "commodity": "Rice"})
    assert r.status_code == 422


def test_market_level_forecast(client, user):
    opts = client.get("/api/price-prediction/options", headers=user["headers"]).json()
    tomato = next(c for c in opts["commodities"] if c["commodity"] == "Tomato")
    m = next(x for x in tomato["markets"] if not x["is_state_aggregate"])
    start = date.fromisoformat(m["last_date"])
    r = client.post("/api/price-prediction/trend", headers=user["headers"],
                    json={"state": "Maharashtra", "market": m["market"], "commodity": "Tomato",
                          "as_of": start.isoformat(),
                          "target_date": (start + timedelta(days=7)).isoformat()})
    # either a forecast or an honest "not enough data" message — never a 500
    assert r.status_code in (200, 422), r.text
