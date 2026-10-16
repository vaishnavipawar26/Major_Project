import pytest

from app.services import weather_service as ws


def _daily():
    """Two years of fake daily data: Jun-Jul only matters. 10 °C, 60 %, 1 mm/day in June, 2 mm/day in July."""
    days, t, h, p = [], [], [], []
    for y in (2023, 2024, 2025):
        for m, mm in ((6, 1.0), (7, 2.0), (12, 9.0)):
            for d in range(1, 11):
                days.append(f"{y}-{m:02d}-{d:02d}")
                t.append(10.0 if m != 12 else 99.0)
                h.append(60.0 if m != 12 else 99.0)
                p.append(mm)
    return {"daily": {"time": days, "temperature_2m_mean": t, "relative_humidity_2m_mean": h, "precipitation_sum": p}}


@pytest.fixture(autouse=True)
def fresh_cache():
    ws.clear_cache()
    yield
    ws.clear_cache()


def fake(calls=None, geo=None, archive=None):
    def get(url, params):
        if calls is not None:
            calls.append(url)
        if url == ws.GEOCODE_URL:
            return geo if geo is not None else {"results": [{"name": "Pune", "latitude": 18.5, "longitude": 73.8, "admin1": "Maharashtra"}]}
        return archive if archive is not None else _daily()
    return get


def test_growing_months_wraps_the_new_year():
    assert ws.growing_months(6, 8) == [6, 7, 8]
    assert ws.growing_months(11, 2) == [11, 12, 1, 2]
    assert ws.growing_months(5, 5) == [5]


def test_weather_success_and_cache(client, user, monkeypatch):
    calls = []
    monkeypatch.setattr(ws, "_get_json", fake(calls))
    q = "/api/weather?city=Pune&state=Maharashtra&plantMonth=6&sellMonth=7"
    r = client.get(q, headers=user["headers"])
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["lat"] == 18.5204 and b["lon"] == 73.8567    # stored coordinates
    assert b["city"] == "Pune" and b["source"] == "Open-Meteo" and b["monthsUsed"] == [6, 7]
    assert b["avgTemperature"] == 10.0 and b["avgHumidity"] == 60.0
    assert b["avgRainfall"] == 15.0   # (10 x 1 mm + 10 x 2 mm) / 2 months, the same every year
    assert set(b) == {"city", "lat", "lon", "avgTemperature", "avgHumidity", "avgRainfall", "source", "monthsUsed"}
    client.get(q, headers=user["headers"])
    assert calls == [ws.ARCHIVE_URL]    # no geocoding for a stored city; the second request came from the cache


def test_weather_needs_login(client):
    assert client.get("/api/weather?city=Pune&plantMonth=6&sellMonth=7").status_code == 401


def test_weather_rejects_bad_months(client, user):
    r = client.get("/api/weather?city=Pune&plantMonth=13&sellMonth=7", headers=user["headers"])
    assert r.status_code == 422


def test_unknown_city(client, user, monkeypatch):
    monkeypatch.setattr(ws, "_get_json", fake(geo={}))
    r = client.get("/api/weather?city=Nowhereville&plantMonth=6&sellMonth=7", headers=user["headers"])
    assert r.status_code == 404 and "Nowhereville" in r.json()["detail"]


def test_weather_api_failure(client, user, monkeypatch):
    def boom(url, params):
        raise ws.WeatherError(504, "The weather service took too long to answer. Please try again.")
    monkeypatch.setattr(ws, "_get_json", boom)
    r = client.get("/api/weather?city=Pune&plantMonth=6&sellMonth=7", headers=user["headers"])
    assert r.status_code == 504 and "too long" in r.json()["detail"]


def test_empty_archive_is_a_clear_error(client, user, monkeypatch):
    monkeypatch.setattr(ws, "_get_json", fake(archive={"daily": {}}))
    r = client.get("/api/weather?city=Pune&plantMonth=6&sellMonth=7", headers=user["headers"])
    assert r.status_code == 502


def test_renamed_city_uses_stored_coordinates_without_geocoding(client, user, monkeypatch):
    calls = []
    monkeypatch.setattr(ws, "_get_json", fake(calls, geo={}))   # the geocoder would find nothing
    r = client.get("/api/weather?city=Chhatrapati+Sambhajinagar&state=Maharashtra&plantMonth=10&sellMonth=2",
                   headers=user["headers"])
    assert r.status_code == 200, r.text
    b = r.json()
    assert (b["lat"], b["lon"]) == (19.8762, 75.3433) and b["monthsUsed"] == [10, 11, 12, 1, 2]
    assert ws.GEOCODE_URL not in calls


def test_alias_city_not_in_the_data_resolves_through_the_alias_map(client, user, monkeypatch):
    asked = []

    def get(url, params):
        if url == ws.GEOCODE_URL:
            asked.append(params["name"])
            if params["name"] == "Gurgaon":
                return {"results": [{"name": "Gurgaon", "latitude": 28.46, "longitude": 77.03, "admin1": "Haryana"}]}
            return {}
        return _daily()
    monkeypatch.setattr(ws, "_get_json", get)
    r = client.get("/api/weather?city=Gurugram&state=Haryana&plantMonth=6&sellMonth=7", headers=user["headers"])
    assert r.status_code == 200, r.text
    assert asked == ["Gurugram", "Gurgaon"] and r.json()["lat"] == 28.46


def test_geocoder_prefers_the_selected_state(monkeypatch):
    geo = {"results": [{"name": "X", "latitude": 1, "longitude": 1, "admin1": "Kerala"},
                       {"name": "X", "latitude": 2, "longitude": 2, "admin1": "maharashtra"}]}
    monkeypatch.setattr(ws, "_get_json", fake(geo=geo))
    assert ws.locate("Smalltown", "Maharashtra")[:2] == (2.0, 2.0)


def test_unknown_city_is_not_cached(client, user, monkeypatch):
    calls = []
    monkeypatch.setattr(ws, "_get_json", fake(calls, geo={}))
    q = "/api/weather?city=Nowhereville&plantMonth=6&sellMonth=7"
    for _ in range(2):
        r = client.get(q, headers=user["headers"])
        assert r.status_code == 404 and "enter weather manually" in r.json()["detail"]
    assert calls.count(ws.GEOCODE_URL) == 2    # asked again: nothing was cached


def test_provider_failure_is_not_cached(client, user, monkeypatch):
    state = {"fail": True}

    def get(url, params):
        if state["fail"]:
            raise ws.WeatherError(504, "The weather service took too long to answer. Please try again.")
        return _daily()
    monkeypatch.setattr(ws, "_get_json", get)
    q = "/api/weather?city=Pune&plantMonth=6&sellMonth=7"
    assert client.get(q, headers=user["headers"]).status_code == 504
    state["fail"] = False
    assert client.get(q, headers=user["headers"]).status_code == 200    # Retry works
