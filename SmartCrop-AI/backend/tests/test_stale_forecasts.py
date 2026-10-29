"""Onion, Potato and Tomato while the records are stale: the leak-free walk-forward test (scripts/evaluate_stale_forecasts.py), the rule that
decides whether the app's estimate may be replaced, and what the 60-day answer then says (labels, validation status, evidence shown)."""
import json
import math
from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from app.ml.common import paths
from app.ml.price_prediction import freshness
from app.ml.price_prediction.features import compute_features, usable_origin_mask
from app.ml.price_prediction.forecaster import PriceForecaster, SeriesRef
from app.ml.price_prediction.window import build_window
from scripts import evaluate_stale_forecasts as es

STATE = "All markets (state median)"
HARD = ["Onion", "Potato", "Tomato"]
OTHERS = {"Brinjal": 59, "Cabbage": 59, "Cauliflower": 59, "Wheat": 30}     # validated days today, unchanged by this work


@pytest.fixture(scope="module")
def fc():
    return PriceForecaster()


@pytest.fixture(autouse=True)
def auto_gate(monkeypatch):
    monkeypatch.setattr(freshness, "gate_mode", lambda: "auto")


def window(fc, crop, start=None):
    start = start or date.today()
    f = fc.forecast(SeriesRef("Maharashtra", STATE, crop, "All varieties"), start, start + timedelta(days=60), explain=False)
    return f, build_window(f)


# ------------------------------------------------------------------ the test protocol itself (synthetic series, no real data needed)
def _data():
    from scripts.evaluate_horizon_metrics import Data
    rng = np.random.default_rng(5)
    d = pd.date_range("2023-01-01", "2025-12-31", freq="D")
    price = 1500 * np.exp(np.cumsum(rng.normal(0, 0.02, len(d))))
    panel = pd.DataFrame({"Date": d, "State": "S", "Market": "M1", "Commodity": "Onion", "Variety": "V", "observed": True, "price": price,
                          "price_ffill": price, "arrivals": rng.uniform(5, 50, len(d)), "spread": 0.3, "state_price": price * 1.01})
    data = Data.__new__(Data)
    data.feat = compute_features(panel, {"commodity": {"Onion": 0}, "market": {"M1": 0}, "variety": {"V": 0}}, with_targets=True).reset_index(drop=True)
    data.mask = usable_origin_mask(data.feat).to_numpy()
    data._tlc = {}
    return data


def test_training_never_sees_anything_after_the_records_end():
    data = _data()
    _, o_from, _ = es.SPLITS["T"]
    cutoff = (pd.Timestamp(o_from) - pd.Timedelta(days=es.GAP)).date().isoformat()
    X, y, p0, od, h = data.pairs(np.random.default_rng(0), ["Onion"], 1, 60, target_before=cutoff)
    assert len(y) and (od.astype("datetime64[D]") + h.astype("timedelta64[D]") < np.datetime64(cutoff)).all()
    # every forecast start of the fold has its end of records on or after the cutoff, so the training data were all available then
    assert pd.Timestamp(o_from) - pd.Timedelta(days=es.GAP) >= pd.Timestamp(cutoff)


def test_cases_use_inputs_from_last_year_the_newest_report_from_the_gap_and_the_real_later_price():
    data = _data()
    c = es.cases(data, np.random.default_rng(1), "Onion", "2025-07-01", "2025-07-31")
    f = data.feat.set_index("Date")
    assert len(c["truth"]) > 0 and np.isfinite(c["truth"]).all() and (c["h"] >= 1).all() and (c["h"] <= 60).all()
    # spot-check one case against the series: start S, newest report S - GAP, truth at S + h
    r = pd.Timestamp("2024-07-01")                        # one of the reference days (S - 1 year)
    i = np.flatnonzero(np.isclose(c["p_r"], float(f.loc[r, "price_ffill"])))
    assert len(i)
    k = i[0]
    S = r + pd.DateOffset(years=1)
    assert c["latest"][k] == pytest.approx(float(f.loc[S - pd.Timedelta(days=es.GAP), "price_ffill"]))
    assert c["truth"][k] == pytest.approx(float(f.loc[S + pd.Timedelta(days=int(c["h"][k])), "target_price"]))
    assert S - pd.Timedelta(days=es.GAP) > r            # the newest report is later than the inputs' day, never after the start


def test_the_current_estimate_is_replaced_only_by_a_clearly_better_candidate():
    def w(rows):
        df = pd.DataFrame(rows, columns=["candidate", "C", "A", "T"]).set_index("candidate")
        df["mean_fold_mae"] = df[["C", "A", "T"]].mean(axis=1)
        return df.sort_values("mean_fold_mae")
    near = w([("pooled_prod", 1000, 1000, 1000), ("crop_rf", 990, 980, 990)])              # 1.3 % better: noise, not replaced
    assert es.decide(near)["replace_with"] is None
    one_fold = w([("pooled_prod", 1000, 1000, 1000), ("crop_rf", 800, 1100, 1050)])        # better on average but in one fold only
    assert es.decide(one_fold)["replace_with"] is None
    clear = w([("pooled_prod", 1000, 1000, 1000), ("crop_rf", 950, 960, 1010)])            # >= 2 % and two folds
    assert es.decide(clear)["replace_with"] == "crop_rf"


# ------------------------------------------------------------------ the measured result (report written by the script)
def test_report_compares_every_crop_with_the_baseline_and_keeps_the_current_method():
    rep = json.loads((paths.REPORTS_DIR / "stale_forecast_eval.json").read_text(encoding="utf-8"))
    assert rep["gap_days"] == es.GAP and rep["margin_pct"] == 2.0
    for crop in HARD:
        six = rep["sixty_day"][crop]
        assert {"pooled_prod", "flat_last_year", "flat_latest", "seasonal_last_year"} <= set(six)
        for band in es.BANDS:
            got = {r["candidate"] for r in rep["rows"] if r["crop"] == crop and r["band"] == band}
            assert {"pooled_prod", "flat_last_year"} <= got, (crop, band)
        assert rep["decision"][crop]["replace_with"] is None, crop        # nothing was clearly better: the app's method is unchanged
    summary = json.loads((paths.MODELS_DIR / "price_reliability" / "stale_test_summary.json").read_text(encoding="utf-8"))
    for crop in HARD:
        s = summary["crops"][crop]
        assert s["current_wape_pct"] == pytest.approx(rep["sixty_day"][crop]["pooled_prod"]["wape_pct"], abs=0.1)
        assert s["flat_wape_pct"] == pytest.approx(rep["sixty_day"][crop]["flat_last_year"]["wape_pct"], abs=0.1)


def test_tomato_46_60_is_not_deployed_after_failing_the_leak_free_test(fc):
    assert set(fc.crop_band["cells"]) == {"Wheat|1-7", "Wheat|8-14", "Wheat|15-21", "Wheat|22-30"}
    rep = json.loads((paths.REPORTS_DIR / "stale_forecast_eval.json").read_text(encoding="utf-8"))
    a = {r["candidate"]: r["mae"] for r in rep["rows"] if r["crop"] == "Tomato" and r["split"] == "A" and r["band"] == "46-60"}
    assert a["band_46_60_half"] > a["flat_last_year"]                   # loses to the baseline in fold A: the reason it was withdrawn


# ------------------------------------------------------------------ the 60-day answer
@pytest.mark.parametrize("crop", HARD)
def test_hard_crops_get_60_labelled_experimental_days_with_the_measured_error(fc, crop):
    f, w = window(fc, crop)
    start = date.fromisoformat(f["input_date"])
    assert [e["date"] for e in w["entries"]] == [(start + timedelta(days=n)).isoformat() for n in range(1, 61)]
    assert w["counts"] == {"validated": 0, "experimental": 60, "unavailable": 0}               # nothing claims to be validated
    for e in w["entries"]:
        assert e["series"] == "experimental" and e["reason"] and math.isfinite(e["predicted_price"]) and e["predicted_price"] > 0
        assert "crop model" not in e["model"]
    st = w["validation"]["stale_test"]
    assert st["gap_days"] == es.GAP and 0 < st["current_wape_pct"] < 1000 and 0 < st["flat_wape_pct"] < 1000
    # the starting price is labelled as last year's reported price moved forward by the app's assumption, with its real date
    ref = w["reference"]
    assert ref["adjusted"] is True and ref["stale"] is True and ref["adjustment_pct_per_year"] == pytest.approx(fc.inflation * 100)
    assert date.fromisoformat(ref["reported_date"]) <= fc.data_end and ref["latest_actual"]["date"] == fc.data_end.isoformat()


@pytest.mark.parametrize("crop", HARD)
def test_no_stale_test_note_when_the_forecast_starts_from_fresh_records(fc, crop):
    _, w = window(fc, crop, fc.data_end + timedelta(days=10))
    assert w["validation"]["stale_test"] is None


@pytest.mark.parametrize("crop,validated", sorted(OTHERS.items()))
def test_other_crops_are_unchanged(fc, crop, validated):
    _, w = window(fc, crop)
    assert w["counts"]["validated"] == validated and sum(w["counts"].values()) == 60
    assert w["validation"]["stale_test"] is None                         # evidence exists only for the three crops that were tested


@pytest.mark.parametrize("crop", HARD)
def test_summary_estimates_come_from_the_experimental_days_and_are_labelled(fc, crop):
    f, w = window(fc, crop)
    exp = [e for e in w["entries"] if e["series"] == "experimental"]
    est = w["estimates"]
    assert est["kind"] == "experimental" and est["validated"] is False and est["days"] == len(exp) == 60
    top = max(exp, key=lambda e: e["predicted_price"])
    assert est["highest"] == {"date": top["date"], "price": top["predicted_price"]}
    ch = est["change"]
    assert (ch["from_date"], ch["to_date"]) == (exp[0]["date"], exp[-1]["date"])
    assert ch["pct"] == pytest.approx((exp[-1]["predicted_price"] / exp[0]["predicted_price"] - 1) * 100, abs=0.01)
    assert w["highest"] is None and w["change"] is None            # the validated-only figures stay empty: nothing claims validation
    assert w["planned"]["status"] == "not_validated"
    assert w["planned"]["price"] == next(e for e in w["entries"] if e["date"] == w["planned"]["date"])["predicted_price"]


@pytest.mark.parametrize("crop", sorted(OTHERS))
def test_crops_with_validated_days_get_no_estimate_block(fc, crop):
    _, w = window(fc, crop)
    assert w["estimates"] is None and w["highest"] is not None
