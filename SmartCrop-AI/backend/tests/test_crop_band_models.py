"""Crop- and band-specific models (scripts/train_crop_band_models.py): what is deployed, where it is used, and that no test data leaked."""
from datetime import date, timedelta

import joblib
import numpy as np
import pytest

from app.ml.common import paths
from app.ml.price_prediction.forecaster import PriceForecaster, SeriesRef
from app.ml.price_prediction.window import build_window

STATE = "All markets (state median)"
CROPS = ["Brinjal", "Cabbage", "Cauliflower", "Onion", "Potato", "Tomato", "Wheat"]


@pytest.fixture(scope="module")
def art():
    return joblib.load(paths.PRICE_MODEL_DIR / "crop_band_models.joblib")


@pytest.fixture(scope="module")
def fc():
    return PriceForecaster()


def window(fc, crop, days=8):
    r = fc.support[(fc.support["Commodity"] == crop) & (fc.support["Market"] == STATE)].iloc[0]
    start = date(2026, 10, 28)
    f = fc.forecast(SeriesRef(r["State"], r["Market"], r["Commodity"], r["Variety"]), start, start + timedelta(days=days), explain=False)
    return f, build_window(f)


def test_only_cells_that_cleared_every_split_and_scenario_are_deployed(art):
    assert set(art["cells"]) == {"Wheat|1-7", "Wheat|8-14", "Wheat|15-21", "Wheat|22-30"}
    # Tomato 31-45 passed under two of three sampling seeds only, so it is recorded as rejected, not deployed
    assert [(r["crop"], r["band"]) for r in art["rejected"]] == [("Tomato", "31-45")] and min(art["rejected"][0]["weakest_score_by_seed"]) < 2.0
    for cell in art["cells"].values():
        for split in "CAT":
            for scenario in ("real_origin", "projection"):
                assert cell["splits"][split][scenario]["skill_pct"] >= art["margin_pct"] == 2.0
        assert 0 < cell["shrink"] <= 1 and cell["final_train_pairs"] > 0
    assert art["data_end"] == "2025-12-31" and art["features"] and "commodity_code" not in art["features"]


def test_ranges_are_only_claimed_where_they_were_measured(art):
    # fresh-report coverage is 83-88 %; projection coverage is lower (29-58 %). Wheat 1-7 days is below the app's 40 % display threshold, so its
    # projected range stays hidden; the others are shown with their measured coverage, never as "80 %".
    for key, cell in art["cells"].items():
        t = cell["splits"]["T"]
        assert t["real_origin"]["coverage_pct"] > 80
        assert (t["projection"]["coverage_pct"] < 40) == (key == "Wheat|1-7")
        assert t["projection"]["coverage_pct"] < 80


def test_every_cell_cleared_the_margin_under_three_sampling_seeds_and_scaling_is_learned_where_stated(art):
    for key, cell in art["cells"].items():
        assert len(cell["weakest_skill_by_seed"]) == 3 and min(cell["weakest_skill_by_seed"]) >= art["margin_pct"], key
        assert 0 < cell["shrink"] <= 1 and all(0 <= cell["splits"][s]["shrink"] <= 1 for s in "CAT")
        assert cell["family"] in ("xgb", "ma_ridge")
    assert art["cells"]["Wheat|8-14"]["shrink_rule"] == "learned" and art["cells"]["Wheat|1-7"]["shrink_rule"] == 0.5


def test_training_pairs_never_reach_the_cutoff_date():
    from scripts.experiment_hard_crops import load, pairs
    feat, mask = load()
    rng = np.random.default_rng(1)
    X, y, p0, origin, h = pairs(feat, mask, "Wheat", 1, 7, rng, target_before="2025-07-01")
    targets = origin.astype("datetime64[D]") + h.astype("timedelta64[D]")
    assert len(y) > 1000 and targets.max() < np.datetime64("2025-07-01")


def test_wheat_uses_its_own_models_for_days_1_to_30_only(fc):
    f, w = window(fc, "Wheat", days=20)
    origin = date.fromisoformat(f["forecast_origin_date"])
    names = set()
    for e in w["entries"]:
        if e["predicted_price"] is None:
            continue
        h = (date.fromisoformat(e["date"]) - origin).days
        if h <= 30:
            assert e["series"] == "validated" and "crop model" in e["model"] and e["reason"] is None, (e["date"], h)
            names.add(e["model"])
        else:
            assert e["series"] == "experimental" and "crop model" not in e["model"] and e["reason"], (e["date"], h)
    assert names == {"moving-average regression (Wheat, 8-14-day crop model)", "moving-average regression (Wheat, 15-21-day crop model)",
                     "moving-average regression (Wheat, 22-30-day crop model)"} | ({"xgboost (Wheat, 1-7-day crop model)"} & names)
    assert w["counts"]["validated"] == 30 and w["planned"]["status"] == "validated"
    assert f["policy"]["mode"] == "model" and "Crop-specific" in f["policy"]["reasons"][0]
    assert f["explanations"] == []          # explain=False here; the explanation path is tested in test_wheat_explanation_uses_the_crop_model


def test_wheat_explanation_uses_the_crop_model(fc):
    r = fc.support[(fc.support["Commodity"] == "Wheat") & (fc.support["Market"] == STATE)].iloc[0]
    f = fc.forecast(SeriesRef(r["State"], r["Market"], r["Commodity"], r["Variety"]), date(2026, 10, 28), date(2026, 11, 14), explain=True)
    e = f["explanations"][0]
    assert "moving-average regression" in e["algorithm"] and e["factors"]
    assert all(x["direction"] == ("up" if x["shap_value"] > 0 else "down") for x in e["factors"])


@pytest.mark.parametrize("crop", ["Onion", "Potato", "Tomato"])
def test_crops_that_did_not_clear_the_rule_stay_unvalidated(fc, crop):
    _, w = window(fc, crop)
    assert w["counts"]["validated"] == 0 and w["counts"]["experimental"] == 60


@pytest.mark.parametrize("crop", ["Brinjal", "Cabbage", "Cauliflower"])
def test_working_crops_are_untouched(fc, crop):
    _, w = window(fc, crop)
    assert w["counts"] == {"validated": 59, "experimental": 1, "unavailable": 0}
