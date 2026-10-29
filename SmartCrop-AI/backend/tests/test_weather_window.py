"""The 60-day weather window shown beside the price forecast: live forecast days only as far as the provider reaches, typical values for
the time of year (labelled, never called a forecast) after that, and no value at all where neither exists. Providers are replaced by
labelled synthetic fixtures (conftest.py keeps every test offline)."""
import datetime as dt

import pytest

from app.services import http_client
from app.services import price_weather_service as pw

TODAY = dt.date(2026, 10, 27)
MARKET = "Pune(Khadiki)"      # a mapped market with stored daily weather


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch):
    monkeypatch.setattr(pw, "today", lambda: TODAY)


def _provider(calls, missing=()):
    """Synthetic forecast service: one value per requested day (``missing`` days come back empty, as the real service may)."""
    def get(url, params=None, timeout=None, verify=None):
        calls.append((url, params["start_date"], params["end_date"]))
        d0, d1 = dt.date.fromisoformat(params["start_date"]), dt.date.fromisoformat(params["end_date"])
        days = [d0 + dt.timedelta(days=i) for i in range((d1 - d0).days + 1)]
        none = lambda d: d.isoformat() in missing   # noqa: E731

        class R:
            status_code = 200
            def json(self):
                return {"daily": {"time": [d.isoformat() for d in days],
                                  "temperature_2m_mean": [None if none(d) else 24.0 for d in days],
                                  "precipitation_sum": [None if none(d) else 1.5 for d in days],
                                  "relative_humidity_2m_mean": [None if none(d) else 70 for d in days]}}
        return R()
    return get


def _use(monkeypatch, get):
    monkeypatch.setattr(http_client.httpx, "get", get)


def test_sixty_consecutive_days_live_only_within_the_provider_limit_then_typical(monkeypatch):
    calls = []
    _use(monkeypatch, _provider(calls))
    w = pw.weather_window(MARKET, TODAY)
    ds = [dt.date.fromisoformat(e["date"]) for e in w["entries"]]
    assert ds == [TODAY + dt.timedelta(days=n) for n in range(1, 61)]
    assert len(calls) == 1                                                    # one request covers every live day
    assert calls[0][1:] == ((TODAY + dt.timedelta(days=1)).isoformat(), (TODAY + dt.timedelta(days=pw.FORECAST_DAYS)).isoformat())
    for e in w["entries"]:
        ahead = (dt.date.fromisoformat(e["date"]) - TODAY).days
        if ahead <= pw.FORECAST_DAYS:
            assert e["status"] == "forecast" and e["source"] == "Open-Meteo weather forecast", e
        else:                                                                 # never called a forecast past the provider's reach
            assert e["status"] in ("typical", "unavailable"), e
            if e["status"] == "typical":
                assert e["source"].startswith("Stored market weather, same time of year") and e["temperature_c"] is not None
    assert w["counts"]["forecast"] == pw.FORECAST_DAYS and sum(w["counts"].values()) == 60
    assert w["counts"]["typical"] > 0 and "not a forecast" in w["note"]


def test_typical_values_are_the_stored_same_time_of_year_means_not_a_repeated_last_value(monkeypatch):
    _use(monkeypatch, _provider([]))
    w = pw.weather_window(MARKET, TODAY)
    typ = [e for e in w["entries"] if e["status"] == "typical"]
    for e in typ[:5]:
        ref = pw._typical(MARKET, dt.date.fromisoformat(e["date"]))
        assert (e["temperature_c"], e["rainfall_mm"], e["humidity_pct"]) == (ref["temperature_c"], ref["rainfall_mm"], ref["humidity_pct"])
    live_last = [e for e in w["entries"] if e["status"] == "forecast"][-1]
    assert not all(e["temperature_c"] == live_last["temperature_c"] for e in typ)   # not the last live value carried forward


def test_a_day_the_provider_leaves_empty_is_not_filled_with_a_live_value(monkeypatch):
    gap = (TODAY + dt.timedelta(days=4)).isoformat()
    _use(monkeypatch, _provider([], missing={gap}))
    e = next(e for e in pw.weather_window(MARKET, TODAY)["entries"] if e["date"] == gap)
    assert e["status"] != "forecast"


def test_provider_down_means_no_live_days_and_says_why():
    w = pw.weather_window(MARKET, TODAY)          # conftest: every outside request fails
    assert w["counts"]["forecast"] == 0 and w["reason"] == "service_unreachable"
    assert all(e["status"] in ("typical", "unavailable") for e in w["entries"])


def test_unavailable_days_carry_no_values(monkeypatch):
    _use(monkeypatch, _provider([]))
    for w in (pw.weather_window("All markets (state median)", TODAY), pw.weather_window("No Such Market", TODAY)):
        assert w["counts"] == {"forecast": 0, "typical": 0, "unavailable": 60} and w["reason"]
        assert all(e["temperature_c"] is None and e["rainfall_mm"] is None and e["humidity_pct"] is None for e in w["entries"])


def test_growing_location_gets_live_days_but_no_typical_values(monkeypatch):
    _use(monkeypatch, _provider([]))
    w = pw.weather_window(MARKET, TODAY, {"label": "Some village", "latitude": 18.9, "longitude": 74.1})
    assert w["counts"] == {"forecast": pw.FORECAST_DAYS, "typical": 0, "unavailable": 60 - pw.FORECAST_DAYS}
    assert w["place_kind"] == "growing_location"


def test_a_window_entirely_past_the_provider_limit_makes_no_request(monkeypatch):
    calls = []
    _use(monkeypatch, _provider(calls))
    w = pw.weather_window(MARKET, TODAY + dt.timedelta(days=30))
    assert calls == [] and w["counts"]["forecast"] == 0


def test_weather_window_endpoint(client, user, monkeypatch):
    _use(monkeypatch, _provider([]))
    r = client.get("/api/price-prediction/weather-window", headers=user["headers"], params={"market": MARKET, "start_date": TODAY.isoformat()})
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["entries"]) == 60 and body["forecast_limit_days"] == pw.FORECAST_DAYS
