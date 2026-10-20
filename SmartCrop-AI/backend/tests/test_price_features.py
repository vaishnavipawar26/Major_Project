"""Price feature engineering: no leakage, no cross-series mixing, gaps stay gaps."""
import numpy as np
import pandas as pd
import pytest

from app.ml.price_prediction import feature_catalog
from app.ml.price_prediction.features import (FEATURE_COLUMNS, SERIES_KEY, compute_features,
                                              target_log_change, usable_origin_mask)
from app.ml.price_prediction.forecaster import ModelSchemaError

ENC = {"commodity": {"Onion": 0, "Tomato": 1}, "market": {"M1": 0, "M2": 1}, "variety": {"V": 0}}


def series(market, commodity, n=120, seed=1, start="2025-01-01", level=1500.0):
    rng = np.random.default_rng(seed)
    d = pd.date_range(start, periods=n, freq="D")
    price = level * np.exp(np.cumsum(rng.normal(0, 0.02, n)))
    return pd.DataFrame({"Date": d, "State": "S", "Market": market, "Commodity": commodity, "Variety": "V",
                         "observed": True, "price": price, "price_ffill": price,
                         "arrivals": rng.uniform(5, 50, n), "spread": 0.3, "state_price": price * 1.01})


def feats(panel, **kw):
    return compute_features(panel, ENC, **kw)


def row(f, market, commodity, day):
    return f[(f["Market"] == market) & (f["Commodity"] == commodity) & (f["Date"] == pd.Timestamp(day))].iloc[0]


def test_features_at_t_do_not_depend_on_later_prices_or_arrivals():
    p = series("M1", "Onion")
    base = feats(p, with_targets=True)
    t = pd.Timestamp("2025-03-15")
    changed = p.copy()
    later = changed["Date"] > t
    changed.loc[later, ["price", "price_ffill", "arrivals", "state_price"]] = 99999.0
    f2 = feats(changed, with_targets=True)
    a, b = row(base, "M1", "Onion", t), row(f2, "M1", "Onion", t)
    pd.testing.assert_series_equal(a[FEATURE_COLUMNS], b[FEATURE_COLUMNS])
    # ...while the label (a future price) does change, proving the test can detect leakage
    assert target_log_change(base, 5).loc[base["Date"] == t].iloc[0] != target_log_change(f2, 5).loc[f2["Date"] == t].iloc[0]


def test_target_price_column_never_feeds_features():
    p = series("M1", "Onion")
    with_t, without_t = feats(p, with_targets=True), feats(p, with_targets=False)
    pd.testing.assert_frame_equal(with_t[FEATURE_COLUMNS], without_t[FEATURE_COLUMNS])


def test_rolling_features_never_mix_series():
    a, b = series("M1", "Onion", seed=1), series("M2", "Tomato", seed=2, level=900.0)
    both = feats(pd.concat([a, b], ignore_index=True))
    alone = feats(a)
    for day in ("2025-02-10", "2025-04-20"):
        x, y = row(both, "M1", "Onion", day), row(alone, "M1", "Onion", day)
        pd.testing.assert_series_equal(x[FEATURE_COLUMNS], y[FEATURE_COLUMNS])
    # the first rows of the second series must not borrow history from the end of the first
    first = both[(both["Market"] == "M2")].iloc[0]
    assert np.isnan(first["lag_30_change"]) and np.isnan(first["volatility_30"])


def test_long_gaps_stay_missing_and_block_forecast_origins():
    p = series("M1", "Onion")
    gap = p["Date"].between("2025-02-01", "2025-02-20")     # 20 days without reports
    p.loc[gap, ["observed"]] = False
    p.loc[gap, ["price", "price_ffill", "arrivals", "spread"]] = np.nan
    p.loc[p["Date"] > "2025-02-20", "price_ffill"] = p["price"]
    p["price_ffill"] = p["price"].ffill(limit=7)
    f = feats(p)
    mask = usable_origin_mask(f)
    inside = f["Date"].between("2025-02-09", "2025-02-20")  # beyond the 7-day carry-forward
    assert not mask[inside].any()
    assert f.loc[inside, "log_price"].isna().all()           # nothing was invented for the gap
    # a lag feature needs the price exactly k days earlier: where that day is inside the unfilled
    # gap (Feb 9-20) the feature is NaN, so 30 days later (Mar 11-22) no origin is usable
    assert f.loc[f["Date"].between("2025-03-11", "2025-03-22"), "lag_30_change"].isna().all()
    assert not mask[f["Date"].between("2025-03-11", "2025-03-22")].any()
    assert mask[f["Date"].between("2025-04-01", "2025-04-30")].all()       # fully recovered afterwards


def test_every_model_input_is_documented():
    assert feature_catalog.undocumented() == []
    md = feature_catalog.markdown()
    assert "temp_mean_7" in md and "target_doy_sin" in md


def test_model_schema_mismatch_is_refused(client, monkeypatch):
    fc = client.app.state.registry.price
    fc._check_schema()    # the shipped artifacts are consistent
    monkeypatch.setattr(fc, "feature_columns", fc.feature_columns[:-1])
    with pytest.raises(ModelSchemaError):
        fc._check_schema()
