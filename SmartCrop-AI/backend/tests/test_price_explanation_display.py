"""Display-only fields of the v3 explanation (records reading, plain values, trust level). They add no number and change none."""
from datetime import date, timedelta

import pytest

from app.ml.explainability.price_explainer_v3 import STEP_GROUPS, trust_level
from app.ml.price_prediction import freshness
from app.ml.price_prediction.features import STATE_MARKET

TODAY = date(2026, 10, 23)
CELL = {"skill_vs_baseline_pct": 12.0, "range_coverage_pct": 75.0}


def test_trust_level_rule():
    assert trust_level(CELL, projected=False) == "high"
    assert trust_level({**CELL, "skill_vs_baseline_pct": 9.9}, False) == "medium"
    assert trust_level({**CELL, "range_coverage_pct": 69.9}, False) == "medium"
    assert trust_level({**CELL, "skill_vs_baseline_pct": 2.0, "range_coverage_pct": 40.0}, False) == "medium"
    assert trust_level({**CELL, "skill_vs_baseline_pct": 1.9}, False) == "low"
    assert trust_level({**CELL, "range_coverage_pct": 39.9}, False) == "low"
    assert trust_level(None, False) == "low"
    assert trust_level({"mae": 80, "baseline_mae": 100, "range_coverage_pct": 80}, False) == "high"      # skill derived from the two errors
    assert trust_level(CELL, projected=True) == "medium"                                                # replaying last year's season caps at Medium


def _explain(client, user, crop, days, market=STATE_MARKET):
    body = {"state": "Maharashtra", "market": market, "commodity": crop, "as_of": TODAY.isoformat(), "target_date": (TODAY + timedelta(days=days)).isoformat()}
    r = client.post("/api/price-prediction/explain", headers=user["headers"], json=body)
    assert r.status_code == 200, r.text
    return r.json()["explanations"][0]["v3"]


def test_model_mode_groups_carry_reading_plain_value_and_the_models_push(client, user, monkeypatch):
    monkeypatch.setattr(freshness, "gate_mode", lambda: "auto")
    v = _explain(client, user, "Cauliflower", 26, "APMC Manchar")
    g = v["display"]["groups"]
    assert list(g) == STEP_GROUPS and v["trust"]["level"] in ("high", "medium", "low")
    cards = {c["group"]: c for c in v["cards"]}
    for k, e in g.items():
        assert e["reading"] in ("up", "down", None)
        if e["available"]:
            assert e["plain"] and e["detail"]
        if e["used"] and k in cards:                                    # the same rupee numbers as the cards
            assert e["inr_effect"] == cards[k]["inr_effect"]
    # the records reading is the records': a rise of 28% over 30 days reads "up" whatever the model did
    assert g["trend"]["reading"] == "up" and "up" in g["trend"]["plain"]
    assert g["supply"]["reading"] == "down" and "more arrivals" in g["supply"]["plain"]
    assert g["last_year"]["used"] is False and g["last_year"]["inr_effect"] is None


def test_plain_value_never_contradicts_its_own_reading(client, user, monkeypatch):
    monkeypatch.setattr(freshness, "gate_mode", lambda: "auto")
    for crop, days in (("Cabbage", 12), ("Brinjal", 10), ("Tomato", 12), ("Cauliflower", 26)):
        for k, e in _explain(client, user, crop, days)["display"]["groups"].items():
            if k == "seasonal" and e["available"] and e["reading"] is None:
                assert "usually rose" not in e["plain"] and "usually fell" not in e["plain"], (crop, e["plain"])


def test_context_only_groups_have_records_but_no_rupee_effects(client, user, monkeypatch):
    monkeypatch.setattr(freshness, "gate_mode", lambda: "auto")
    v = _explain(client, user, "Tomato", 12, "APMC Mumbai")
    assert v["context_only"]
    for e in v["display"]["groups"].values():
        assert e["inr_effect"] is None and e["agreement"] is None and e["used"] is False
    assert any(e["reading"] for e in v["display"]["groups"].values())
