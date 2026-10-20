"""Weather feature pipeline: leakage, missing data and API failure handling (no network)."""
import numpy as np
import pandas as pd
import pytest

from app.ml.price_prediction import weather_features as wf


def make_weather(markets=("A", "B"), start="2015-01-01", end="2025-12-31", seed=0):
    rng = np.random.default_rng(seed)
    dates = pd.date_range(start, end, freq="D")
    frames = []
    for m in markets:
        doy = dates.dayofyear.to_numpy()
        frames.append(pd.DataFrame({
            "market": m, "date": dates,
            "temperature_mean": 26 + 5 * np.sin(2 * np.pi * doy / 365) + rng.normal(0, 1, len(dates)),
            "precipitation": np.where(rng.random(len(dates)) < 0.2, rng.gamma(2, 6, len(dates)), 0.0),
            "relative_humidity": 60 + rng.normal(0, 8, len(dates))}))
    return pd.concat(frames, ignore_index=True)


@pytest.fixture(scope="module")
def weather():
    return make_weather()


@pytest.fixture(scope="module")
def feats(weather):
    return wf.build_weather_features(wf.add_state_series(weather))


def at(f, market, day):
    return f[(f["market"] == market) & (f["date"] == pd.Timestamp(day))][wf.WEATHER_FEATURES].iloc[0]


def test_features_at_a_date_ignore_all_later_weather(weather, feats):
    day = pd.Timestamp("2025-06-15")
    changed = weather.copy()
    later = changed["date"] > day
    changed.loc[later, ["temperature_mean", "precipitation", "relative_humidity"]] = [99.0, 500.0, 1.0]
    f2 = wf.build_weather_features(wf.add_state_series(changed))
    pd.testing.assert_series_equal(at(feats, "A", day), at(f2, "A", day))
    assert not at(feats, "A", day + pd.Timedelta(days=3)).equals(at(f2, "A", day + pd.Timedelta(days=3)))


def test_normals_use_only_years_up_to_climatology_end(weather, feats):
    changed = weather.copy()
    recent = changed["date"].dt.year > wf.CLIMATOLOGY_END_YEAR
    changed.loc[recent, "temperature_mean"] += 10.0       # a 3-year heat wave in the price period
    f2 = wf.build_weather_features(wf.add_state_series(changed))
    day = "2024-07-10"
    a, b = at(feats, "A", day), at(f2, "A", day)
    assert b["temp_mean_7"] - a["temp_mean_7"] == pytest.approx(10.0, abs=1e-3)
    assert b["temp_anom_7"] - a["temp_anom_7"] == pytest.approx(10.0, abs=1e-3)   # normals unchanged


def test_gaps_stay_missing_not_zero(weather):
    w = weather[weather["market"] == "A"].copy()
    w = w[~w["date"].between("2024-03-01", "2024-03-20")]            # 20 missing days
    f = wf.build_weather_features(wf.add_state_series(w))
    inside = at(f, "A", "2024-03-10")
    assert inside.isna().all()                                        # no value invented for the gap
    assert at(f, "A", "2024-03-25")["precip_sum_30"] != 0 or np.isnan(at(f, "A", "2024-03-25")["precip_sum_30"])
    assert np.isnan(at(f, "A", "2024-03-25")["precip_sum_30"])         # window still touches the gap
    assert not np.isnan(at(f, "A", "2024-05-25")["precip_sum_30"])


def test_state_series_is_mean_of_markets(weather, feats):
    d = pd.Timestamp("2025-02-01")
    a = weather[(weather["market"] == "A") & (weather["date"] == d)]["temperature_mean"].iloc[0]
    b = weather[(weather["market"] == "B") & (weather["date"] == d)]["temperature_mean"].iloc[0]
    st = wf.add_state_series(weather)
    got = st[(st["market"] == wf.STATE_MARKET) & (st["date"] == d)]["temperature_mean"].iloc[0]
    assert got == pytest.approx((a + b) / 2)


def test_attach_leaves_nan_for_unmapped_markets_and_without_table(feats):
    prices = pd.DataFrame({"Market": ["A", "Unmapped"], "Date": [pd.Timestamp("2025-06-15")] * 2})
    out = wf.attach(prices, feats)
    assert out.loc[0, wf.WEATHER_FEATURES].notna().all()
    assert out.loc[1, wf.WEATHER_FEATURES].isna().all()              # never zero-filled
    none = wf.attach(prices, None)
    assert none[wf.WEATHER_FEATURES].isna().all().all()
    assert len(out) == len(prices)


def test_town_name_cleaning():
    from scripts.build_market_locations import town_name
    assert town_name("APMC Rahata") == "Rahata"
    assert town_name("Pune(Manjri)") == "Pune"
    assert town_name("APMC Nasik") == "Nashik"
    assert town_name("Amrawati(Frui & Veg. Market)") == "Amravati"


class FakeResp:
    def __init__(self, status, payload=None, text=""):
        self.status_code, self._p, self.text = status, payload, text

    def json(self):
        return self._p


class FakeClient:
    def __init__(self, *responses):
        self.responses, self.calls = list(responses), 0

    def get(self, url, params=None):
        self.calls += 1
        return self.responses.pop(0)


def test_fetch_location_retries_then_raises_on_daily_limit(monkeypatch):
    from scripts import fetch_price_weather as fw
    monkeypatch.setattr(fw.time, "sleep", lambda s: None)
    ok = {"latitude": 19.0, "longitude": 75.0, "daily": {
        "time": ["2025-01-01"], "temperature_2m_mean": [25.0], "precipitation_sum": [None],
        "relative_humidity_2m_mean": [50]}}
    c = FakeClient(FakeResp(500), FakeResp(200, ok))
    d = fw.fetch_location(c, 19.0, 75.0)
    assert c.calls == 2 and np.isnan(d["precipitation"].iloc[0])      # None -> NaN, not 0
    with pytest.raises(RuntimeError, match="daily request limit"):
        fw.fetch_location(FakeClient(FakeResp(429, text='{"reason":"Daily API request limit exceeded"}')), 1, 1)
