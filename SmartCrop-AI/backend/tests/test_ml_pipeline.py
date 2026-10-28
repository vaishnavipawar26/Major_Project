"""Unit tests for the ML pipeline that do not need the API."""
import numpy as np
import pandas as pd
import pytest

from app.ml.common.seasons import season_for_month
from app.ml.price_prediction.features import (FEATURE_COLUMNS, build_daily_panel,
                                              compute_features, fit_encoders,
                                              target_log_change, with_pair_features)
from app.ml.price_prediction.selling_advice import best_time_to_sell
from app.ml.price_prediction.preprocessing import clean_prices


def _raw(n_days=80, seed=0):
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2024-01-01", periods=n_days, freq="D")
    price = 1000 * np.exp(np.cumsum(rng.normal(0, 0.02, n_days)))
    return pd.DataFrame({"Date": dates.strftime("%Y-%m-%d"), "State": "Maharashtra",
                         "Market": "APMC Test", "Commodity": "onion", "Variety": "Red",
                         "Arrivals": rng.uniform(10, 50, n_days), "Min_Price": price * 0.8,
                         "Max_Price": price * 1.2, "Modal_Price": price,
                         "source_file": "synthetic_unit_test.csv"})


def test_features_do_not_use_future_data():
    raw = _raw()
    clean, _ = clean_prices(raw)
    panel = build_daily_panel(clean)
    enc = fit_encoders(panel)
    f1 = compute_features(panel, enc, with_targets=False)

    raw2 = raw.copy()
    raw2.loc[60:, "Modal_Price"] *= 5  # change only the future
    raw2.loc[60:, "Max_Price"] *= 5
    raw2.loc[60:, "Min_Price"] *= 5
    clean2, _ = clean_prices(raw2)
    f2 = compute_features(build_daily_panel(clean2), enc, with_targets=False)

    cut = pd.Timestamp("2024-01-01") + pd.Timedelta(days=59)
    a = f1[f1["Date"] <= cut].reset_index(drop=True)[FEATURE_COLUMNS]
    b = f2[f2["Date"] <= cut].reset_index(drop=True)[FEATURE_COLUMNS]
    pd.testing.assert_frame_equal(a, b)


def test_targets_look_forward_exactly_h_days():
    clean, _ = clean_prices(_raw())
    panel = build_daily_panel(clean)
    f = compute_features(panel, fit_encoders(panel))
    s = f[f["Market"] == "APMC Test"].reset_index(drop=True)
    i = 10
    for h in (1, 7, 23):
        expected = np.log(s.loc[i + h, "price"]) - np.log(s.loc[i, "price"])
        assert target_log_change(s, h).loc[i] == pytest.approx(expected)


def test_pair_features_keep_origin_inputs_and_add_target_day():
    clean, _ = clean_prices(_raw())
    panel = build_daily_panel(clean)
    f = compute_features(panel, fit_encoders(panel), with_targets=False)
    origin = f[f["Market"] == "APMC Test"].iloc[[50]]
    X = with_pair_features(pd.concat([origin] * 3), np.array([1, 10, 60]))
    assert list(X["horizon_days"]) == [1, 10, 60]
    # the origin's (past-only) features are identical for every horizon
    assert (X[FEATURE_COLUMNS].nunique(dropna=False) <= 1).all()
    doy = (origin["Date"].iloc[0] + pd.Timedelta(days=10)).dayofyear
    assert X["target_doy_sin"].iloc[1] == pytest.approx(np.sin(2 * np.pi * doy / 365.25), abs=1e-6)


def test_duplicate_days_are_merged_not_dropped():
    raw = _raw(40)
    dup = raw.iloc[[5]].copy()
    dup["Modal_Price"] = dup["Modal_Price"] * 1.1
    clean, log = clean_prices(pd.concat([raw, dup], ignore_index=True))
    assert len(clean) == 40
    step = next(s for s in log.steps if s["step"] == "same_day_duplicates")
    assert step["rows_affected"] == 2


def test_isolated_spike_is_capped_but_kept():
    raw = _raw(40)
    raw.loc[30, "Modal_Price"] *= 20
    raw.loc[30, "Max_Price"] *= 20
    clean, _ = clean_prices(raw)
    assert len(clean) == 40
    row = clean.iloc[30]
    assert row["outlier_capped"] and row["Modal_Price"] < row["Modal_Price_raw"]


def test_season_mapping():
    assert season_for_month(7) == "Kharif"
    assert season_for_month(11) == "Rabi"
    assert season_for_month(4) == "Zaid"
    with pytest.raises(ValueError):
        season_for_month(13)


def _path(prices, band=0.05, reliable=True):
    return [{"horizon_days": h, "date": f"2026-10-{10 + h:02d}", "predicted_price": p,
             "lower": p * 0.9, "upper": p * 1.1, "beats_baseline": reliable, "_band": band}
            for h, p in enumerate(prices, start=1)]


def test_advice_waits_for_a_clearly_higher_later_price():
    # target day 3 = 1000; day 6 = 1200 (+18%, well above the 5% typical error)
    a = best_time_to_sell(_path([1000, 1000, 1000, 1100, 1150, 1200, 1100]), 3,
                          "Onion", projected=False)
    assert a["code"] == "WAIT" and a["recommended_date"] == "2026-10-16"
    assert a["wait_days"] == 3 and a["extra_per_quintal"] == 200
    assert a["extra_pct"] == pytest.approx(20.0)


def test_advice_ignores_differences_within_model_error():
    a = best_time_to_sell(_path([1000, 1010, 1020, 1030]), 2, "Onion", projected=False)
    assert a["code"] == "NO_CLEAR_DIFFERENCE" and a["recommended_date"] == a["target_date"]
    assert a["extra_per_quintal"] == 0 and a["peak"]["date"] == "2026-10-14"


def test_advice_reports_but_never_recommends_a_higher_earlier_price():
    a = best_time_to_sell(_path([1000, 900, 800, 750]), 3, "Onion", projected=False)
    assert a["code"] == "SELL_ON_TARGET" and a["recommended_horizon_days"] == 3
    assert a["best_before"]["date"] == "2026-10-11" and a["wait_days"] == 0
    assert a["falls_after_target"]


def test_advice_respects_storage_limit_of_perishable_crops():
    # tomato: later dates are only considered up to 14 days after the target (the longest any storage keeps it, see crop_storage.py)
    prices = [1000] * 3 + [1000] * 14 + [2000]
    a = best_time_to_sell(_path(prices), 3, "Tomato", projected=False)
    assert a["code"] != "WAIT"
    assert best_time_to_sell(_path(prices), 3, "Onion", projected=False)["code"] == "WAIT"


def test_advice_unvalidated_target_gives_no_comparison():
    a = best_time_to_sell(_path([1000, 1500, 2000], reliable=False), 2, "Onion",
                          projected=False)
    assert a["code"] == "UNAVAILABLE" and a["recommended_date"] == a["target_date"]
