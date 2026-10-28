"""Weather / soil as model inputs: the soil feature table never invents values, and the API reports only inputs the loaded model really has."""
import numpy as np
import pandas as pd
import pytest

from app.ml.price_prediction import soil_features
from app.ml.price_prediction.forecaster import PriceForecaster
from app.ml.price_prediction.weather_features import WEATHER_FEATURES, attach, build_weather_features


def test_soil_table_missing_gives_nan_not_a_default(tmp_path):
    assert soil_features.load(tmp_path / "nope.csv") is None
    out = soil_features.attach(pd.DataFrame({"Market": ["APMC Pune"]}), None)
    assert out[soil_features.SOIL_FEATURES].isna().all(axis=None)


def test_soil_values_come_only_from_the_table_and_unknown_markets_stay_nan():
    table = pd.DataFrame({"market": ["APMC Pune", "APMC Nashik"], "soil_ph": [6.8, np.nan], "soil_class": ["Vertisols", None]})
    out = soil_features.attach(pd.DataFrame({"Market": ["APMC Pune", "APMC Nashik", "APMC Unknown"]}), table)
    assert out["soil_ph"].iloc[0] == pytest.approx(6.8)
    assert out["soil_ph"].iloc[1:].isna().all()              # a missing pH is never replaced by an average
    assert out["soil_class_code"].iloc[0] == 0 and out["soil_class_code"].iloc[1:].isna().all()


def test_weather_features_use_only_days_up_to_the_origin():
    days = pd.date_range("2022-01-01", periods=800)   # normals need years <= 2022; the "future" starts after 2024-02-10
    w = pd.DataFrame({"market": "M", "date": days, "temperature_mean": 20.0, "precipitation": 1.0, "relative_humidity": 50.0})
    old = build_weather_features(w)
    w2 = w.copy()
    w2.loc[w2["date"] > "2024-02-10", ["temperature_mean", "precipitation", "relative_humidity"]] = 99.0   # "future" days
    new = build_weather_features(w2)
    cut = old["date"] <= "2024-02-10"
    pd.testing.assert_frame_equal(old[cut].reset_index(drop=True), new[new["date"] <= "2024-02-10"].reset_index(drop=True))


def test_missing_weather_leaves_nan_never_zero():
    out = attach(pd.DataFrame({"Market": ["X"], "Date": [pd.Timestamp("2025-01-01")]}), None)
    assert out[WEATHER_FEATURES].isna().all(axis=None)


@pytest.fixture(scope="module")
def forecaster():
    return PriceForecaster()


def test_model_inputs_follow_the_loaded_feature_list(forecaster, monkeypatch):
    now = forecaster.model_inputs()
    assert now["season"] and now["crop_market"] and now["growing_location"] is False
    assert now["temperature"] == any(f in forecaster.feature_columns for f in ("temp_mean_7", "temp_anom_7"))
    monkeypatch.setattr(forecaster, "feature_columns", [*forecaster.feature_columns, "temp_mean_7", "soil_ph"])
    changed = forecaster.model_inputs()
    assert changed["temperature"] and changed["soil_ph"] and not changed["soil_type"] and not changed["rainfall"]
    assert changed["growing_location"] is False and changed["weather_soil_scope"] == "selling_market_town"
