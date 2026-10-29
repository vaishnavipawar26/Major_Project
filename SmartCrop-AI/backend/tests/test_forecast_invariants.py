"""Invariants that must hold for every crop, market, planned date and storage plan, checked on the real forecaster output:
dates, labels, prices, the planned-date price, the highest price, the change, and every recommendation (it must come from the available
validated dates, never after the storage deadline, and its difference / percentage / waiting days must follow from the two prices and dates)."""
from datetime import date, timedelta

import pytest

from app.ml.price_prediction.crop_storage import storage_plans
from app.ml.price_prediction.forecaster import PriceForecaster, SeriesRef
from app.ml.price_prediction.window import build_window

STATE = "All markets (state median)"
CROPS = ["Brinjal", "Cabbage", "Cauliflower", "Onion", "Potato", "Tomato", "Wheat"]


@pytest.fixture(scope="module")
def fc():
    return PriceForecaster()


def series_ref(fc, crop, market):
    r = fc.support[(fc.support["Commodity"] == crop) & (fc.support["Market"] == market)].sort_values("observations", ascending=False).iloc[0]
    return SeriesRef(r["State"], r["Market"], r["Commodity"], r["Variety"])


def sparse_market(fc, crop):
    m = fc.support[(fc.support["Commodity"] == crop) & (fc.support["Market"] != STATE) & (fc.support["observations"] >= 30)]
    return m.sort_values("observations")["Market"].iloc[0]


def check_comparison(c, planned, by_date, hold, label):
    """One comparison (validated, or the provisional experimental one) against the day entries it was built from."""
    if c["code"] not in ("alternative", "planned_is_best"):
        assert c["price"] is None and c["date"] is None, label
        return
    assert c["deadline"] == (date.fromisoformat(planned["date"]) + timedelta(days=hold)).isoformat(), label
    day = by_date[c["date"]]                                    # the recommended date is one of the forecast dates
    assert day["predicted_price"] == c["price"], label
    assert c["date"] <= c["deadline"], f"{label}: recommended date after the storage deadline"
    assert c["price"] >= planned["price"], f"{label}: recommended price below the planned date's"
    assert c["wait_days"] == (date.fromisoformat(c["date"]) - date.fromisoformat(planned["date"])).days, label
    if c["code"] == "alternative":
        assert c["diff"] == pytest.approx(c["price"] - planned["price"], abs=0.01) and c["diff"] > 0, label
        assert c["diff_pct"] == pytest.approx(c["diff"] / planned["price"] * 100, abs=0.011), label
    else:
        assert c["date"] == planned["date"] and c["diff"] == 0 and c["wait_days"] == 0, label
    # nothing eligible (same status pool, on or before the deadline) is higher than the recommendation
    pool = [e for e in by_date.values() if e["date"] <= c["deadline"] and e["status"] in c.get("_pool", ("validated",))]
    assert all(e["predicted_price"] <= c["price"] for e in pool), f"{label}: a higher eligible date exists"


@pytest.mark.parametrize("crop", CROPS)
@pytest.mark.parametrize("market", ["state", "sparse"])
@pytest.mark.parametrize("offset", [2, 12, 30, 55])
def test_window_labels_dates_prices_and_recommendations_are_consistent(fc, crop, market, offset):
    start = date.today()
    ref = series_ref(fc, crop, STATE if market == "state" else sparse_market(fc, crop))
    f = fc.forecast(ref, start, start + timedelta(days=offset), explain=False)
    w = build_window(f, storage=storage_plans(crop))
    label = f"{crop}/{ref.market}/+{offset}"

    ds = [e["date"] for e in w["entries"]]
    assert ds == [(start + timedelta(days=n)).isoformat() for n in range(1, 61)], label
    for e in w["entries"]:
        assert e["series"] in ("validated", "experimental", "unavailable") and e["crop"] == crop, label
        assert (e["predicted_price"] is None) == (e["series"] == "unavailable"), label
        assert (e["reason"] is None) == (e["series"] == "validated"), label
        if e["predicted_price"] is not None:
            assert e["predicted_price"] > 0 and (e["lower"] is None or e["lower"] <= e["predicted_price"] <= e["upper"]), (label, e["date"])
    assert sum(w["counts"].values()) == 60, label
    by_date = {e["date"]: e for e in w["entries"]}
    validated = [e for e in w["entries"] if e["series"] == "validated"]

    planned = w["planned"]
    assert planned["date"] == (start + timedelta(days=offset)).isoformat() and planned["in_window"], label
    assert planned["price"] == by_date[planned["date"]]["predicted_price"] or planned["status"] == "unavailable", label
    assert planned["status"] == by_date[planned["date"]]["series"].replace("experimental", "not_validated"), label

    if validated:
        top = max(validated, key=lambda e: e["predicted_price"])
        assert w["highest"]["price"] == top["predicted_price"], label
    else:
        assert w["highest"] is None and w["change"] is None, label
    if w["change"]:
        assert (w["change"]["from_date"], w["change"]["to_date"]) == (validated[0]["date"], validated[-1]["date"]), label

    for key, plan in w["storage"]["plans"].items():
        hold = plan["hold_days"]
        c = plan["comparison"]
        if planned["status"] != "validated":
            assert c["code"] == "unavailable" and c["price"] is None, (label, key)       # no recommendation from an unvalidated planned date
        check_comparison(c, planned, by_date, hold, f"{label}/{key}")
        exp = plan.get("experimental")
        if exp:
            assert exp["validated"] is False
            raw = {d: {**e, "status": "validated" if e["status"] in ("validated", "not_validated") else e["status"]} for d, e in by_date.items()}
            exp_c = dict(exp["comparison"])
            exp_c["_pool"] = ("validated",)
            check_comparison(exp_c, exp["planned"], raw, hold, f"{label}/{key}/experimental")
