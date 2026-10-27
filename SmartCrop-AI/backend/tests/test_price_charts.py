import math

import numpy as np

from app.ml.explainability.price_charts import build_charts, global_importance, local_waterfall
from app.ml.explainability.price_explainer import FACTOR_GROUPS

FEATURES = [f for g, fs in FACTOR_GROUPS.items() if g != "weather" for f in fs]


def _shap(seed=0):
    return np.random.default_rng(seed).normal(0, 0.02, len(FEATURES))


def test_waterfall_adds_up_to_the_model_output():
    sv, base, start = _shap(), 0.011, 1400.0
    final = start * math.exp(base + sv.sum())
    w = local_waterfall(sv, base, FEATURES, start, final)
    assert w["matches_forecast"] and abs(w["end_price"] - final) < 0.01
    assert abs(w["baseline_price"] + sum(s["inr"] for s in w["steps"]) - w["end_price"]) < 0.05
    assert abs(w["baseline_price"] - start * math.exp(base)) < 0.01
    mags = [abs(s["log_contribution"]) for s in w["steps"]]
    assert mags == sorted(mags, reverse=True)
    assert all(s["direction"] == ("up" if s["log_contribution"] >= 0 else "down") for s in w["steps"])


def test_waterfall_refuses_when_it_would_not_match_or_inputs_are_ungrouped():
    sv = _shap()
    assert not local_waterfall(sv, 0.0, FEATURES, 1000.0, 5000.0)["matches_forecast"]
    assert local_waterfall(np.append(sv, 0.1), 0.0, FEATURES + ["mystery"], 1000.0, 1000.0) is None
    assert local_waterfall(sv, 0.0, FEATURES, 0.0, 10.0) is None


def test_global_importance_shares_sum_to_100_and_ignore_weather():
    imp = {f: 0.01 for f in FEATURES} | {"temp_mean_7": 9.0}
    g = global_importance(imp)
    assert abs(sum(r["share_pct"] for r in g["groups"]) - 100) < 0.5
    assert "weather" not in {r["group"] for r in g["groups"]}
    assert global_importance(None) is None and global_importance({}) is None
    assert build_charts(_shap(), 0.0, FEATURES, 100.0, 100.0, None)["global"] is None


def test_rupee_shares_keep_their_shap_sign_and_do_not_depend_on_order():
    sv, base, start = _shap(3), 0.011, 1400.0
    w = local_waterfall(sv, base, FEATURES, start, start * math.exp(base + sv.sum()))
    assert all((s["inr"] >= 0) == (s["log_contribution"] >= 0) for s in w["steps"])
    shuffled = local_waterfall(sv[::-1].copy(), base, FEATURES[::-1], start, start * math.exp(base + sv.sum()))
    a = {s["group"]: s["inr"] for s in w["steps"]}
    b = {s["group"]: s["inr"] for s in shuffled["steps"]}
    assert a == b


def test_nearly_zero_total_does_not_blow_up():
    sv = np.zeros(len(FEATURES)); sv[0], sv[1] = 0.02, -0.02
    w = local_waterfall(sv, 0.0, FEATURES, 1000.0, 1000.0)
    assert w["matches_forecast"] and all(abs(s["inr"]) < 100 for s in w["steps"])
