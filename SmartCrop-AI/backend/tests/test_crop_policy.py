"""The per crop x band policy (model vs context-only) built by scripts/build_crop_policy.py."""
import json
from datetime import date, timedelta

import pytest

from app.ml.common import paths
from app.ml.price_prediction import freshness
from app.ml.price_prediction.features import STATE_MARKET

BANDS = ["1-7", "8-14", "15-30", "31-60"]
CROPS = ["Brinjal", "Cabbage", "Cauliflower", "Onion", "Potato", "Tomato", "Wheat"]
TODAY = date(2026, 10, 23)


@pytest.fixture(scope="module")
def policy():
    return json.loads((paths.MODELS_DIR / "price_reliability" / "crop_policy.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def reliability():
    return json.loads((paths.MODELS_DIR / "price_reliability" / "reliability_v1.json").read_text(encoding="utf-8"))


def mode(policy, crop, band):
    return policy["cells"][f"{crop}|{band}"]["mode"]


def test_policy_covers_every_cell_and_every_context_only_cell_has_a_reason(policy):
    assert set(policy["cells"]) == {f"{c}|{b}" for c in CROPS for b in BANDS}
    for k, c in policy["cells"].items():
        assert c["mode"] in ("model", "context_only") and c["reasons"], k


def test_onion_is_context_only_in_every_band(policy):
    assert [mode(policy, "Onion", b) for b in BANDS] == ["context_only"] * 4
    text = " ".join(policy["cells"]["Onion|8-14"]["reasons"])
    assert "no-change" in text and "-11.7" in text.replace("−", "-") and "market-bootstrap" in text


def test_wheat_is_context_only_in_every_band(policy):
    """Wheat 1-7 (+1.8%) and 8-14 (+0.1%) beat no-change in the real-origin backtest, but by less than the +2% margin."""
    assert [mode(policy, "Wheat", b) for b in BANDS] == ["context_only"] * 4
    assert "below the +2% margin" in " ".join(policy["cells"]["Wheat|1-7"]["reasons"])


def test_potato_and_tomato_are_context_only_everywhere_and_the_others_use_the_model(policy):
    for crop in ("Potato", "Tomato"):
        assert all(mode(policy, crop, b) == "context_only" for b in BANDS)
    for crop in ("Brinjal", "Cabbage", "Cauliflower"):
        assert all(mode(policy, crop, b) == "model" for b in BANDS)
    assert sorted(policy["no_change_crops"]) == ["Potato", "Tomato"]


def test_policy_follows_the_rule_against_the_reliability_table(policy, reliability):
    """A model cell needs skill >= +2% in BOTH backtests; any cell below that must be context-only."""
    real, proj = reliability["scenarios"]["real_origin"]["cells"], reliability["scenarios"]["projection"]["cells"]
    for key, c in policy["cells"].items():
        beats_both = min(real[key]["skill_vs_baseline_pct"], proj[key]["skill_vs_baseline_pct"]) >= 2.0
        assert real[key]["beats_baseline"] or not beats_both
        if c["mode"] == "model":
            assert beats_both, key
        elif key.split("|")[0] not in policy["no_change_crops"]:
            assert not beats_both, key


@pytest.fixture
def fc(client):
    return client.app.state.registry.price


def test_forecaster_applies_the_policy(fc):
    assert fc.policy_for("Onion", 14)["mode"] == "context_only"
    assert fc.policy_for("Wheat", 7)["mode"] == "context_only" and fc.policy_for("Cabbage", 20)["mode"] == "model"
    assert fc.policy_for("Tomato", 3)["band"] == "1-7"


def _explain(client, user, crop, days, market=STATE_MARKET, variety=None):
    body = {"state": "Maharashtra", "market": market, "commodity": crop, "as_of": TODAY.isoformat(),
            "target_date": (TODAY + timedelta(days=days)).isoformat()}
    if variety:
        body["variety"] = variety
    return client.post("/api/price-prediction/explain", headers=user["headers"], json=body)


def test_api_explanations_follow_the_policy(client, user, monkeypatch):
    monkeypatch.setattr(freshness, "gate_mode", lambda: "auto")
    for crop, days, expect_ctx in (("Onion", 14, True), ("Wheat", 7, True), ("Wheat", 30, True), ("Cauliflower", 12, False), ("Cabbage", 10, False)):
        r = _explain(client, user, crop, days)
        assert r.status_code == 200, (crop, days, r.text)
        e = r.json()["explanations"][0]["v3"]
        assert bool(e.get("context_only")) is expect_ctx, (crop, days)
        assert e["policy"]["mode"] == ("context_only" if expect_ctx else "model")
        if expect_ctx:
            assert e["headline"]["predicted_price"] is None and all(c["inr_effect"] is None for c in e["cards"])
