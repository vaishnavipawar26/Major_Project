"""Unit tests for the profitability engine and the monthly price features."""
import numpy as np
import pandas as pd

from app.ml.common.reference import calendar, economics, months_between
from app.ml.economics.profit import evaluate, timing_score, timing_status
from app.ml.price_prediction.monthly import SeriesContext, training_rows


def test_months_between_wraps():
    assert months_between(11, 3) == 4
    assert months_between(6, 6) == 12
    assert months_between(1, 2) == 1


def test_timing_status():
    cal = calendar()["Onion"]          # 4-5 months, up to 4 months storage
    assert timing_status(cal, 3) == ("not_ready", 0)
    assert timing_status(cal, 5) == ("fresh", 0)
    assert timing_status(cal, 7) == ("stored", 2)
    assert timing_status(cal, 10)[0] == "spoiled"
    assert timing_score(cal, 11, 5)[0] == 100.0
    assert timing_score(cal, 4, 5)[0] == 50.0   # April is not a planting month


def test_profit_arithmetic():
    e, cal = economics()["Wheat"], calendar()["Wheat"]
    out = evaluate(e, cal, price=2500, price_low=2000, price_high=3000, offset=4,
                   planting_year=e.cost_reference_year, area_acres=1, inflation=0.05)
    eff = e.yield_q_per_acre * (1 - e.post_harvest_loss_pct / 100)
    expected = eff * 2500 * (1 - e.marketing_cost_pct / 100) - e.cost_per_acre_inr
    assert abs(out["net_profit"] - expected) <= 1
    assert out["net_profit_low"] < out["net_profit"] < out["net_profit_high"]
    # at the break-even price the profit is ~0
    be = evaluate(e, cal, price=out["break_even_price"], price_low=0, price_high=0, offset=4,
                  planting_year=e.cost_reference_year, area_acres=1, inflation=0.05)
    assert abs(be["net_profit"]) < 50


def test_storage_costs_and_losses_apply():
    e, cal = economics()["Onion"], calendar()["Onion"]
    kw = dict(price=2000, price_low=1500, price_high=2500, planting_year=2026, area_acres=1,
              inflation=0.05)
    fresh, stored = evaluate(e, cal, offset=5, **kw), evaluate(e, cal, offset=7, **kw)
    assert stored["storage_cost"] > 0 and fresh["storage_cost"] == 0
    assert stored["effective_yield_q"] < fresh["effective_yield_q"]


def test_monthly_features_do_not_look_ahead():
    """Changing prices AFTER the origin must not change the features at the origin."""
    idx = pd.period_range("2023-01", "2025-12", freq="M")
    rng = np.random.default_rng(0)
    price = 1000 * np.exp(np.cumsum(rng.normal(0, 0.1, len(idx))))
    frame = pd.DataFrame({"period": idx, "t": np.arange(len(idx)), "price": price,
                          "arrivals": rng.uniform(100, 200, len(idx))})
    ctx1 = SeriesContext(frame, frame, 0.05, 0, 0)
    altered = frame.copy()
    altered.loc[20:, "price"] *= 3
    ctx2 = SeriesContext(altered, altered, 0.05, 0, 0)
    pd.testing.assert_frame_equal(ctx1.rows(18, [1, 6, 12]), ctx2.rows(18, [1, 6, 12]))
    rows = training_rows(ctx1)
    assert (rows["target_t"] > rows["origin_t"]).all()
    assert rows["horizon"].between(1, 24).all()
