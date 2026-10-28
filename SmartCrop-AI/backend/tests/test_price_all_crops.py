"""Every supported crop through the real forecaster: the 30-day window, the graph and the selling comparison must agree with the
reliability policy, and no crop may get a 'validated' price its policy does not allow. Uses the shipped model and data (no network)."""
from datetime import timedelta

import pytest

from app.ml.price_prediction.forecaster import PriceForecaster, SeriesRef
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
    return f, build_window(f, hold_days=(f["advice"].get("storage") or {}).get("farm_hold_days"))


@pytest.mark.parametrize("crop", ["Brinjal", "Cabbage", "Cauliflower", "Onion", "Potato", "Tomato", "Wheat"])
@pytest.mark.parametrize("days", [10, 25])
def test_window_agrees_with_the_policy_for_every_crop(fc, crop, days):
    f, w = run(fc, crop, STATE, days)
    assert len(w["entries"]) == 30
    mode = (f["policy"] or {}).get("mode")
    assert w["validation"]["mode"] == mode
    if mode == "context_only":
        # a blocked crop never gets a validated price, a best date or a "reliable" chart, and says why
        assert w["validated_days"] == 0 and w["highest"] is None and w["comparison"]["code"] == "unavailable"
        assert w["validation"]["reasons"], "a blocked crop must carry the reason from the reliability rule"
        assert all(e["status"] != "validated" for e in w["entries"])
    else:
        assert w["validated_days"] > 0
        by = {e["date"]: e for e in w["entries"]}
        if w["planned"]["status"] == "validated":
            # the chart and the planned-date price are the same daily prediction
            assert by[w["planned"]["date"]]["predicted_price"] == w["planned"]["price"] == f["target"]["predicted_price"]
        if w["comparison"]["code"] == "alternative":
            best = max((e for e in w["entries"] if e["status"] == "validated" and e["day"] <= (w["hold_days"] or 99)), key=lambda e: e["predicted_price"])
            assert w["comparison"]["price"] == best["predicted_price"] > w["planned"]["price"]


@pytest.mark.parametrize("crop", ["Brinjal", "Cabbage", "Cauliflower"])
def test_validated_crops_work_in_other_markets_too(fc, crop):
    markets = fc.support[(fc.support["Commodity"] == crop) & (fc.support["supported"]) & (fc.support["Market"] != STATE)]
    top = markets.sort_values("observations", ascending=False)["Market"].drop_duplicates().head(3).tolist()
    assert len(top) == 3
    for m in top:
        _, w = run(fc, crop, m, 10)
        assert w["validated_days"] >= 25, m
