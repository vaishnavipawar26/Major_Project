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
    if b["policy"]["mode"] == "context_only":
        # the model is not used to claim a direction for this crop and distance: no model price in the advice either
        assert a["code"] == "UNAVAILABLE" and a["target_price"] is None and a["recommended_price"] is None and a["peak"] is None
        assert b["latest_recorded"]["price"] > 0 and b["latest_recorded"]["date"] <= b["dates"]["latest_data_date"]
        assert not any(p["beats_baseline"] for p in path if b["policy"]["band"] == "8-14" and p["horizon_days"] == b["target_horizon_days"])
    else:
        assert a["target_price"] == t["predicted_price"]
        rec = next((p for p in path if p["date"] == a["recommended_date"]), None)
        assert rec is not None and a["recommended_price"] == rec["predicted_price"]
        assert a["wait_days"] == a["recommended_horizon_days"] - b["target_horizon_days"] >= 0
        # the chart's "In short" summary shows advice.peak: the highest validated price on the chart's path
        validated = [p for p in path if p["beats_baseline"]]
        if validated:
            top = max(validated, key=lambda p: p["predicted_price"])
            assert (a["peak"]["date"], a["peak"]["price"]) == (top["date"], top["predicted_price"])
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
        simple = exp["simple"]
        total = (exp["base_value"] + simple["other"]["shap_value"]
                 + sum(f["shap_value"] for f in simple["factors"]))
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


# ---------------------------------------------------------------- explanation integration
def _explain(client, user, **over):
    body = {**STATE_REQ, **over}
    t = client.post("/api/price-prediction/trend", headers=user["headers"], json=body).json()
    e = client.post("/api/price-prediction/explain", headers=user["headers"], json=body)
    assert e.status_code == 200, e.text
    return t, e.json()["explanations"][0]


def test_explanation_summary_matches_the_forecast_and_is_not_a_sum_of_factors(client, user):
    t, exp = _explain(client, user)
    s = exp["summary"]
    assert s["reference_price"] == t["current_price"] and s["predicted_price"] == t["target"]["predicted_price"]
    assert s["change_pct"] == pytest.approx((s["predicted_price"] / s["reference_price"] - 1) * 100, abs=0.15)
    assert exp["prediction_change_pct"] == pytest.approx(s["change_pct"], abs=0.15)
    # the overall change comes from the model output; per-factor percentages do not add up to it
    assert all("effect_pct" not in f for f in exp["factors"])
    assert exp["weather"]["status"] in ("not_used", "used", "unavailable")
    if exp["weather"]["status"] == "not_used":
        assert all(f["factor"] != "weather" for f in exp["factors"])
    assert exp["reliability"]["model_mae"] > 0 and exp["price_range"]["lower"] <= s["predicted_price"] <= exp["price_range"]["upper"]


def test_explanation_evidence_matches_the_price_series(client, user):
    """The 7-day averages quoted to farmers are recomputed here from the stored panel."""
    import pandas as pd

    from app.ml.price_prediction.features import STATE_MARKET, STATE_VARIETY
    from app.ml.common import paths
    t, exp = _explain(client, user)
    origin = pd.Timestamp(t["forecast_origin_date"])
    panel = pd.read_parquet(paths.PRICE_PANEL_PATH)
    s = panel[(panel["Market"] == STATE_MARKET) & (panel["Commodity"] == "Onion")
              & (panel["Variety"] == STATE_VARIETY) & panel["observed"] & (panel["Date"] <= origin)]
    last = s[s["Date"] > origin - pd.Timedelta(days=7)]["price"].mean()
    prev = s[(s["Date"] <= origin - pd.Timedelta(days=7)) & (s["Date"] > origin - pd.Timedelta(days=14))]["price"].mean()
    rw = next(f for f in exp["factors"] if f["factor"] == "recent_week")
    ev = rw["evidence"][0]
    assert ev["value"] == pytest.approx(last, abs=0.06) and ev["reference_value"] == pytest.approx(prev, abs=0.06)
    assert ev["change_pct"] == pytest.approx((last / prev - 1) * 100, abs=0.06)
    # farmer sentences never leak technical terms
    for sentence in exp["farmer_explanation"]:
        assert not any(w in sentence.lower() for w in ("shap", "log-ratio", "feature vector"))


def test_every_crop_returns_an_explanation_with_consistent_direction(client, user):
    for crop in ("Brinjal", "Cabbage", "Cauliflower", "Onion", "Potato", "Tomato", "Wheat"):
        _, exp = _explain(client, user, commodity=crop)
        for f in exp["factors"]:
            assert f["direction"] == ("up" if f["shap_value"] > 0 else "down")
            assert f["strength"] in ("small", "moderate", "strong")
        assert exp["summary"]["headline"].startswith("Why")


def test_reasons_for_every_crop_and_scope_are_evidence_backed(client, user):
    """Real models, state aggregate and a single mandi: at most three market reasons, each with evidence, a meaning
    sentence and a direction equal to the sign of its summed SHAP; arrivals only with arrival evidence; data basis stated."""
    allowed = {"recent_week", "averages", "price_level", "season", "arrivals", "state_market", "weather"}
    for crop in ("Brinjal", "Cabbage", "Cauliflower", "Onion", "Potato", "Tomato", "Wheat"):
        _, exp = _explain(client, user, commodity=crop)
        assert exp["technical"]["reconstruction_ok"] is True
        assert len(exp["reasons"]) <= 3 and exp["scope"]["kind"] == "state"
        assert "No live market feed" in exp["data_basis"]["text"]
        by = {f["factor"]: f for f in exp["factors"]}
        for r in exp["reasons"]:
            assert r["id"] in allowed and r["evidence"] and r["meaning"]
            assert r["direction"] == ("up" if r["shap_value"] > 0 else "down")
            if r["id"] == "arrivals":
                assert by["arrivals"]["evidence_available"] and by["arrivals"]["evidence"]
            if r["id"] == "recent_week":
                s = sum(by[k]["shap_value"] for k in ("recent_week", "recent_month") if k in by)
                assert r["shap_value"] == pytest.approx(s, abs=1e-4)
        if exp["what_it_means"]:
            assert exp["what_it_means"].startswith(("The forecast is", "The model expects little", "The strongest factors"))


def test_model_crop_keeps_the_full_advice_and_reports_range_coverage(client, user):
    """A crop/band where the model is used: advice has the model's price; the range carries its measured coverage."""
    r = client.post("/api/price-prediction/trend", headers=user["headers"],
                    json={**STATE_REQ, "commodity": "Cauliflower", "target_date": "2025-06-30"})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["policy"]["mode"] == "model" and b["advice"]["target_price"] == b["target"]["predicted_price"]
    ri = b["range_info"]
    assert ri["scope"] == "real_origin" and ri["n"] > 100 and ri["shown"] == (ri["coverage_pct"] >= 40.0)
    assert b["latest_recorded"]["date"] <= b["dates"]["latest_data_date"]
