"""Unit tests for the candidate explanation rules (pure functions; no models or data files)."""
import math

import numpy as np

from app.ml.price_v2.explain_v2 import explain_forecast, reading
from app.ml.price_v2.features_v2 import V2_FEATURES

REL = {"n": 500, "mae": 120.0, "wape_pct": 9.0, "dir_acc_clear_pct": 64.0, "clear_rate_pct": 40.0,
       "skill_vs_no_change_pct": 4.0}


def _run(shap_vals, base=0.0, w=1.0, terr=0.05, values=None, **kw):
    s = np.zeros(len(V2_FEATURES))
    for k, v in shap_vals.items():
        s[V2_FEATURES.index(k)] = v
    vals = {"arr_vs_month_prior": math.log(0.72), "lag_30_change": -0.1, "lag_90_change": -0.2,
            "state_price_gap": 0.05, "market_premium_30d": 0.04, "yoy_gap": 0.1, "season_change": 0.06}
    vals.update(values or {})
    return explain_forecast(s, base, V2_FEATURES, vals, crop="Tomato", horizon=14, start_price=1000.0,
                            origin_date="2025-10-03", shrink_w=w, typical_error_log=terr, reliability=REL, **kw)


def test_rise_with_supply_evidence():
    e = _run({"arr_vs_month_prior": 0.12, "season_change": 0.05, "lag_30_change": 0.02})
    assert e["direction"] == "rise" and e["predicted_change_pct"] > 5
    sup = next(g for g in e["groups"] if g["group"] == "supply")
    assert "28% below the usual October level" in sup["evidence"]
    assert sup["evidence_vs_push"] == "agrees" and sup["pushed"] == "higher"


def test_small_change_is_no_clear_direction():
    e = _run({"season_change": 0.01}, terr=0.08)
    assert e["direction"] == "no_clear_direction" and "smaller than the typical error" in e["why_no_direction"]
    assert "No clear direction" in e["headline"]


def test_zero_shrink_weight_claims_no_direction():
    e = _run({"season_change": 0.3}, w=0.0)
    assert e["direction"] == "no_clear_direction" and e["predicted_change_pct"] == 0.0


def test_shares_sum_to_100_and_confidence_present():
    e = _run({"arr_vs_month_prior": 0.1, "yoy_gap": -0.05, "log_price": 0.04})
    assert abs(sum(g["share_pct"] for g in e["groups"]) - 100) < 0.5
    assert "₹120" in e["confidence"]["text"] and "64%" in e["confidence"]["text"]


def test_missing_evidence_is_not_invented_and_projection_is_labelled():
    e = _run({"arr_vs_month_prior": 0.1}, values={"arr_vs_month_prior": None}, projected=True)
    sup = next(g for g in e["groups"] if g["group"] == "supply")
    assert sup["evidence"] is None and not sup["evidence_available"]
    other = next(g for g in e["groups"] if g["group"] == "last_year")
    assert other["evidence"].startswith("Based on the same date last year")
    assert any("seasonal-scenario" in n for n in e["notes"])


def test_reading_directions():
    assert reading("supply", {"arr_vs_month_prior": 0.3}) == "down"
    assert reading("supply", {"arr_vs_month_prior": 0.01}) is None
    assert reading("recent_trend", {"lag_30_change": -0.2}) == "down"
