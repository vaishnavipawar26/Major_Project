"""One verdict, one latest recorded price and one horizon sentence for the result page, explanation page and history."""
from datetime import date, timedelta

import pytest

from app.ml.price_prediction import freshness
from app.ml.price_prediction.features import STATE_MARKET
from app.ml.price_prediction.verdict import horizon_info, latest_recorded, latest_text, price_verdict

TODAY = date(2026, 10, 23)


def test_about_the_same_when_the_change_is_below_the_typical_miss():
    v = price_verdict(2100, 2150, 300)
    assert v["code"] == "about_the_same" and v["change_inr"] == 50 and v["model_estimate"] == 2150
    assert price_verdict(2100, 2399.99, 300)["code"] == "about_the_same"
    assert price_verdict(2100, 2400, 300)["code"] == "rise"          # exactly the typical miss is no longer "smaller"
    assert price_verdict(2100, 1700, 300)["code"] == "fall"
    assert price_verdict(2100, 2150, None)["code"] == "no_clear_direction"


def test_latest_recorded_wording_switches_at_60_days():
    old = latest_recorded(4250, date(2025, 12, 31), TODAY)
    assert old["stale"] and (old["age_n"], old["age_unit"]) == (10, "months")
    assert latest_text(old) == "Latest recorded price: ₹4,250 (31 Dec 2025, 10 months ago). No forecast for this crop."
    recent = latest_recorded(4250, TODAY - timedelta(days=60), TODAY)
    assert not recent["stale"] and latest_text(recent).startswith("Latest recorded price: ₹4,250 (24 Aug 2026, 60 days ago).")
    assert latest_recorded(1, TODAY - timedelta(days=61), TODAY)["stale"]


def test_horizon_info_flags_a_difference():
    assert horizon_info(12, date(2025, 10, 17), 18)["differs"] is True
    assert horizon_info(12, date(2026, 10, 11), 12)["differs"] is False


def _body(crop, days, market=STATE_MARKET):
    return {"state": "Maharashtra", "market": market, "commodity": crop, "as_of": TODAY.isoformat(),
            "target_date": (TODAY + timedelta(days=days)).isoformat()}


CASES = [("Cauliflower", 12, STATE_MARKET), ("Cabbage", 10, STATE_MARKET), ("Brinjal", 10, "APMC Mumbai"), ("Cabbage", 55, STATE_MARKET),
         ("Tomato", 12, "APMC Mumbai"), ("Onion", 14, STATE_MARKET), ("Wheat", 7, STATE_MARKET)]


@pytest.mark.parametrize("crop,days,market", CASES)
def test_result_page_and_explanation_agree(client, user, monkeypatch, crop, days, market):
    monkeypatch.setattr(freshness, "gate_mode", lambda: "auto")
    t = client.post("/api/price-prediction/trend", headers=user["headers"], json=_body(crop, days, market))
    e = client.post("/api/price-prediction/explain", headers=user["headers"], json=_body(crop, days, market))
    assert t.status_code == 200 and e.status_code == 200, (t.text, e.text)
    f, x = t.json(), e.json()["explanations"][0]["v3"]
    h = x["headline"]
    assert f["horizon"] == h["horizon"] == e.json()["horizon"]
    assert f["latest_recorded"] == h["latest_recorded"] or not x.get("context_only")
    if f["policy"]["mode"] == "context_only":
        assert x["context_only"] and h["text"] == latest_text(f["latest_recorded"])
    else:
        v = f["verdict"]
        assert h["code"] == v["code"]
        assert (h["start_price"], h["predicted_price"], h["change_inr"], h["typical_miss_inr"]) == \
               (v["start_price"], v["model_estimate"], v["change_inr"], v["typical_miss_inr"])
        assert v["start_price"] == f["current_price"] and v["model_estimate"] == f["target"]["predicted_price"]
        if v["code"] == "about_the_same":
            assert abs(v["change_inr"]) < v["typical_miss_inr"] and h["text"].startswith(f"About the same as the starting price (₹{v['start_price']:,.0f})")


def test_history_uses_the_same_verdict_policy_and_latest_price(client, user, monkeypatch):
    monkeypatch.setattr(freshness, "gate_mode", lambda: "auto")
    for crop, days, market in CASES:
        f = client.post("/api/price-prediction/predict", headers=user["headers"], json=_body(crop, days, market)).json()
        items = client.get("/api/history/price?limit=100", headers=user["headers"]).json()["items"]
        row = next(i for i in items if i["id"] == f["id"])
        assert row["policy"] == f["policy"], (crop, days)                 # the band counts from the market's last report, not from today
        assert row["latest_recorded"] == f["latest_recorded"], (crop, days)
        if f["policy"]["mode"] == "model":
            assert row["verdict"] == f["verdict"], (crop, days)
