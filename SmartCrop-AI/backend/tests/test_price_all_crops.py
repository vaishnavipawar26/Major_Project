"""Every supported crop through the real forecaster: the 60-day window, the graph and the selling comparison must agree with the
reliability policy, and no crop may get a 'validated' price its policy does not allow. Uses the shipped model and data (no network)."""
from datetime import date, timedelta

import pytest

from app.ml.price_prediction.forecaster import PriceForecaster, SeriesRef
from app.ml.price_prediction.crop_storage import storage_plans
from app.ml.price_prediction.window import build_window
from app.services import price_service

STATE = "All markets (state median)"


@pytest.fixture(scope="module")
def fc():
    return PriceForecaster()


def run(fc, crop, market, days):
    sup = fc.support[(fc.support["Commodity"] == crop) & (fc.support["Market"] == market)].sort_values("observations", ascending=False).iloc[0]
    ref = SeriesRef(sup["State"], sup["Market"], sup["Commodity"], sup["Variety"])
    start = price_service.today()
    f = fc.forecast(ref, start, start + timedelta(days=days), explain=False)
    return f, build_window(f, storage=storage_plans(crop))


@pytest.mark.parametrize("crop", ["Brinjal", "Cabbage", "Cauliflower", "Onion", "Potato", "Tomato", "Wheat"])
@pytest.mark.parametrize("days", [10, 25, 50])
def test_window_agrees_with_the_policy_for_every_crop(fc, crop, days):
    f, w = run(fc, crop, STATE, days)
    assert len(w["entries"]) == 60 and w["days"] == 60
    start = date.fromisoformat(f["input_date"])
    assert [e["date"] for e in w["entries"]] == [(start + timedelta(days=n)).isoformat() for n in range(1, 61)]
    for e in w["entries"]:          # one consistent record per day, the right crop, and a reason whenever a day is not validated
        assert e["crop"] == crop and e["market"] == f["source"]["used_market"]
        assert (e["status"] == "validated") == (e["reason"] is None)
        assert (e["status"] == "unavailable") == (e["predicted_price"] is None)
        if e["predicted_price"] is not None:
            assert e["model"] and e["horizon_days"] == (date.fromisoformat(e["date"]) - date.fromisoformat(f["forecast_origin_date"])).days
    valid = [e for e in w["entries"] if e["status"] == "validated"]
    assert w["highest"] == ({"date": max(valid, key=lambda e: e["predicted_price"])["date"], "price": max(e["predicted_price"] for e in valid)} if valid else None)
    if len(valid) > 1:
        assert (w["change"]["from_date"], w["change"]["to_date"]) == (valid[0]["date"], valid[-1]["date"])
    else:
        assert w["change"] is None
    mode = (f["policy"] or {}).get("mode")
    assert w["validation"]["mode"] == mode
    if mode == "context_only":
        # a blocked crop never gets a validated price, a best date or a "reliable" chart, and says why
        # the planned date is blocked, so nothing is compared; the only validated days a blocked target may sit beside are those served by a
        # validated crop-specific model (Wheat 1-14 days after the latest report), never the pooled model
        assert w["planned"]["status"] != "validated" and w["comparison"]["code"] == "unavailable"
        assert w["validation"]["reasons"], "a blocked crop must carry the reason from the reliability rule"
        assert all("crop model" in e["model"] for e in w["entries"] if e["status"] == "validated")
        if crop != "Wheat":   # the crop with validated crop-specific models in some distance bands
            assert w["validated_days"] == 0 and w["highest"] is None
    else:
        assert w["validated_days"] > 0
        by = {e["date"]: e for e in w["entries"]}
        if w["planned"]["status"] == "validated":
            # the chart and the planned-date price are the same daily prediction
            assert by[w["planned"]["date"]]["predicted_price"] == w["planned"]["price"] == f["target"]["predicted_price"]
        if w["comparison"]["code"] == "alternative":
            # the recommendation is the highest validated price on or before the storage deadline (planned date + holding days)
            deadline = w["storage"]["plans"][w["storage"]["default"]]["deadline"]
            best = max((e for e in w["entries"] if e["status"] == "validated" and e["date"] <= deadline), key=lambda e: e["predicted_price"])
            assert w["comparison"]["price"] == best["predicted_price"] > w["planned"]["price"]


@pytest.mark.parametrize("crop", ["Brinjal", "Cabbage", "Cauliflower"])
def test_validated_crops_work_in_other_markets_too(fc, crop):
    markets = fc.support[(fc.support["Commodity"] == crop) & (fc.support["supported"]) & (fc.support["Market"] != STATE)]
    top = markets.sort_values("observations", ascending=False)["Market"].drop_duplicates().head(3).tolist()
    assert len(top) == 3
    for m in top:
        _, w = run(fc, crop, m, 10)
        assert w["validated_days"] >= 25, m


@pytest.mark.parametrize("crop", ["Brinjal", "Cabbage", "Cauliflower", "Onion", "Potato", "Tomato", "Wheat"])
def test_each_days_model_follows_the_horizon_routing_and_series_uses_the_selected_market(fc, crop):
    from app.ml.price_prediction.forecaster import _algorithm_name
    f, w = run(fc, crop, STATE, 20)
    origin = date.fromisoformat(f["forecast_origin_date"])
    for e in w["entries"]:
        if e["predicted_price"] is not None:
            h = (date.fromisoformat(e["date"]) - origin).days
            expected = (fc.band_model_name(fc.band_cell(crop, h)) if fc.band_cell(crop, h) is not None
                        else _algorithm_name(fc.meta, fc.horizon_models[h]))
            assert e["model"] == expected
    assert sum(w["counts"].values()) == 60 and set(e["series"] for e in w["entries"]) <= {"validated", "experimental", "unavailable"}
