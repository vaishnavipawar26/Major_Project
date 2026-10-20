"""Explanation-quality tests for the price explainer (unit tests on synthetic inputs, no model)."""
import math
import re

import numpy as np
import pytest

from app.ml.explainability.price_explainer import (FACTOR_GROUPS, WEATHER_FEATURES, explain_price,
                                                   strength_of)
from app.ml.price_prediction.features import MODEL_FEATURES

FORBIDDEN = re.compile(r"shap|log-ratio|log ratio|feature vector|tree|log\(", re.I)

X = {f: 0.0 for f in MODEL_FEATURES}
X.update({"lag_7_change": math.log(0.90), "lag_30_change": math.log(0.80),
          "roll_mean_7_gap": math.log(0.95), "roll_mean_30_gap": math.log(0.88),
          "volatility_30": 0.035, "spread_ratio": 0.4, "state_change_7": math.log(0.97),
          "state_price_gap": 0.0, "arrivals_vs_30d": 0.2, "horizon_days": 14.0})
CTX = {"price_7d_avg": 1800.0, "price_prev_7d_avg": 2000.0, "arrivals_latest": 150.0,
       "arrivals_30d_mean": 100.0, "year_median_price": 2100.0, "price_ref": 1900.0,
       "series_is_state": True, "seasonal": {"ratio": 1.06, "years": 2},
       "reliability": {"model_mae": 300.0, "baseline_mae": 320.0, "validated": True}}


def shap_vector(**by_feature):
    """Contribution vector over MODEL_FEATURES with the given per-feature values."""
    v = np.zeros(len(MODEL_FEATURES))
    for k, val in by_feature.items():
        v[MODEL_FEATURES.index(k)] = val
    return v


def run(shap=None, base=0.01, x=None, ctx=None, names=None, **kw):
    shap = shap if shap is not None else shap_vector(
        lag_7_change=-0.04, roll_mean_7_gap=-0.02, arrivals_vs_30d=-0.05, doy_sin=0.03,
        volatility_30=0.012, log_price=-0.01)
    return explain_price(shap, base, x or X, names or MODEL_FEATURES, 10, 1900.0, "Brinjal",
                         horizon=14, target_month=11, context=CTX if ctx is None else ctx, **kw)


def test_contributions_reconstruct_model_output_and_forecast_pct():
    e = run()
    total = sum(f["shap_value"] for f in e["factors"])
    # base + all contributions == model output (factor values are rounded to 5 decimals)
    assert abs(e["base_value"] + total - e["technical"]["model_output_log"]) < 1e-3
    assert e["prediction_change_pct"] == pytest.approx(
        (math.exp(e["base_value"] + sum(e["technical"]["features"].values())) - 1) * 100, abs=0.01)
    assert e["summary"]["change_pct"] == e["prediction_change_pct"]


def test_overall_change_is_not_the_sum_of_individual_percentages():
    e = run(shap=shap_vector(lag_7_change=-0.2, doy_sin=-0.2, log_price=-0.2), base=0.0)
    naive_sum = sum((math.exp(f["shap_value"]) - 1) * 100 for f in e["factors"])
    assert abs(e["prediction_change_pct"] - naive_sum) > 1.0   # they genuinely differ
    assert e["prediction_change_pct"] == pytest.approx((math.exp(-0.6) - 1) * 100, abs=0.01)
    assert all("effect_pct" not in f for f in e["factors"])


def test_direction_matches_contribution_sign():
    e = run()
    for f in e["factors"]:
        assert f["direction"] == ("up" if f["shap_value"] > 0 else "down")
        if f["strength"] != "small":
            assert f["impact"] == ("higher" if f["shap_value"] > 0 else "lower")
            assert ("higher" if f["direction"] == "up" else "lower") in f["model_says"]


def test_evidence_values_come_from_the_supplied_inputs():
    e = run()
    f = {x["factor"]: x for x in e["factors"]}
    rw = f["recent_week"]["evidence"][0]
    assert rw["value"] == pytest.approx(1800.0) and rw["reference_value"] == pytest.approx(2000.0)
    assert rw["change_pct"] == pytest.approx(-10.0)
    assert "10.0% below" in f["recent_week"]["observation"]
    ar = f["arrivals"]["evidence"][0]
    assert ar["value"] == 150.0 and ar["change_pct"] == pytest.approx(50.0)
    mo = f["recent_month"]["evidence"][0]
    assert mo["change_pct"] == pytest.approx(-20.0)
    assert f["volatility"]["evidence"][0]["value"] == pytest.approx(3.5)


def test_missing_inputs_do_not_create_evidence_or_explanations():
    x = dict(X, lag_7_change=float("nan"), lag_30_change=None)
    e = run(x=x, ctx={})
    by = {f["factor"]: f for f in e["factors"]}
    assert by["recent_month"]["evidence_available"] is False and by["recent_month"]["observation"] == ""
    assert by["arrivals"]["evidence_available"] is False        # no raw arrivals in the context
    assert by["season"]["evidence_available"] is False          # no earlier-year comparison
    text = " ".join(e["farmer_explanation"]).lower()
    assert "arrivals" not in text and "month" not in text.replace("november", "").replace("october", "")
    assert e["data_completeness"]["inputs_missing"] >= 2


def test_weather_never_explained_when_model_has_no_weather_inputs():
    e = run()
    assert e["weather"] == {"status": "not_used", "used": False}
    assert all(f["factor"] != "weather" for f in e["factors"])
    assert "weather" not in " ".join(e["farmer_explanation"]).lower()


def test_weather_explained_only_when_values_exist():
    names = MODEL_FEATURES + WEATHER_FEATURES
    wx = dict(X, temp_mean_7=31.2, temp_anom_7=2.4, precip_sum_7=0.0, precip_sum_30=12.0,
              precip_ratio_30=0.25, humidity_mean_7=40.0)
    shap = np.zeros(len(names))
    shap[names.index("precip_ratio_30")] = 0.05
    e = explain_price(shap, 0.0, wx, names, 10, 1900.0, "Brinjal", horizon=14, target_month=11,
                      context=CTX, weather_status="used")
    w = next(f for f in e["factors"] if f["factor"] == "weather")
    assert w["evidence_available"] and "not a weather forecast" in w["observation"]
    assert "2.4" in w["observation"] and "warmer" in w["observation"]
    assert "not proven" in w["meaning"] or "indirect" in w["meaning"]
    # same model, weather missing for this market -> no weather factor at all
    nan = dict(wx, temp_mean_7=float("nan"))
    e2 = explain_price(shap, 0.0, nan, names, 10, 1900.0, "Brinjal", horizon=14, target_month=11,
                       context=CTX, weather_status="unavailable")
    assert all(f["factor"] != "weather" for f in e2["factors"])
    assert any("Weather information was not available" in s for s in e2["data_limitations"])


def test_seasonal_text_uses_origin_and_target_months():
    e = run(shap=shap_vector(doy_sin=0.05, target_doy_sin=0.02))
    s = next(f for f in e["factors"] if f["factor"] == "season")
    assert "(October to November)" in s["observation"]
    assert "2 earlier years" in s["observation"]
    assert "weak guide" in s["meaning"]          # only two earlier years


def test_volatility_is_not_described_as_a_trend():
    e = run(shap=shap_vector(volatility_30=-0.06))
    v = next(f for f in e["factors"] if f["factor"] == "volatility")
    assert v["strength"] != "small" and v["evidence_trend"] is None
    blob = (v["observation"] + v["meaning"]).lower()
    assert "do not say whether prices will rise or fall" in blob
    assert not re.search(r"upward|downward|rising|falling|trend", blob)


def test_farmer_text_has_no_technical_terms_and_three_sentences():
    e = run()
    assert len(e["farmer_explanation"]) == 3
    for s in e["farmer_explanation"]:
        assert not FORBIDDEN.search(s), s
    for f in e["factors"]:
        assert not FORBIDDEN.search(f["sentence"])
    assert "shap" in e["method"].lower()           # technical details live elsewhere
    assert "adds up" in e["technical"]["note"] or "add up" in e["technical"]["note"]


def test_strength_is_calibrated_and_separate_from_reliability_and_range():
    cal = {"groups": {"season": {"p50": 0.01, "p85": 0.05}}}
    assert strength_of(0.003, "season", cal) == "small"      # below the negligible floor
    assert strength_of(0.02, "season", cal) == "moderate"
    assert strength_of(0.06, "season", cal) == "strong"
    e = run(calibration=cal, target_point={"predicted_price": 1850.0, "lower": 1500.0,
                                           "upper": 2300.0, "stable_band_pct": 8.0})
    assert e["strength_basis"] == "calibrated on held-out forecasts"
    assert e["reliability"]["model_mae"] == 300.0 and e["price_range"]["lower"] == 1500.0
    assert "not derived from the factors" in e["price_range"]["basis"]
    assert set(e) >= {"reliability", "price_range", "data_completeness", "factors"}


def test_summary_headline_and_typical_error_note():
    e = run(target_point={"predicted_price": 1850.0, "lower": 1500.0, "upper": 2300.0,
                          "stable_band_pct": 30.0})
    assert e["summary"]["direction"] in ("lower", "higher", "about the same")
    assert e["summary"]["headline"].startswith("Why")
    assert e["summary"]["within_typical_error"] is True
    assert any("typical error" in s for s in e["data_limitations"])


def test_every_group_feature_exists_in_model_features_or_weather():
    known = set(MODEL_FEATURES) | set(WEATHER_FEATURES)
    for g, feats in FACTOR_GROUPS.items():
        assert set(feats) <= known, g


def test_reconstruction_check_and_reliability_sample_size():
    shap = shap_vector(lag_7_change=-0.04, doy_sin=0.03)
    ok = run(shap=shap, base=0.01, model_output=0.0, n_tests=500)
    assert ok["technical"]["reconstruction_ok"] is True
    assert ok["reliability"]["sufficient_data"] is True and ok["reliability"]["n_tests"] == 500
    bad = run(shap=shap, base=0.01, model_output=0.2, n_tests=20)
    assert bad["technical"]["reconstruction_ok"] is False
    assert bad["reliability"]["sufficient_data"] is False
    assert any("Not enough historical test results" in s for s in bad["data_limitations"])
    assert run()["technical"]["reconstruction_ok"] is None   # nothing to check against: not claimed
    assert set(ok["technical"]["grouped"]) >= {"recent_week", "season"}


def test_main_factors_are_the_top_three_by_shap_with_evidence():
    e = run()
    by_abs = [f["factor"] for f in e["factors"] if f["evidence_available"] and f["factor"] != "crop_market"]
    assert e["main_factors"] == by_abs[:3]
    assert len(e["main_factors"]) <= 3
    sizes = [abs(next(f for f in e["factors"] if f["factor"] == k)["shap_value"]) for k in e["main_factors"]]
    assert sizes == sorted(sizes, reverse=True)


def test_main_factors_skip_factors_without_evidence():
    e = run(ctx={})   # no market statistics at all: nothing may be described from thin air
    for k in e["main_factors"]:
        assert next(f for f in e["factors"] if f["factor"] == k)["evidence_available"]


def test_projected_flag_is_passed_through():
    assert run(projected=True)["projected"] is True
    assert run()["projected"] is False


def test_one_earlier_year_is_called_limited_evidence():
    one = {**CTX, "seasonal": {"ratio": 1.1, "years": 1}}
    s = next(f for f in run(ctx=one)["factors"] if f["factor"] == "season")
    assert "limited" in s["observation"]
    two = {**CTX, "seasonal": {"ratio": 1.1, "years": 2}}
    assert "limited" not in next(f for f in run(ctx=two)["factors"] if f["factor"] == "season")["observation"]


def test_farmer_effect_has_no_technical_words_and_matches_direction():
    for f in run()["factors"]:
        assert f["farmer_effect"].endswith("higher." if f["direction"] == "up" else "lower.")
        assert not any(w in f["farmer_effect"].lower() for w in ("shap", "log", "moderate", "strong", "contribution"))


def test_net_summary_uses_signed_totals_and_agrees_with_the_forecast():
    # two upward factors outweigh one downward factor and the forecast rises
    e = run(shap=shap_vector(doy_sin=0.08, roll_mean_30_gap=0.05, log_price=-0.03), base=0.0)
    n = e["net_summary"]
    assert n["code"] == "outweigh" and n["forecast_side"] == "up"
    assert n["up_total"] > n["down_total"]
    # the shown factors pull up, but the forecast falls because of the base value / other features: not "explained"
    e2 = run(shap=shap_vector(doy_sin=0.02, roll_mean_30_gap=0.02, log_price=-0.01), base=-0.2)
    assert e2["net_summary"]["code"] in ("mixed", "agree") and e2["net_summary"]["forecast_side"] == "down"
    assert e2["net_summary"]["code"] == "mixed"


def test_averages_evidence_gives_real_prices_only_for_observed_starts():
    x = {**X, "roll_mean_7_gap": math.log(1900 / 2000), "roll_mean_30_gap": math.log(1900 / 2100)}
    f = next(f for f in run(shap=shap_vector(roll_mean_7_gap=0.03), x=x)["factors"] if f["factor"] == "averages")
    assert "₹2,000" in f["observation"] and "₹2,100" in f["observation"]
    p = next(f for f in run(shap=shap_vector(roll_mean_7_gap=0.03), x=x, projected=True)["factors"] if f["factor"] == "averages")
    assert "₹2,000" not in p["observation"]


def _reasons(shap, ctx=None, **kw):
    return run(shap=shap, ctx=ctx, **kw)["reasons"]


def test_reasons_are_market_categories_with_evidence_and_at_most_three():
    r = _reasons(shap_vector(lag_7_change=-0.04, roll_mean_7_gap=-0.02, arrivals_vs_30d=-0.05, doy_sin=0.03,
                             volatility_30=0.02, horizon_days=0.2, log_price=-0.01))
    ids = [x["id"] for x in r]
    assert len(r) <= 3 and "distance" not in ids and "volatility" not in ids
    assert [abs(x["shap_value"]) for x in r] == sorted((abs(x["shap_value"]) for x in r), reverse=True)
    for x in r:
        assert x["evidence"] and x["meaning"] and x["direction"] in ("up", "down")


def test_recent_week_and_month_become_one_reason_with_summed_contribution():
    e = run(shap=shap_vector(lag_7_change=-0.03, lag_30_change=-0.02))
    rec = [x for x in e["reasons"] if x["id"] == "recent_week"]
    assert len(rec) == 1 and rec[0]["shap_value"] == pytest.approx(-0.05, abs=1e-4)
    assert rec[0]["direction"] == "down"


def test_arrivals_reason_only_with_real_arrival_evidence():
    shap = shap_vector(arrivals_vs_30d=-0.06, log_arrivals=-0.03)
    assert "arrivals" in [x["id"] for x in _reasons(shap)]
    no_arr = {k: v for k, v in CTX.items() if not k.startswith("arrivals")}
    assert "arrivals" not in [x["id"] for x in _reasons(shap, ctx=no_arr)]


def test_arrivals_week_over_week_uses_the_recorded_quantities_and_date():
    ctx = {**CTX, "arrivals_7d_mean": 1200.0, "arrivals_prev_7d_mean": 1000.0, "arrivals_asof": "2025-12-10"}
    a = next(x for x in _reasons(shap_vector(arrivals_vs_30d=-0.06), ctx=ctx) if x["id"] == "arrivals")
    assert "1,200 a day in the 7 days to 10 December" in a["evidence"] and "20% above" in a["evidence"]
    assert "Higher arrivals can put downward pressure" in a["meaning"]
    assert "demand" in a["meaning"] and "is low" not in a["meaning"]   # no demand measurement exists: qualified wording only


def test_arrivals_push_against_the_supply_logic_is_called_out():
    ctx = {**CTX, "arrivals_7d_mean": 1200.0, "arrivals_prev_7d_mean": 1000.0, "arrivals_asof": "2025-12-10"}
    a = next(x for x in _reasons(shap_vector(arrivals_vs_30d=0.06), ctx=ctx) if x["id"] == "arrivals")
    assert "outweighed this" in a["meaning"]


def test_seasonal_reason_is_limited_when_years_are_few_or_inconsistent():
    for sea in ({"ratio": 1.1, "years": 1, "ratios": [1.1]}, {"ratio": 1.02, "years": 3, "ratios": [1.2, 0.9, 1.02]}):
        r = next(x for x in _reasons(shap_vector(doy_sin=0.06), ctx={**CTX, "seasonal": sea}) if x["id"] == "season")
        assert r["limited"] and "weak guidance" in r["meaning"]
    ok = next(x for x in _reasons(shap_vector(doy_sin=0.06), ctx={**CTX, "seasonal": {"ratio": 1.1, "years": 3, "ratios": [1.1, 1.2, 1.05]}}) if x["id"] == "season")
    assert not ok["limited"] and "3 of 3 years" in ok["evidence"]


def test_what_it_means_is_built_from_the_reasons_and_never_names_arrivals_without_evidence():
    e = run(shap=shap_vector(lag_7_change=-0.06, doy_sin=-0.05, log_price=0.01), base=0.0)
    assert e["what_it_means"].startswith("The forecast is lower mainly because of")
    assert "arrivals" not in e["what_it_means"].lower()
    assert e["what_it_means"].endswith("if supply or demand change.")
    flat = run(shap=shap_vector(lag_7_change=0.001), base=0.0)
    assert "little change" in flat["what_it_means"] or flat["what_it_means"] is None


def test_data_basis_and_scope_are_stated():
    e = run(projected=True, ctx={**CTX, "data_end": "2025-12-31"})
    assert "historical prices up to 2025-12-31" in e["data_basis"]["text"] and "No live market feed" in e["data_basis"]["text"]
    assert e["scope"]["kind"] == "state" and "median" in e["scope"]["text"]
    m = run(ctx={**CTX, "series_is_state": False})
    assert m["scope"]["kind"] == "market"
