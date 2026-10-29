"""The 60-day forecast against the records it is built from: the end of the records is the newest REAL price (never a metadata date),
stale and fresh records are handled differently, nothing after the forecast origin is read, a day's range is withheld when backtests show it
does not hold, and the explanation keeps the reported price, the app's assumed price rise and the model's change apart."""
import math
from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from app.ml.common import paths
from app.ml.price_prediction import freshness
from app.ml.price_prediction.features import compute_features, usable_origin_mask
from app.ml.price_prediction.forecaster import RANGE_MIN_SHOWN_COVERAGE, ModelSchemaError, PriceForecaster, SeriesRef
from app.ml.price_prediction.window import build_window
from app.ml.registry import ModelRegistry

STATE = "All markets (state median)"
CROPS = ["Brinjal", "Cabbage", "Cauliflower", "Onion", "Potato", "Tomato", "Wheat"]
HARD = ["Onion", "Potato", "Tomato"]


@pytest.fixture(scope="module")
def fc():
    return PriceForecaster()


@pytest.fixture(autouse=True)
def auto_gate(monkeypatch):
    monkeypatch.setattr(freshness, "gate_mode", lambda: "auto")


def state_ref(crop):
    return SeriesRef("Maharashtra", STATE, crop, "All varieties")


def last_real_price_date(fc):
    p = fc.panel
    return p.loc[p["observed"] & p["price"].notna() & (p["price"] > 0), "Date"].max().date()


# ------------------------------------------------------------------ end of records
def test_data_end_is_the_newest_reported_price_not_a_metadata_date(fc):
    assert fc.data_end == last_real_price_date(fc)
    assert fc.options()["data_end"] == fc.data_end.isoformat()
    assert fc.options()["trained_data_end"] == fc.meta["data_end"]


def _forecaster_with_panel(tmp_path, monkeypatch, panel):
    p = tmp_path / "panel.parquet"
    panel.to_parquet(p)
    monkeypatch.setattr(paths, "PRICE_PANEL_PATH", p)
    return PriceForecaster


def test_metadata_cannot_make_older_records_look_fresh(tmp_path, monkeypatch, fc):
    cut = pd.Timestamp("2025-09-30")
    cls = _forecaster_with_panel(tmp_path, monkeypatch, fc.panel[fc.panel["Date"] <= cut])
    short = cls()
    assert short.data_end == cut.date()                         # the loaded records end here ...
    assert short.model_data_end == date.fromisoformat(fc.meta["data_end"])   # ... even though the models were trained to 31 Dec 2025
    assert short.data_end < short.model_data_end


def test_empty_price_panel_is_refused_and_only_the_price_model_goes_down(tmp_path, monkeypatch, fc):
    empty = fc.panel.iloc[0:0]
    _forecaster_with_panel(tmp_path, monkeypatch, empty)
    with pytest.raises(ModelSchemaError, match="no reported prices"):
        PriceForecaster()
    reg = ModelRegistry().load()
    assert reg.price is None and "no reported prices" in reg.errors["price"]
    assert reg.monthly is not None and reg.crop is not None    # the rest of the app keeps working


def test_panel_without_any_observed_price_is_refused(tmp_path, monkeypatch, fc):
    p = fc.panel.head(500).copy()
    p["observed"] = False
    _forecaster_with_panel(tmp_path, monkeypatch, p)
    with pytest.raises(ModelSchemaError):
        PriceForecaster()


# ------------------------------------------------------------------ stale and fresh records
def test_stale_records_are_a_labelled_projection_from_a_real_price(fc):
    start = fc.data_end + timedelta(days=freshness.FRESH_DATASET_DAYS + 200)
    for crop in HARD:
        f = fc.forecast(state_ref(crop), start, start + timedelta(days=60), explain=False)
        w = build_window(f)
        ref = w["reference"]
        assert ref["adjusted"] is True and ref["stale"] is True, crop
        assert ref["latest_actual"]["date"] <= fc.data_end.isoformat(), crop
        assert date.fromisoformat(ref["reported_date"]) <= fc.data_end, crop             # the start is built from a REAL report ...
        assert ref["price"] == pytest.approx(ref["reported_price"] * (1 + fc.inflation) ** ref["years"], rel=1e-3)   # ... x the stated assumption
        assert f["projection"]["inflation_annual_pct"] == ref["adjustment_pct_per_year"]


def test_fresh_records_start_from_the_latest_real_price_without_adjustment(fc):
    start = fc.data_end + timedelta(days=20)                  # within FRESH_DATASET_DAYS: the gate applies
    for crop in HARD:
        f = fc.forecast(state_ref(crop), start, fc.data_end + timedelta(days=60), explain=False)
        w = build_window(f)
        assert f["source"]["method"] == "trained_model", crop
        assert f["projection"] is None and f["dates"]["years_shifted"] == 0, crop
        assert w["reference"]["adjusted"] is False and w["reference"]["stale"] is False, crop
        assert f["current_price"] == pytest.approx(fc.latest_recorded("Maharashtra", STATE, crop, "All varieties")["price"], rel=1e-6)
        assert len(w["entries"]) == 60 and sum(w["counts"].values()) == 60, crop
        # the model reaches 60 days after the last REPORT; later window days are unavailable, with that reason, never filled in
        reach = date.fromisoformat(f["dates"]["origin_observation_date"]) + timedelta(days=fc.max_horizon)
        for e in w["entries"]:
            beyond = date.fromisoformat(e["date"]) > reach
            assert (e["status"] == "unavailable") == beyond, (crop, e["date"])
            if beyond:
                assert "at most 60 days" in e["reason"]


def _beyond(fc, crop, gap=20):
    """Fresh records, start ``gap`` days after the last report, planned date = window day 60 (past the model's reach)."""
    start = fc.data_end + timedelta(days=gap)
    return start, fc.forecast(state_ref(crop), start, start + timedelta(days=60), explain=True)


@pytest.mark.parametrize("crop", HARD + ["Brinjal"])
def test_fresh_planned_date_beyond_reach_keeps_the_model_days_and_labels_only_the_planned_date(fc, crop):
    start, f = _beyond(fc, crop)
    origin = date.fromisoformat(f["dates"]["origin_observation_date"])
    reach = origin + timedelta(days=fc.max_horizon)
    w = build_window(f)
    # the reachable days are exactly what a forecast with a reachable planned date gives (same model, same labels)
    within = build_window(fc.forecast(state_ref(crop), start, reach, explain=False))
    for e, e2 in zip(w["entries"], within["entries"]):
        if date.fromisoformat(e["date"]) <= reach:
            assert (e["status"], e["predicted_price"], e["model"]) == (e2["status"], e2["predicted_price"], e2["model"]), e["date"]
            assert e["estimate"] is None, e["date"]                      # a model day never carries the historical estimate
        else:
            assert e["status"] == "unavailable" and e["predicted_price"] is None and "at most 60 days" in e["reason"], e["date"]
            est = e["estimate"]                                            # ... but it gets the labelled historical estimate, apart from the model price
            assert est["method"] == "historical_baseline" and est["validated"] is False and math.isfinite(est["price"]) and est["price"] > 0
    assert len(w["entries"]) == 60 and sum(w["counts"].values()) == 60
    assert w["counts"]["unavailable"] == (start + timedelta(days=60) - reach).days == w["estimated_days"]
    # the answer is still the trained model's; only the planned date is a labelled historical estimate
    assert f["source"]["method"] == "trained_model" and f["source"]["target_method"] == "historical_baseline" and f["source"]["fallback"]
    assert "at most 60 days" in f["source"]["note"]
    t = f["target"]
    assert t["method"] == "historical_baseline" and t["beats_baseline"] is False and t["model"] == "Historical price estimate (no model)"
    assert "not a model forecast" in t["validation_reason"] and f["model"]["algorithm"] == t["model"]
    assert f["verdict"] is None and f["range_info"] is None and f["advice"]["code"] == "UNAVAILABLE"
    assert f["explanations"] == [] and "No explanation for" in f["explanation_note"]
    # nothing about the planned date is validated, and its estimate is carried apart from the days
    p = w["planned"]
    assert p["status"] == "unavailable" and p["price"] is None and p["estimate"]["validated"] is False
    assert p["estimate"]["price"] == t["predicted_price"] and w["comparison"]["code"] == "unavailable"
    # the estimate is the same figure the whole answer used to fall back to, so what history saves is unchanged
    ctx_target = fc._forecast_baseline(state_ref(crop), _ctx(fc, crop, start), start + timedelta(days=60))["target"]
    assert t["predicted_price"] == ctx_target["predicted_price"]
    assert t["change_pct"] == pytest.approx((t["predicted_price"] / f["current_price"] - 1) * 100, abs=0.01)


def _ctx(fc, crop, start):
    from app.ml.price_prediction.forecaster import _Ctx
    return _Ctx(input_date=start, ref_date=fc.data_end, years_ahead=0, level=1.0, latest=fc.latest_for(state_ref(crop), start))


def test_fresh_planned_date_within_reach_is_a_normal_model_forecast(fc):
    start = fc.data_end + timedelta(days=20)
    f = fc.forecast(state_ref("Brinjal"), start, fc.data_end + timedelta(days=60), explain=True)
    assert f["source"]["method"] == "trained_model" and "target_method" not in f["source"]
    assert f["target"].get("method") is None and f["target"]["horizon_days"] == 60
    assert f["explanations"] and f.get("explanation_note") is None and build_window(f)["planned"]["estimate"] is None


def test_stale_records_reach_the_whole_window_so_no_planned_date_needs_an_estimate(fc):
    start = date.today()
    for crop in HARD:
        f = fc.forecast(state_ref(crop), start, start + timedelta(days=60), explain=False)
        w = build_window(f)
        assert f["projection"] is not None and f["target"].get("method") is None and "target_method" not in f["source"], crop
        assert w["counts"]["unavailable"] == 0 and w["planned"]["estimate"] is None, crop
        assert w["estimated_days"] == 0 and all(e["estimate"] is None for e in w["entries"]), crop      # all 60 days are model days


def test_no_reachable_window_day_still_falls_back_to_the_historical_estimate(fc):
    # a market report older than the reach: nothing in the window can come from the model (the gate is off, so the old fallback applies)
    ref = SeriesRef("Maharashtra", STATE, "Onion", "All varieties")
    f = fc._forecast_baseline(ref, _ctx(fc, "Onion", fc.data_end + timedelta(days=70)), fc.data_end + timedelta(days=100))
    assert f["model"]["algorithm"] == "Historical price estimate (no model)" and f["validated_days"] == 0


def test_beyond_reach_flow_predict_history_and_explain(client, user, monkeypatch):
    from app.services import price_service
    fc = client.app.state.registry.price
    start = fc.data_end + timedelta(days=20)
    monkeypatch.setattr(price_service, "today", lambda: start)
    body = {"state": "Maharashtra", "market": STATE, "commodity": "Brinjal", "target_date": (start + timedelta(days=60)).isoformat()}
    r = client.post("/api/price-prediction/predict", headers=user["headers"], json=body)
    assert r.status_code == 201, r.text
    out = r.json()
    t = out["target"]
    assert out["source"]["target_method"] == "historical_baseline" and t["beats_baseline"] is False
    assert out["window"]["planned"]["estimate"]["price"] == t["predicted_price"] and out["window"]["counts"]["validated"] > 0
    assert out["verdict"] is None and "explanation_note" not in out and "_target_note" not in out
    # history keeps the planned date's (labelled) price and, re-opened, makes no rise / fall claim for it
    item = client.get(f"/api/history/price/{out['id']}", headers=user["headers"]).json()
    assert item["predicted_price"] == t["predicted_price"] and item["verdict"] is None
    listed = client.get("/api/history/price", headers=user["headers"]).json()["items"][0]
    assert listed["id"] == out["id"] and listed["verdict"] is None
    # re-opening (trend with the saved start) gives the same answer; the explanation says why there is none for that date
    again = client.post("/api/price-prediction/trend", headers=user["headers"], json={**body, "as_of": start.isoformat()}).json()
    assert again["target"]["predicted_price"] == t["predicted_price"]
    e = client.post("/api/price-prediction/explain", headers=user["headers"], json={**body, "as_of": start.isoformat()}).json()
    assert e["explanations"] == [] and "at most 60 days" in e["message"]


# ------------------------------------------------------------------ the 60 days
@pytest.mark.parametrize("crop", CROPS)
def test_sixty_consecutive_finite_positive_days_with_honest_status(fc, crop):
    start = date.today()
    f = fc.forecast(state_ref(crop), start, start + timedelta(days=60), explain=False)
    w = build_window(f)
    ds = [date.fromisoformat(e["date"]) for e in w["entries"]]
    assert ds == [start + timedelta(days=n) for n in range(1, 61)] and len(set(ds)) == 60
    assert [e["day"] for e in w["entries"]] == list(range(1, 61))
    projected = f["projection"] is not None
    for e in w["entries"]:
        if e["status"] == "unavailable":
            continue
        assert math.isfinite(e["predicted_price"]) and e["predicted_price"] > 0, e["date"]
        h = e["horizon_days"]
        if e["status"] == "validated":   # only where the crop's policy (both backtest scenarios) allows the model
            assert fc.policy_for(crop, h)["mode"] == "model", (crop, h)
        u = e["uncertainty"]
        cell, scope = fc.reliability_cell(crop, h, projected)
        assert u["coverage_pct"] == (None if cell is None else round(cell["range_coverage_pct"], 1)) and u["scope"] == scope
        assert u["shown"] == (u["coverage_pct"] is None or u["coverage_pct"] >= RANGE_MIN_SHOWN_COVERAGE)
        if u["shown"]:
            assert e["lower"] <= e["predicted_price"] <= e["upper"]
        else:                            # a range the backtests showed does not hold is never handed out
            assert e["lower"] is None and e["upper"] is None and "only" in u["note"]


def test_projection_ranges_that_rarely_held_are_withheld_for_onion_and_potato(fc):
    start = date.today()
    for crop in ("Onion", "Potato"):
        cells = [fc.reliability_cell(crop, h, True)[0] for h in (1, 10, 20, 45)]
        if not all(c and c["range_coverage_pct"] < RANGE_MIN_SHOWN_COVERAGE for c in cells):
            pytest.skip("the stored backtest no longer shows low projection coverage")
        w = build_window(fc.forecast(state_ref(crop), start, start + timedelta(days=60), explain=False))
        assert all(e["lower"] is None for e in w["entries"]), crop


# ------------------------------------------------------------------ no future information
def test_forecast_reads_nothing_after_its_origin(fc, monkeypatch):
    ref = state_ref("Onion")
    key = (ref.state, ref.market, ref.commodity, ref.variety)
    as_of = date(2025, 6, 1)
    before = fc.forecast(ref, as_of, as_of + timedelta(days=60), explain=False)
    s = fc._series[key].copy()
    later = s["Date"] > pd.Timestamp(as_of)
    s.loc[later, ["price", "price_ffill", "state_price"]] *= 3.0
    s.loc[later, "arrivals"] = 1.0
    monkeypatch.setitem(fc._series, key, s)
    after = fc.forecast(ref, as_of, as_of + timedelta(days=60), explain=False)
    assert before["forecast_origin_date"] == after["forecast_origin_date"]
    assert [p["predicted_price"] for p in before["chart_path"]] == [p["predicted_price"] for p in after["chart_path"]]


# ------------------------------------------------------------------ explanation
@pytest.mark.parametrize("crop", HARD)
def test_explanation_keeps_reported_price_assumption_and_model_change_apart(fc, crop):
    start = date.today()
    target = start + timedelta(days=45)
    f = fc.forecast(state_ref(crop), start, target, explain=True)
    pb = f["explanations"][0]["v3"]["price_build"]
    adj = pb["adjustment"]
    assert pb["start_price"] == pytest.approx(pb["reported_price"]["price"] * adj["factor"], abs=0.02)
    if adj["applied"]:
        assert adj["basis"] == "assumption" and adj["pct_per_year"] == pytest.approx(fc.inflation * 100)
        assert any("not something the model learned" in s for s in pb["steps"])
    mc = pb["model_change"]
    assert mc["shap_base"] + mc["shap_sum"] == pytest.approx(mc["log"], abs=1e-3)      # SHAP explains the model's change, nothing else
    assert pb["predicted_price"] == pytest.approx(pb["start_price"] * math.exp(mc["log"]), rel=1e-3)
    day = next(e for e in build_window(f)["entries"] if e["date"] == target.isoformat())
    assert pb["validation"]["status"] == day["series"]
    assert pb["uncertainty"]["shown"] == day["uncertainty"]["shown"]
    for s in pb["steps"]:            # no driver the model does not have is offered as a reason
        assert not any(w in s.lower() for w in ("rainfall", "demand", "weather", "festival"))


def test_explanation_banner_calls_the_price_rise_an_assumption(fc):
    start = fc.data_end + timedelta(days=300)
    v3 = fc.forecast(state_ref("Cauliflower"), start, start + timedelta(days=20), explain=True)["explanations"][0]["v3"]
    assert "assumed" in v3["banner"]["detail"] and "not learned by the model" in v3["banner"]["detail"]


# ------------------------------------------------------------------ evaluation script (per-horizon metrics, baselines, no leakage)
def _synthetic():
    rng = np.random.default_rng(3)
    d = pd.date_range("2024-01-01", periods=300, freq="D")
    price = 1500 * np.exp(np.cumsum(rng.normal(0, 0.02, len(d))))
    return pd.DataFrame({"Date": d, "State": "S", "Market": "M1", "Commodity": "Onion", "Variety": "V", "observed": True, "price": price,
                         "price_ffill": price, "arrivals": rng.uniform(5, 50, len(d)), "spread": 0.3, "state_price": price * 1.01})


def test_evaluation_metrics_and_baseline():
    from scripts.evaluate_horizon_metrics import metrics
    start = np.array([100.0, 200.0, 300.0])
    truth = np.array([110.0, 190.0, 330.0])
    base = float(np.mean(np.abs(start - truth)))
    nc = metrics(start, truth, np.zeros(3), base)
    assert nc["skill_pct"] == 0 and nc["mae"] == pytest.approx(base, abs=0.05)
    assert nc["wape_pct"] == pytest.approx(100 * 50 / 630, abs=0.01)
    perfect = metrics(start, truth, np.log(truth / start), base)
    assert perfect["mae"] == 0 and perfect["rmse"] == 0 and perfect["r2_change"] == pytest.approx(1.0) and perfect["skill_pct"] == 100


def test_evaluation_training_pairs_never_reach_the_scored_period():
    from scripts.evaluate_horizon_metrics import Data
    enc = {"commodity": {"Onion": 0}, "market": {"M1": 0}, "variety": {"V": 0}}
    data = Data.__new__(Data)
    data.feat = compute_features(_synthetic(), enc, with_targets=True).reset_index(drop=True)
    data.mask = usable_origin_mask(data.feat).to_numpy()
    data._tlc = {}
    cut = "2024-08-01"
    X, y, p0, od, h = data.pairs(np.random.default_rng(0), ["Onion"], 1, 60, target_before=cut)
    assert len(y) > 0 and np.isfinite(y).all()
    assert (od.astype("datetime64[D]") + h.astype("timedelta64[D]") < np.datetime64(cut)).all()
    X, y, p0, od, h = data.pairs(np.random.default_rng(0), ["Onion"], 13, 30, origin_from="2024-08-01", origin_to="2024-08-31")
    assert ((h >= 13) & (h <= 30)).all() and (od >= np.datetime64("2024-08-01")).all() and (od <= np.datetime64("2024-08-31")).all()
