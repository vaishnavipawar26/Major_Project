"""Tests for the evidence-first explanation (price_explainer_v3) and the freshness gate.

Pure tests need no models. Integration tests use the real forecaster through the API.
"""
import math
import re
from datetime import date, timedelta

import pandas as pd
import pytest

from app.ml.explainability import price_explainer_v3 as v3x
from app.ml.price_prediction import freshness
from app.ml.price_prediction.features import STATE_MARKET, STATE_VARIETY
from app.services import price_service

FEATURES = ["log_price", "lag_30_change", "lag_7_change", "log_arrivals", "arrivals_vs_30d", "state_price_gap", "market_code",
            "month", "doy_sin", "volatility_30", "horizon_days", "commodity_code", "day_of_week", "week_of_year"]
CONTRIB = {"log_price": 0.01, "lag_30_change": -0.03, "lag_7_change": 0.005, "log_arrivals": -0.02, "arrivals_vs_30d": -0.01,
           "state_price_gap": 0.012, "market_code": 0.004, "month": 0.006, "doy_sin": -0.002, "volatility_30": 0.001,
           "horizon_days": -0.004, "commodity_code": 0.002, "day_of_week": 0.001, "week_of_year": -0.001}
FACTS = {
    "supply": {"start": date(2025, 9, 24), "end": date(2025, 10, 23), "mean": 412.0, "n_days": 25, "month": 10, "usual": 305.0,
               "usual_years": [2023, 2024], "pct": 35.1},
    "market": {"start": date(2025, 7, 27), "end": date(2025, 10, 23), "n_days": 71, "market_avg": 2096.0, "state_avg": 1637.0, "avg_gap_pct": 28.0},
    "seasonal": {"years": [{"year": 2024, "from": date(2024, 10, 23), "to": date(2024, 11, 4), "pct": 6.0},
                           {"year": 2023, "from": date(2023, 10, 23), "to": date(2023, 11, 4), "pct": 3.0}], "mean_pct": 4.5},
    "trend": {"date": date(2025, 10, 23), "price": 2000.0, "d30": {"date": date(2025, 9, 23), "price": 1500.0, "pct": 33.0},
              "d90": {"date": date(2025, 7, 25), "price": 3000.0, "pct": -33.0}},
    "last_year": {"date": date(2025, 10, 23), "price": 2000.0, "prev_date": date(2024, 10, 23), "prev_price": 2700.0, "pct": -26.0},
    "swings": {"date": date(2025, 10, 23), "daily_pct": 3.1},
}
CELL = {"n": 4200, "mae": 300.0, "wape_pct": 12.0, "baseline": "starting price", "baseline_mae": 340.0, "beats_baseline": True,
        "direction_acc_pct": 61.0, "n_meaningful_moves": 900, "up_share_of_moves_pct": 35.0, "range_coverage_pct": 46.0,
        "range_mean_width_pct_of_start": 70.0}


def build(contrib=CONTRIB, base=0.01, start=2400.0, cell=CELL, facts=FACTS, projected=True, **kw):
    L = base + sum(contrib.values())
    pred = start * math.exp(L)
    args = dict(contrib=contrib, base_value=base, values={}, model_features=set(FEATURES), facts=facts, crop="Tomato",
                market="APMC Pune", requested_market=None, series_is_state=False, horizon=12, start_price=start, predicted_price=pred,
                lower=pred * 0.7, upper=pred * 1.3, target_date=date(2026, 11, 4), projected=projected, forecast_date=date(2026, 10, 23),
                ref_origin_date=date(2025, 10, 23), inflation_pct=5.0, reliability_cell=cell, reliability_scope="projection",
                fallback_mae=None, fallback_beats=None, breakdown={"state_price": pred - 400}, model_output_log=L)
    args.update(kw)
    return v3x.build_v3(**args), pred


# ------------------------------------------------------------------ ₹ allocation
def test_inr_effects_sum_exactly_to_the_predicted_change():
    for base, scale in ((0.01, 1.0), (-0.2, 3.0), (0.0, 0.0), (0.5, 2.0)):
        contrib = {k: v * scale for k, v in CONTRIB.items()}
        a = v3x.allocate_inr(contrib, base, 2400.0)
        assert abs(sum(a["per_feature"].values()) + a["base_inr"] - a["change_inr"]) < 1e-6


def test_cards_plus_other_factors_add_up_to_the_change():
    out, pred = build()
    assert abs(out["checks"]["inr_sum"] - out["checks"]["predicted_change_inr"]) < 0.05
    assert abs(out["checks"]["predicted_change_inr"] - (pred - 2400.0)) < 0.05
    assert out["checks"]["reconstruction_error"] < 1e-9


def test_other_factors_always_reported_with_its_share_even_when_cards_fill_up():
    out, _ = build()
    assert out["other_factors"]["text"].startswith("Other factors:")
    assert len(out["cards"]) <= 4
    assert any("baseline" in p["label"] for p in out["other_factors"]["parts"])


def test_cards_are_sorted_by_rupee_size_and_groups_use_the_documented_features():
    out, _ = build()
    sizes = [abs(c["inr_effect"]) for c in out["cards"]]
    assert sizes == sorted(sizes, reverse=True)
    assert v3x.group_of("day_of_week") == "other" and v3x.group_of("week_of_year") == "other"   # calendar noise is not "seasonal"
    assert v3x.group_of("market_code") == "market" and v3x.group_of("state_price_gap") == "market"
    assert v3x.group_of("yoy_gap") == "last_year" and v3x.group_of("doy_cos") == "seasonal"


# ------------------------------------------------------------------ dated, grounded evidence
def test_no_undated_evidence_and_no_same_time_last_year():
    out, _ = build()
    for c in out["cards"]:
        assert c["evidence_available"]
        assert re.search(r"\b20\d\d\b", c["evidence"]), c["evidence"]
    for u in out["evidence_not_used_by_model"]:
        assert re.search(r"\b20\d\d\b", u["evidence"])
    assert "Same time last year" not in str(out)
    assert re.search(r"\b20\d\d\b", out["market_breakdown"]["evidence"])


def test_banner_names_the_real_years_and_dates_the_starting_price():
    out, _ = build()
    assert out["banner"]["text"] == "No 2026 market data yet — this forecast replays the same season of 2025."
    assert "23 Oct 2025" in out["banner"]["detail"] and "5%" in out["banner"]["detail"]
    out2, _ = build(projected=False, reliability_scope="real_origin")
    assert out2["banner"] is None


def test_no_invented_real_world_causes():
    out, _ = build()
    text = str(out).lower()
    for word in ("festival", "transport", "demand", "monsoon", "rainfall", "strike", "export"):
        assert word not in text, word


def test_mechanism_only_when_the_evidence_supports_it():
    out, _ = build()
    supply = next(c for c in out["cards"] if c["group"] == "supply")
    assert supply["mechanism"] == "More supply usually lowers prices."
    weak = {**FACTS, "supply": {**FACTS["supply"], "pct": 4.0, "mean": 317.0}}
    out2, _ = build(facts=weak)
    assert next(c for c in out2["cards"] if c["group"] == "supply")["mechanism"] is None
    low = {**FACTS, "supply": {**FACTS["supply"], "pct": -30.0, "mean": 213.0}}
    assert next(c for c in build(facts=low)[0]["cards"] if c["group"] == "supply")["mechanism"] == "Less supply usually supports prices."
    gone = {k: v for k, v in FACTS.items() if k != "supply"}
    s = next(c for c in build(facts=gone)[0]["cards"] if c["group"] == "supply")
    assert s["mechanism"] is None and not s["evidence_available"] and s["agreement"]["flag"] == "no_evidence"


def test_agreement_flag_compares_records_with_the_models_push():
    out, _ = build()
    supply = next(c for c in out["cards"] if c["group"] == "supply")        # arrivals above usual -> records say lower; model pushed down
    assert supply["direction"] == "down" and supply["agreement"]["flag"] == "agree"
    trend = next(c for c in out["cards"] if c["group"] == "trend")           # price rose 33% but the model pushed down
    assert trend["direction"] == "down" and trend["agreement"]["flag"] == "disagree"
    assert "The reason is not visible" in trend["agreement"]["text"]
    market = next(c for c in out["cards"] if c["group"] == "market")
    assert market["agreement"]["flag"] == "no_reading"


def test_group_without_model_features_is_listed_as_not_used_not_as_a_reason():
    out, _ = build()
    assert [u["group"] for u in out["evidence_not_used_by_model"]] == ["last_year"]
    assert all(c["group"] != "last_year" for c in out["cards"])


# ------------------------------------------------------------------ headline rules
def test_about_the_same_when_change_is_smaller_than_the_backtest_error():
    small = {k: v * 0.1 for k, v in CONTRIB.items()}
    out, _ = build(contrib=small, base=0.0)
    assert out["headline"]["code"] == "about_the_same" and "About the same" in out["headline"]["text"]
    assert abs(out["headline"]["change_inr"]) < CELL["mae"]


def test_rise_or_fall_only_when_larger_than_error_and_model_beat_the_baseline():
    big = {k: v * 8 for k, v in CONTRIB.items()}
    out, _ = build(contrib=big, base=0.4)
    assert out["headline"]["code"] in ("rise", "fall") and abs(out["headline"]["change_inr"]) >= CELL["mae"]
    out2, _ = build(contrib=big, base=0.4, cell={**CELL, "beats_baseline": False})
    assert out2["headline"]["code"] == "no_clear_direction"
    assert "rise" not in out2["headline"]["text"].split(":")[0]
    out3, _ = build(contrib=big, base=0.4, cell=None)        # no backtest figure: fall back to the supplied MAE / flag
    assert out3["headline"]["code"] == "no_clear_direction"


# ------------------------------------------------------------------ trust block
def test_trust_block_carries_counts_and_warns_about_a_narrow_range():
    out, _ = build()
    t = out["trust"]
    assert t["n"] == 4200 and t["range_coverage_pct"] == 46.0 and t["beats_baseline"] is True
    text = " ".join(t["lines"] + t["warnings"])
    assert "4,200" in text and "900" in text and "46%" in text
    assert any("too narrow" in w for w in t["warnings"])


def test_direction_accuracy_not_quoted_for_few_moves():
    out, _ = build(cell={**CELL, "n_meaningful_moves": 40, "direction_acc_pct": None})
    assert "Too few large price moves" in " ".join(out["trust"]["lines"])


def test_market_breakdown_has_median_price_and_premium():
    out, pred = build()
    m = out["market_breakdown"]
    assert m["applicable"] and abs(m["premium_inr"] - 400) < 0.01 and "premium: +₹400" in m["text"]
    st, _ = build(series_is_state=True, market="All markets (state median)", breakdown=None)
    assert st["market_breakdown"]["applicable"] is False


# ------------------------------------------------------------------ freshness gate (pure)
def test_market_decision_thresholds():
    assert freshness.market_decision(0) == freshness.market_decision(14) == "use_market"
    assert freshness.market_decision(15) == freshness.market_decision(60) == "use_state_median"
    assert freshness.market_decision(61) == "no_recent_data"


def test_gate_modes():
    end = date(2025, 12, 31)
    assert freshness.gate_active("off", end + timedelta(days=5), end) is False
    assert freshness.gate_active("on", end + timedelta(days=500), end) is True
    assert freshness.gate_active("auto", end + timedelta(days=60), end) is True
    assert freshness.gate_active("auto", end + timedelta(days=61), end) is False      # stale data: nothing changes
    assert freshness.gate_mode() in freshness.MODES


# ------------------------------------------------------------------ integration (real forecaster)
STATE = "Maharashtra"
TODAY = date(2026, 10, 23)


@pytest.fixture
def fc(client):
    return client.app.state.registry.price


def post(client, user, as_of, market=STATE_MARKET, crop="Tomato", days=12, path="explain", variety=None):
    body = {"state": STATE, "market": market, "commodity": crop, "as_of": as_of.isoformat(),
            "target_date": (as_of + timedelta(days=days)).isoformat()}
    if variety:
        body["variety"] = variety
    return client.post(f"/api/price-prediction/{path}", headers=user["headers"], json=body)


def test_explain_v3_adds_up_and_is_dated_with_the_real_reference_year(client, user, monkeypatch):
    monkeypatch.setattr(freshness, "gate_mode", lambda: "auto")
    r = post(client, user, TODAY, crop="Cauliflower")           # a crop whose backtests support using the model
    assert r.status_code == 200, r.text
    e = r.json()["explanations"][0]["v3"]
    assert not e.get("context_only")
    assert e["checks"]["reconstruction_error"] < 1e-3
    assert abs(e["checks"]["inr_sum"] - e["checks"]["predicted_change_inr"]) < 0.1
    assert e["banner"]["text"].startswith("No 2026 market data yet")
    for c in e["cards"]:
        if c["evidence_available"]:
            assert re.search(r"\b2025\b|\b2024\b|\b2023\b", c["evidence"]), c["evidence"]
            assert "2026" not in c["evidence"]
    assert e["headline"]["code"] in ("rise", "fall", "about_the_same", "no_clear_direction")


def test_stale_data_keeps_the_year_ago_fallback_when_the_gate_is_auto(client, user, monkeypatch):
    monkeypatch.setattr(freshness, "gate_mode", lambda: "auto")
    b = post(client, user, TODAY, path="trend").json()
    assert b["projection"] is not None and b["dates"]["years_shifted"] == 1 and b["source"]["note"] is None


def test_fresh_data_starts_from_the_latest_real_price_without_projection(client, user, fc, monkeypatch):
    monkeypatch.setattr(freshness, "gate_mode", lambda: "auto")
    b = post(client, user, date(2026, 1, 20), days=15, path="trend").json()      # 20 days after the last record
    assert b["projection"] is None and b["dates"]["years_shifted"] == 0
    assert date.fromisoformat(b["forecast_origin_date"]) <= fc.data_end
    assert b["current_price"] > 0 and b["source"]["note"] is None


def test_gate_off_never_applies(client, user, monkeypatch):
    monkeypatch.setattr(freshness, "gate_mode", lambda: "off")
    b = post(client, user, date(2026, 1, 20), days=15, path="trend").json()
    assert b["dates"]["years_shifted"] == 1


def _market_with_reports(fc, crop="Cauliflower"):
    s = fc.support
    s = s[(s.Commodity == crop) & (s.Market != STATE_MARKET) & (s.observations >= 500)].sort_values("observations", ascending=False)
    for r in s.itertuples():
        ser = fc._series[(STATE, r.Market, crop, r.Variety)]
        if ser.loc[ser["observed"], "Date"].max() >= pd.Timestamp("2025-12-20"):
            return r.Market, r.Variety
    pytest.skip("no market with reports near the end of the data")


def _truncate(fc, monkeypatch, key, last_day):
    s = fc._series[key]
    monkeypatch.setattr(fc, "_series", {**fc._series, key: s[s["Date"] <= pd.Timestamp(last_day)].reset_index(drop=True)})


def test_market_older_than_14_days_uses_the_state_median_and_says_so(client, user, fc, monkeypatch):
    monkeypatch.setattr(freshness, "gate_mode", lambda: "auto")
    m, v = _market_with_reports(fc)
    _truncate(fc, monkeypatch, (STATE, m, "Cauliflower", v), "2025-12-05")        # latest report 26 days before the data end
    r = post(client, user, date(2026, 1, 20), market=m, crop="Cauliflower", days=15, path="trend", variety=v)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["source"]["used_market"] == STATE_MARKET and b["source"]["fallback"] is True
    assert "46 days old" in b["source"]["note"] and "Maharashtra median" in b["source"]["note"]    # 2026-01-20 minus 2025-12-05


def test_market_older_than_60_days_gets_no_forecast(client, user, fc, monkeypatch):
    monkeypatch.setattr(freshness, "gate_mode", lambda: "auto")
    m, v = _market_with_reports(fc)
    _truncate(fc, monkeypatch, (STATE, m, "Cauliflower", v), "2025-09-20")        # 102 days before the data end
    r = post(client, user, date(2026, 1, 20), market=m, crop="Cauliflower", days=15, path="trend", variety=v)
    assert r.status_code == 422 and "No recent data for this market" in r.text


def test_gate_on_with_stale_records_answers_no_recent_data(client, user, monkeypatch):
    monkeypatch.setattr(freshness, "gate_mode", lambda: "on")
    r = post(client, user, TODAY, path="trend")
    assert r.status_code == 422 and "No recent data" in r.text


# ------------------------------------------------------------------ context-only mode (crops whose strategy is no_change)
def test_no_change_crop_says_no_clear_direction_and_shows_dated_context_without_rupee_effects():
    out, _ = build(context_only=True, context_reason="In validation tests the model did not beat keeping the latest price for Tomato, so it is not used to predict a rise or fall.")
    assert out["context_only"] is True
    h = out["headline"]
    assert h["code"] == "no_clear_direction" and h["predicted_price"] is None and h["change_inr"] is None and h["change_pct"] is None
    assert "No clear direction" in h["text"] and "context only" in h["text"]
    assert not re.search(r"\b(rise|fall)\s+by\b", h["text"])
    # the five evidence groups are all present, dated, and carry no model effect
    assert [c["group"] for c in out["cards"]] == ["supply", "market", "trend", "last_year", "seasonal"]
    for c in out["cards"]:
        assert c["inr_effect"] is None and c["direction"] is None and c["mechanism"] is None
        assert c["agreement"]["flag"] == "context"
        assert c["evidence_available"] and re.search(r"\b20\d\d\b", c["evidence"]), c["evidence"]
    assert out["other_factors"] is None and out["evidence_not_used_by_model"] == []
    assert out["checks"]["inr_sum"] is None and out["checks"]["predicted_change_inr"] is None
    assert "₹" not in " ".join(c["effect_text"] for c in out["cards"])          # no rupee effect text on any card


def test_context_only_market_premium_is_a_recorded_price_comparison_not_a_forecast():
    out, _ = build(context_only=True)
    m = out["market_breakdown"]
    assert m["applicable"] and m["context_only"] and "recorded prices, not a forecast" in m["text"]
    assert "premium of +₹459" in m["text"] and re.search(r"\b2025\b", m["text"])


def test_context_only_keeps_banner_trust_and_missing_evidence_is_stated_not_invented():
    gone = {k: v for k, v in FACTS.items() if k not in ("supply", "last_year")}
    out, _ = build(context_only=True, facts=gone)
    assert out["banner"]["text"].startswith("No 2026 market data yet")
    assert out["trust"]["n"] == 4200
    supply = next(c for c in out["cards"] if c["group"] == "supply")
    assert not supply["evidence_available"] and "No arrivals were reported" in supply["evidence"]
    assert "No price record exists for the same date one year earlier" in next(c for c in out["cards"] if c["group"] == "last_year")["evidence"]


def test_normal_mode_unchanged_by_the_context_flag():
    out, _ = build()
    assert out.get("context_only") is None and out["headline"]["predicted_price"] is not None
    assert any(c["inr_effect"] is not None for c in out["cards"])


def test_tomato_is_context_only_through_the_api_with_no_rupee_effects(client, user, fc, monkeypatch):
    monkeypatch.setattr(freshness, "gate_mode", lambda: "auto")
    assert "Tomato" in fc.crop_policy["no_change_crops"], "run scripts/build_reliability_table.py first"
    r = post(client, user, TODAY, crop="Tomato")
    assert r.status_code == 200, r.text
    e = r.json()["explanations"][0]["v3"]
    assert e["context_only"] is True and e["headline"]["code"] == "no_clear_direction"
    assert e["headline"]["predicted_price"] is None and e["other_factors"] is None
    assert all(c["inr_effect"] is None for c in e["cards"])
    assert all(re.search(r"\b20\d\d\b", c["evidence"]) for c in e["cards"] if c["evidence_available"])
    assert e["banner"]["text"].startswith("No 2026 market data yet")


# ------------------------------------------------------------------ range display rule
def test_explanation_range_is_hidden_below_40_percent_coverage_and_otherwise_carries_its_coverage():
    shown, _ = build()                                                       # coverage 46 %
    assert shown["headline"]["range"] is not None and shown["headline"]["range_coverage_pct"] == 46.0 and shown["headline"]["range_hidden"] is False
    hidden, _ = build(cell={**CELL, "range_coverage_pct": 39.9})
    assert hidden["headline"]["range"] is None and hidden["headline"]["range_hidden"] is True
    edge, _ = build(cell={**CELL, "range_coverage_pct": 40.0})
    assert edge["headline"]["range"] is not None
    ctx, _ = build(context_only=True)
    assert ctx["headline"]["range"] is None                                  # no model price, so no model range
