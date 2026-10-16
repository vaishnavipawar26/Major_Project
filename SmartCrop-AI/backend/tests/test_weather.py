from datetime import date

import pytest

from app.services import weather_service as ws

TODAY = date(2026, 10, 16)


def archive(temp=10.0, hum=60.0, rain_per_day=1.0):
    """Fake archive answer for any window: daily temperature/rain and hourly humidity (with a None to ignore)."""
    def get(start, end):
        n = (date.fromisoformat(end) - date.fromisoformat(start)).days + 1
        return {"daily": {"temperature_2m_mean": [temp] * n + [None], "precipitation_sum": [rain_per_day] * n + [None]},
                "hourly": {"relative_humidity_2m": [hum] * (24 * n) + [None]}}
    return get


@pytest.fixture(autouse=True)
def fresh_cache():
    ws.clear_cache()
    yield
    ws.clear_cache()


def fake(calls=None, answer=None, geo=None):
    answer = answer or archive()

    def get(url, params):
        if calls is not None:
            calls.append((url, params))
        if url == ws.GEOCODE_URL:
            return geo if geo is not None else {"results": [{"latitude": 18.5, "longitude": 73.8, "admin1": "Maharashtra"}]}
        return answer(params["start_date"], params["end_date"])
    return get


# ---------------------------------------------------------------- window logic
def test_months_in_window():
    assert ws.months_in_window(1, 3) == 3
    assert ws.months_in_window(10, 2) == 5     # Oct, Nov, Dec, Jan, Feb
    assert ws.months_in_window(5, 5) == 1


def test_jan_to_mar_uses_the_last_three_completed_seasons():
    assert ws.season_windows(1, 3, TODAY) == [
        (date(2026, 1, 1), date(2026, 3, 31)), (date(2025, 1, 1), date(2025, 3, 31)),
        (date(2024, 1, 1), date(2024, 3, 31))]


def test_oct_to_feb_crosses_the_year_end_and_skips_the_unfinished_season():
    # the season that started Oct 2026 ends Feb 2027 - not finished yet
    assert ws.season_windows(10, 2, TODAY) == [
        (date(2025, 10, 1), date(2026, 2, 28)), (date(2024, 10, 1), date(2025, 2, 28)),
        (date(2023, 10, 1), date(2024, 2, 29))]       # leap-year February


def test_same_month_is_a_one_month_window():
    assert ws.season_windows(6, 6, TODAY)[0] == (date(2026, 6, 1), date(2026, 6, 30))
    assert ws.months_in_window(6, 6) == 1


def test_recent_windows_are_skipped():
    # Sep 2026 ended 16 days ago -> usable; Oct 2026 ends in the future -> skipped
    assert ws.season_windows(9, 9, TODAY)[0] == (date(2026, 9, 1), date(2026, 9, 30))
    assert ws.season_windows(10, 10, TODAY)[0] == (date(2025, 10, 1), date(2025, 10, 31))
    # a window that ended 6 days ago is still too fresh; one that ended 8 days ago is fine
    assert ws.season_windows(10, 10, date(2025, 11, 6))[0][1] == date(2024, 10, 31)
    assert ws.season_windows(10, 10, date(2025, 11, 8))[0][1] == date(2025, 10, 31)


# ---------------------------------------------------------------- averages
def test_averages_across_seasons_rainfall_per_month(monkeypatch):
    monkeypatch.setattr(ws, "_get_json", fake(answer=archive(temp=20.0, hum=55.5, rain_per_day=1.0)))
    out = ws.growing_period_weather("Pune", 10, 2, today=TODAY)
    assert out["temperature"] == 20.0 and out["humidity"] == 55.5      # None values were ignored
    # 150-151 days at 1 mm over 5 months = about 30 mm/month
    assert 29 < out["rainfall"] < 31 and set(out) == {"temperature", "humidity", "rainfall"}


def test_requests_use_daily_temp_rain_and_hourly_humidity(monkeypatch):
    calls = []
    monkeypatch.setattr(ws, "_get_json", fake(calls))
    ws.growing_period_weather("Pune", 10, 2, today=TODAY)
    archive_calls = [p for u, p in calls if u == ws.FREE_ARCHIVE_URL]
    assert len(archive_calls) == 3 and all(
        p["daily"] == "temperature_2m_mean,precipitation_sum" and p["hourly"] == "relative_humidity_2m"
        and p["timezone"] == "auto" and "apikey" not in p for p in archive_calls)
    assert all(u != ws.GEOCODE_URL for u, _ in calls)                  # Pune has stored coordinates


def test_api_key_switches_to_the_customer_endpoint_and_is_not_returned(monkeypatch):
    calls = []
    monkeypatch.setattr(ws, "_get_json", fake(calls))
    monkeypatch.setattr(ws.get_settings(), "OPEN_METEO_API_KEY", "secret-key")
    out = ws.growing_period_weather("Pune", 6, 7, today=TODAY)
    assert {u for u, _ in calls} == {ws.PAID_ARCHIVE_URL}
    assert all(p["apikey"] == "secret-key" for _, p in calls)
    assert "secret-key" not in str(out)


def test_cache_is_keyed_by_city_months_and_day(monkeypatch):
    calls = []
    monkeypatch.setattr(ws, "_get_json", fake(calls))
    ws.growing_period_weather("Pune", 6, 7, today=TODAY)
    n = len(calls)
    ws.growing_period_weather("pune", 6, 7, today=TODAY)
    assert len(calls) == n                                              # cache hit
    ws.growing_period_weather("Pune", 6, 8, today=TODAY)
    assert len(calls) > n                                               # another month -> new request
    n = len(calls)
    ws.growing_period_weather("Pune", 6, 7, today=date(2026, 10, 17))
    assert len(calls) > n                                               # another day -> new request


# ---------------------------------------------------------------- endpoint
def test_endpoint_success(client, user, monkeypatch):
    monkeypatch.setattr(ws, "_get_json", fake())
    r = client.get("/api/weather?city=Pune&planting_month=10&selling_month=2", headers=user["headers"])
    assert r.status_code == 200, r.text
    assert set(r.json()) == {"temperature", "humidity", "rainfall"}


def test_endpoint_needs_login(client):
    assert client.get("/api/weather?city=Pune&planting_month=6&selling_month=7").status_code == 401


@pytest.mark.parametrize("q", ["city=Pune&planting_month=13&selling_month=7", "city=Pune&planting_month=0&selling_month=7",
                               "city=Pune&planting_month=x&selling_month=7", "city=Pune&planting_month=6",
                               "city=&planting_month=6&selling_month=7", "planting_month=6&selling_month=7"])
def test_endpoint_rejects_bad_input_with_400(client, user, q):
    assert client.get(f"/api/weather?{q}", headers=user["headers"]).status_code == 400


def test_upstream_failure_is_502_with_a_plain_message(client, user, monkeypatch):
    def boom(url, params):
        raise ws.WeatherError(502, ws.UNAVAILABLE)
    monkeypatch.setattr(ws, "_get_json", boom)
    r = client.get("/api/weather?city=Pune&planting_month=6&selling_month=7", headers=user["headers"])
    assert r.status_code == 502 and r.json() == {"detail": "Weather data unavailable"}


def test_empty_archive_is_502_and_not_cached(client, user, monkeypatch):
    monkeypatch.setattr(ws, "_get_json", fake(answer=lambda s, e: {"daily": {}, "hourly": {}}))
    q = "/api/weather?city=Pune&planting_month=6&selling_month=7"
    assert client.get(q, headers=user["headers"]).status_code == 502
    monkeypatch.setattr(ws, "_get_json", fake())
    assert client.get(q, headers=user["headers"]).status_code == 200      # a retry works


def test_unknown_city_is_404_and_not_cached(client, user, monkeypatch):
    calls = []
    monkeypatch.setattr(ws, "_get_json", fake(calls, geo={}))
    q = "/api/weather?city=Nowhereville&planting_month=6&selling_month=7"
    for _ in range(2):
        r = client.get(q, headers=user["headers"])
        assert r.status_code == 404 and "Nowhereville" in r.json()["detail"]
    assert [u for u, _ in calls].count(ws.GEOCODE_URL) == 2


def test_renamed_city_uses_stored_coordinates_without_geocoding(client, user, monkeypatch):
    calls = []
    monkeypatch.setattr(ws, "_get_json", fake(calls, geo={}))
    r = client.get("/api/weather?city=Chhatrapati+Sambhajinagar&planting_month=10&selling_month=2", headers=user["headers"])
    assert r.status_code == 200, r.text
    assert ws.GEOCODE_URL not in [u for u, _ in calls]
    assert calls[0][1]["latitude"] == 19.8762 and calls[0][1]["longitude"] == 75.3433


def test_alias_city_not_in_the_data_resolves_through_the_alias_map(monkeypatch):
    asked = []

    def get(url, params):
        if url == ws.GEOCODE_URL:
            asked.append(params["name"])
            if params["name"] == "Gurgaon":
                return {"results": [{"latitude": 28.46, "longitude": 77.03, "admin1": "Haryana"}]}
            return {}
        return archive()(params["start_date"], params["end_date"])
    monkeypatch.setattr(ws, "_get_json", get)
    assert ws.locate("Gurugram") == (28.46, 77.03) and asked == ["Gurugram", "Gurgaon"]


def test_geocoder_prefers_maharashtra(monkeypatch):
    geo = {"results": [{"latitude": 1, "longitude": 1, "admin1": "Kerala"},
                       {"latitude": 2, "longitude": 2, "admin1": "maharashtra"}]}
    monkeypatch.setattr(ws, "_get_json", fake(geo=geo))
    assert ws.locate("Smalltown") == (2.0, 2.0)
