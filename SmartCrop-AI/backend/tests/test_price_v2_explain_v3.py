"""Unit tests for explain_v3: every proposed Phase B explanation rule (pure functions, no models or data)."""
import math
import re

import numpy as np

from app.ml.price_v2.explain_v3 import explain_forecast_v3
from app.ml.price_v2.features_v2 import V2_FEATURES

REL = {"n": 2400, "mae": 120.0, "wape_pct": 9.0, "skill_vs_no_change_pct": 4.0, "n_clear": 400, "n_clear_correct": 320}
VALS = {"arr_vs_month_prior": math.log(0.72), "lag_30_change": -0.1, "lag_90_change": -0.2, "state_price_gap": math.log(1.5),
        "market_premium_30d": 0.04, "yoy_gap": math.log(3.33), "season_change": 0.06, "volatility_30": 0.03, "spread_ratio": 0.2}


def run(shap_vals, base=0.0, w=1.0, terr=0.05, values=None, reliability=REL, **kw):
    s = np.zeros(len(V2_FEATURES))
    for k, v in shap_vals.items():
        s[V2_FEATURES.index(k)] = v
    vals = {**VALS, **(values or {})}
    return explain_forecast_v3(s, base, V2_FEATURES, vals, crop="Tomato", horizon=14, start_price=1000.0,
                               origin_date="2025-10-03", shrink_w=w, typical_error_log=terr, reliability=reliability, **kw)


def rec(e, group):
    return next((r for r in e["records_show"] if r["group"] == group), None)


def push(e, group):
    return next(p for p in e["what_moved_forecast"] if p["group"] == group)


def test_large_evidence_is_never_labelled_weak():
    e = run({"yoy_gap": -0.1, "state_price_gap": -0.05})
    assert "233% above the same date last year" in rec(e, "last_year")["text"]
    assert "50% above the Maharashtra median" in rec(e, "market_premium")["text"]
    assert push(e, "last_year")["relation"] == "no_simple_reading"
    assert push(e, "market_premium")["relation"] == "no_simple_reading"
    assert "too weak" not in e["farmer_text"]


def test_evidence_and_model_push_are_separate_and_disagreement_is_stated():
    e = run({"season_change": -0.08, "arr_vs_month_prior": -0.03, "lag_30_change": 0.02})   # earlier years rose, model pushes lower
    assert push(e, "seasonal")["relation"] == "opposite"
    assert any("earlier years Tomato prices rose" in d and "lower" in d for d in e["disagreements"])
    assert all("The reason is not visible" in d for d in e["disagreements"])
    assert "seasonal" in [r["group"] for r in e["records_show"]]


def test_other_factors_are_split_and_not_given_invented_reasons():
    e = run({"log_price": 0.05, "commodity_code": 0.04, "horizon_days": -0.02, "volatility_30": 0.03, "day_of_week": 0.01})
    titles = {p["title"] for p in e["what_moved_forecast"]}
    assert {"Current price level", "Recent price swings", "How many days ahead the date is"} <= titles
    assert "Other model factors" not in titles
    note = push(e, "other:additional")["note"]
    assert "cannot be explained reliably" in note
    swing = rec(e, "other:price_swings")["text"]
    assert "3.0%" in swing and "22%" in swing


def test_confidence_always_carries_case_counts():
    e = run({"season_change": 0.1})
    text = " ".join(e["reliability_lines"])
    assert "2,400" in text and "320 of 400" in text and "80%" in text


def test_accuracy_percentage_not_quoted_for_few_clear_forecasts():
    e = run({"season_change": 0.1}, reliability={**REL, "n_clear": 12, "n_clear_correct": 12})
    text = " ".join(e["reliability_lines"])
    assert "only 12" in text and "too few" in text and "100%" not in text
    assert e["reliability_counts"]["direction_accuracy_quoted"] is False


def test_few_backtest_cases_flagged():
    e = run({"season_change": 0.1}, reliability={**REL, "n": 80})
    assert "few cases" in " ".join(e["reliability_lines"])


def test_no_clear_direction_when_change_below_typical_error():
    e = run({"season_change": 0.01}, terr=0.08)
    assert e["direction"] == "no_clear_direction" and "No clear direction" in e["headline"]
    assert "small compared with the model's usual prediction error" in e["why_no_direction"]
    assert "rise" not in e["headline"] and "fall" not in e["headline"]


def test_zero_shrink_weight_claims_no_direction():
    e = run({"season_change": 0.3}, w=0.0)
    assert e["direction"] == "no_clear_direction" and e["predicted_change_pct"] == 0.0


def test_range_shown_only_when_coverage_verified():
    rng = (800.0, 1300.0)
    assert run({"season_change": 0.1}, price_range=rng)["price_range"] is None
    assert run({"season_change": 0.1}, price_range=rng, range_coverage={"coverage_pct": 60.0, "n": 5000})["price_range"] is None
    assert run({"season_change": 0.1}, price_range=rng, range_coverage={"coverage_pct": 80.0, "n": 50})["price_range"] is None
    ok = run({"season_change": 0.1}, price_range=rng, range_coverage={"coverage_pct": 80.0, "n": 5000})
    assert ok["price_range"] == [800.0, 1300.0] and "80% of 5,000" in " ".join(ok["reliability_lines"])


def test_missing_evidence_is_reported_unavailable_not_invented():
    e = run({"arr_vs_month_prior": 0.1}, values={"arr_vs_month_prior": None, "yoy_gap": None})
    assert "Not available" in rec(e, "supply")["text"] and "Not available" in rec(e, "last_year")["text"]


def test_projection_is_labelled_and_text_has_no_jargon():
    e = run({"season_change": 0.1}, projected=True)
    assert rec(e, "last_year")["text"].startswith("Same date last year:")
    assert "seasonal scenario" in " ".join(e["reliability_lines"])
    assert not re.search(r"SHAP|log-return|encoding|contribution", e["farmer_text"], re.I)


def test_shares_sum_to_100():
    e = run({"season_change": 0.1, "log_price": 0.05, "yoy_gap": -0.02})
    assert abs(sum(p["share_pct"] for p in e["what_moved_forecast"]) - 100) < 0.5
