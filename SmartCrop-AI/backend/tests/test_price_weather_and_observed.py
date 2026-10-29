"""Environmental factors for the price page (weather, soil-map estimates, growing location), their persistent store in the database, and
the real-price history. Providers are replaced by labelled fixtures (conftest.py keeps every test offline)."""
import datetime as dt

import pandas as pd
import pytest
from sqlalchemy import delete, func, select

from app.database.base import Base
from app.database.connection import SessionLocal, engine
from app.ml.common import paths
from app.models.environmental_record import EnvironmentalRecord
from app.services import environment_store as store
from app.services import http_client
from app.services import price_weather_service as pw
from app.services.price_weather_service import environmental_factors, soil_context, weather_context

TODAY = dt.date(2026, 10, 27)


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    """Every test starts with the table present and empty, and a fixed 'today'."""
    Base.metadata.create_all(engine, tables=[EnvironmentalRecord.__table__])
    with SessionLocal() as s:
        s.execute(delete(EnvironmentalRecord))
        s.commit()
    monkeypatch.setattr(pw, "today", lambda: TODAY)
    yield


def _resp(status=200, body=None):
    class R:
        status_code = status
        def json(self): return body
    return R()


def _fake_weather(calls, values=(25.0, 0.0, 60)):      # synthetic values
    def get(url, params=None, timeout=None, verify=None):
        calls.append(url)
        return _resp(body={"daily": {"temperature_2m_mean": [values[0]], "precipitation_sum": [values[1]], "relative_humidity_2m_mean": [values[2]]}})
    return get


def _fake_soil(ph_value, cls_name, fail=False, calls=None):   # synthetic values
    def get(url, params=None, timeout=None, verify=None):
        if calls is not None:
            calls.append(url)
        if fail:
            raise http_client.httpx.ConnectTimeout("boom")
        if "classification" in url:
            return _resp(body={"wrb_class_name": cls_name})
        return _resp(body={"properties": {"layers": [{"unit_measure": {"d_factor": 10}, "depths": [{"values": {"mean": ph_value}}]}]}})
    return get


def _offline(monkeypatch):
    def off(*a, **k):
        raise http_client.httpx.ConnectError("offline")
    monkeypatch.setattr(http_client.httpx, "get", off)


def _rows(**where):
    with SessionLocal() as s:
        q = select(func.count()).select_from(EnvironmentalRecord)
        for k, v in where.items():
            q = q.where(getattr(EnvironmentalRecord, k) == v)
        return s.execute(q).scalar()


def _expire(record_type, data_type):
    with SessionLocal() as s:
        for r in s.execute(select(EnvironmentalRecord).where(EnvironmentalRecord.record_type == record_type,
                                                             EnvironmentalRecord.data_type == data_type)).scalars():
            r.expires_at = dt.datetime(2000, 1, 1)
        s.commit()


# ------------------------------------------------------------------------------------------------ places and validation
def test_unmapped_ambiguous_and_state_series_are_unavailable_with_a_clear_reason():
    assert weather_context("All markets (state median)", TODAY)["reason"] == "state_series"
    r = weather_context("No Such Market", TODAY)
    assert (r["status"], r["reason"], r["temperature_c"]) == ("unavailable", "no_coordinates", None)
    assert soil_context("No Such Market")["reason"] == "no_coordinates"
    amb = weather_context("APMC Vani", TODAY)                 # rejected on review: two different towns share the name
    assert (amb["status"], amb["reason"]) == ("unavailable", "ambiguous_location")
    assert "more than one town" in amb["note"]


def test_reviewed_second_geocoding_pass_adds_markets_and_rejected_matches_stay_unmapped():
    assert pw._place("APMC Akkalkot") is not None          # found only by the second pass (GeoNames spells it Akalkot)
    assert pw._place("APMC Manora") is None                # wrong town on review (Manor, Palghar): rejected
    assert pw._place("Pune(Khadiki)") is not None          # first-pass markets unchanged


def test_markets_in_the_projects_own_cities_use_the_documented_city_coordinates():
    # GeoNames has no entry for renamed cities such as Ahilyanagar (formerly Ahmednagar); the project's city_coordinates.csv does
    cities = pd.read_csv(paths.CROP_REC_DIR / "city_coordinates.csv").set_index("city")
    for market, city in [("APMC Ahilyanagar", "Ahilyanagar"), ("APMC Dharashiv", "Dharashiv"), ("APMC Satara", "Satara")]:
        lat, lon, name = pw._place(market)
        assert (lat, lon, name) == (cities.loc[city, "latitude"], cities.loc[city, "longitude"], city)


# ------------------------------------------------------------------------------------------------ weather by date
def test_forecast_within_range_and_history_for_past_dates_are_kept_apart(monkeypatch):
    calls = []
    monkeypatch.setattr(http_client.httpx, "get", _fake_weather(calls))
    f = weather_context("Pune(Khadiki)", TODAY + dt.timedelta(days=3))
    o = weather_context("Pune(Khadiki)", dt.date(2025, 10, 29))
    assert (f["status"], f["served_from"], f["source"]) == ("forecast", "live", "Open-Meteo weather forecast")
    assert (o["status"], o["served_from"], o["source"]) == ("observed", "live", "Open-Meteo historical archive")
    assert calls == [pw.FORECAST_URL, pw.ARCHIVE_URL]
    assert _rows(record_type="weather", data_type="forecast") == 1 and _rows(record_type="weather", data_type="observed") == 1


def test_the_requested_selling_date_is_asked_for_never_today(monkeypatch):
    seen = []
    def get(url, params=None, timeout=None, verify=None):
        seen.append((params["start_date"], params["end_date"], params["timezone"]))
        return _resp(body={"daily": {"temperature_2m_mean": [20.0], "precipitation_sum": [0.0], "relative_humidity_2m_mean": [50]}})
    monkeypatch.setattr(http_client.httpx, "get", get)
    weather_context("Pune(Khadiki)", dt.date(2025, 3, 14))
    assert seen == [("2025-03-14", "2025-03-14", "Asia/Kolkata")]


def test_dates_beyond_the_forecast_range_are_never_a_forecast(monkeypatch):
    calls = []
    monkeypatch.setattr(http_client.httpx, "get", _fake_weather(calls))
    r = weather_context("Pune(Khadiki)", TODAY + dt.timedelta(days=60))
    assert calls == []                                     # no provider is asked for a day it cannot know
    assert r["status"] in ("typical", "unavailable") and r["reason"] == "beyond_forecast_range"
    assert r["status"] != "forecast"
    if r["status"] == "typical":
        assert r["served_from"] == "stored_history" and "typical" in r["note"].lower()


def test_open_meteo_key_switches_to_the_customer_endpoint_and_is_never_returned(monkeypatch):
    seen = []
    def get(url, params=None, timeout=None, verify=None):
        seen.append((url, params.get("apikey")))
        return _resp(body={"daily": {"temperature_2m_mean": [20.0], "precipitation_sum": [0.0], "relative_humidity_2m_mean": [50]}})
    monkeypatch.setattr(http_client.httpx, "get", get)
    monkeypatch.setattr(pw, "get_settings", lambda: type("S", (), {"OPEN_METEO_API_KEY": "test-key-not-real"})())
    r = weather_context("Pune(Khadiki)", TODAY + dt.timedelta(days=1))
    assert seen == [(pw.PAID_FORECAST_URL, "test-key-not-real")]
    assert "test-key-not-real" not in str(r)


# ------------------------------------------------------------------------------------------------ persistence, reuse, duplicates
def test_the_same_place_and_date_is_reused_from_the_database_with_identical_values(monkeypatch):
    calls = []
    monkeypatch.setattr(http_client.httpx, "get", _fake_weather(calls, (24.0, 6.2, 80)))
    day = TODAY + dt.timedelta(days=2)
    first = weather_context("Pune(Khadiki)", day)
    second = weather_context("Pune(Khadiki)", day)
    third = weather_context("APMC Pune", day)               # another market in the same town shares the stored row
    assert len(calls) == 1
    assert (first["served_from"], second["served_from"], third["served_from"]) == ("live", "cache", "cache")
    for k in ("temperature_c", "humidity_pct", "rainfall_mm", "status", "source", "retrieved_at"):
        assert first[k] == second[k] == third[k]
    assert (second["temperature_c"], second["humidity_pct"], second["rainfall_mm"]) == (24.0, 80, 6.2)
    assert _rows(record_type="weather") == 1                # no duplicates


def test_records_survive_a_restart_because_they_live_in_the_database(monkeypatch):
    calls = []
    monkeypatch.setattr(http_client.httpx, "get", _fake_weather(calls))
    weather_context("Pune(Khadiki)", dt.date(2025, 10, 29))
    pw._location_tables.cache_clear()                       # forget everything held in memory, as a restart would
    _offline(monkeypatch)
    r = weather_context("Pune(Khadiki)", dt.date(2025, 10, 29))
    assert (r["status"], r["served_from"], r["temperature_c"]) == ("observed", "cache", 25.0)
    assert len(calls) == 1


def test_duplicate_inserts_update_one_row_instead_of_adding_a_second():
    for t in (20.0, 21.5):
        store.put("weather", "forecast", "Pune(Khadiki)", "Pune", 18.5196, 73.8554, "2026-11-01", dt.date(2026, 11, 1),
                  {"temperature_c": t, "humidity_pct": 50, "rainfall_mm": 0.0}, "test", dt.timedelta(hours=3))
    assert _rows(record_type="weather", date_key="2026-11-01") == 1
    assert store.get("weather", 18.5196, 73.8554, "2026-11-01", "forecast")["temperature_c"] == 21.5


def test_a_stale_forecast_is_refreshed_and_a_past_days_record_never_goes_stale(monkeypatch):
    calls = []
    monkeypatch.setattr(http_client.httpx, "get", _fake_weather(calls))
    day = TODAY + dt.timedelta(days=2)
    weather_context("Pune(Khadiki)", day)
    _expire("weather", "forecast")
    assert weather_context("Pune(Khadiki)", day)["served_from"] == "live" and len(calls) == 2
    weather_context("Pune(Khadiki)", dt.date(2025, 10, 29))
    lat, lon, _ = pw._place("Pune(Khadiki)")
    assert store.get("weather", lat, lon, "2025-10-29", "observed")["is_fresh"]     # stored with no expiry


# ------------------------------------------------------------------------------------------------ provider failures
def test_when_the_provider_fails_an_earlier_answer_is_used_and_labelled_as_cached(monkeypatch):
    calls = []
    day = TODAY + dt.timedelta(days=2)
    monkeypatch.setattr(http_client.httpx, "get", _fake_weather(calls))
    good = weather_context("Pune(Khadiki)", day)
    _expire("weather", "forecast")
    _offline(monkeypatch)
    r = weather_context("Pune(Khadiki)", day)
    assert (r["status"], r["served_from"], r["temperature_c"], r["retrieved_at"]) == ("forecast", "cache", 25.0, good["retrieved_at"])


def test_a_failed_request_never_overwrites_or_creates_a_record(monkeypatch):
    _offline(monkeypatch)
    r = weather_context("Pune(Khadiki)", TODAY + dt.timedelta(days=2))
    assert r["reason"] == "service_unreachable" and r["status"] in ("typical", "unavailable")
    assert _rows() == 0


def test_retries_once_on_a_timeout_then_succeeds(monkeypatch):
    state = {"n": 0}
    def flaky(url, params=None, timeout=None, verify=None):
        state["n"] += 1
        if state["n"] == 1:
            raise http_client.httpx.ReadTimeout("slow")
        return _resp(body={"daily": {"temperature_2m_mean": [22.0], "precipitation_sum": [1.0], "relative_humidity_2m_mean": [70]}})
    monkeypatch.setattr(http_client.httpx, "get", flaky)
    r = weather_context("Pune(Khadiki)", TODAY + dt.timedelta(days=1))
    assert state["n"] == 2 and (r["status"], r["temperature_c"]) == ("forecast", 22.0)


def test_rate_limits_are_retried_and_client_errors_are_not(monkeypatch):
    seen = []
    def limited(url, params=None, timeout=None, verify=None):
        seen.append(1)
        return _resp(status=429, body={})
    monkeypatch.setattr(http_client.httpx, "get", limited)
    assert weather_context("Pune(Khadiki)", TODAY + dt.timedelta(days=1))["reason"] == "service_unreachable" and len(seen) == 2
    assert "api.open-meteo.com" in http_client._down_until      # a rate-limited host is given a rest
    http_client._down_until.clear()
    seen.clear()
    monkeypatch.setattr(http_client.httpx, "get", lambda *a, **k: seen.append(1) or _resp(status=400, body={"reason": "internal detail"}))
    r = weather_context("Pune(Khadiki)", TODAY + dt.timedelta(days=1))
    assert len(seen) == 1 and "internal detail" not in str(r)


def test_no_zero_fill_when_a_value_is_missing(monkeypatch):
    monkeypatch.setattr(http_client.httpx, "get", lambda *a, **k: _resp(body={"daily": {
        "temperature_2m_mean": [22.0], "precipitation_sum": [None], "relative_humidity_2m_mean": [50]}}))
    assert pw._fetch(pw.FORECAST_URL, 18.5, 73.8, TODAY) == (None, "no_data")


# ------------------------------------------------------------------------------------------------ soil
def test_soil_estimate_scales_ph_labels_it_a_map_estimate_and_never_guesses(monkeypatch):
    monkeypatch.setattr(http_client.httpx, "get", _fake_soil(68, "Vertisols"))        # SoilGrids stores pH x 10
    r = soil_context("Pune(Khadiki)")
    assert (r["status"], r["ph"], r["soil_type"], r["served_from"], r["ph_scope"]) == ("estimate", 6.8, "Vertisols", "live", "town_centre")
    assert "not measurements from your farm" in r["note"] and "SoilGrids" in r["source"] and r["ph_depth"] == "0-5 cm"


def test_implausible_ph_is_rejected_not_shown(monkeypatch):
    monkeypatch.setattr(http_client.httpx, "get", _fake_soil(250, None))              # pH 25 is not a soil pH
    assert soil_context("Pune(Khadiki)")["status"] == "unavailable" and _rows() == 0


def test_partial_soil_data_keeps_the_valid_part(monkeypatch):
    monkeypatch.setattr(http_client.httpx, "get", _fake_soil(None, "Vertisols"))      # whole area has no pH, class known
    r = soil_context("Pune(Khadiki)")
    assert (r["ph"], r["ph_scope"], r["ph_reason"], r["soil_type"]) == (None, None, "not_in_map", "Vertisols")
    with SessionLocal() as s:
        row = s.execute(select(EnvironmentalRecord)).scalar_one()
    assert (row.status, row.soil_ph, row.soil_type) == ("partial", None, "Vertisols")


def test_a_masked_town_centre_reads_ph_from_the_farmland_around_it_and_says_so(monkeypatch):
    lat0, lon0, _ = pw._place("Pune(Khadiki)")
    def get(url, params=None, timeout=None, verify=None):
        if "classification" in url:
            return _resp(body={"wrb_class_name": "Vertisols"})
        centre = abs(params["lat"] - lat0) < 1e-6 and abs(params["lon"] - lon0) < 1e-6
        ring = {(round(lat0 + pw.RING_DEG, 6), round(lon0, 6)): 70, (round(lat0 - pw.RING_DEG, 6), round(lon0, 6)): 72,
                (round(lat0, 6), round(lon0 + pw.RING_DEG, 6)): None, (round(lat0, 6), round(lon0 - pw.RING_DEG, 6)): 74}
        v = None if centre else ring.get((round(params["lat"], 6), round(params["lon"], 6)))
        return _resp(body={"properties": {"layers": [{"unit_measure": {"d_factor": 10}, "depths": [{"values": {"mean": v}}]}]}})
    monkeypatch.setattr(http_client.httpx, "get", get)
    r = soil_context("Pune(Khadiki)")
    assert (r["ph"], r["ph_scope"], r["ph_area_km"]) == (7.2, "surrounding_area", 2)     # median of 7.0, 7.2, 7.4 (one point empty)


def test_soil_is_stored_once_and_reused_across_markets_in_the_same_town(monkeypatch):
    calls = []
    monkeypatch.setattr(http_client.httpx, "get", _fake_soil(65, "Cambisols", calls=calls))
    a = soil_context("Pune(Khadiki)")
    n = len(calls)
    b = soil_context("APMC Pune")
    assert len(calls) == n and b["served_from"] == "cache" and (b["ph"], b["soil_type"]) == (a["ph"], a["soil_type"])
    assert _rows(record_type="soil") == 1


def test_soil_failures_are_unavailable_with_a_reason_and_are_not_stored(monkeypatch):
    monkeypatch.setattr(http_client.httpx, "get", _fake_soil(None, None, fail=True))
    r = soil_context("Pune(Khadiki)")
    assert (r["status"], r["reason"], r["ph"], r["soil_type"]) == ("unavailable", "service_unreachable", None, None)
    assert _rows() == 0


def test_soil_outage_after_a_good_answer_serves_the_stored_estimate(monkeypatch):
    monkeypatch.setattr(http_client.httpx, "get", _fake_soil(70, "Vertisols"))
    soil_context("Pune(Khadiki)")
    _expire("soil", "soil_estimate")
    _offline(monkeypatch)
    r = soil_context("Pune(Khadiki)")
    assert (r["status"], r["served_from"], r["ph"]) == ("estimate", "cache", 7.0)


# ------------------------------------------------------------------------------------------------ the six factors together
def test_environmental_factors_returns_all_six_with_units_types_and_availability(monkeypatch):
    def get(url, params=None, timeout=None, verify=None):
        if "open-meteo" in url:
            return _resp(body={"daily": {"temperature_2m_mean": [24.0], "precipitation_sum": [6.2], "relative_humidity_2m_mean": [80]}})
        return _fake_soil(None, "Vertisols")(url, params)
    monkeypatch.setattr(http_client.httpx, "get", get)
    f = environmental_factors("Pune(Khadiki)", TODAY + dt.timedelta(days=2))
    assert f["used_by_price_model"] is False and "not inputs" in f["note"]
    assert (f["temperature"]["value"], f["temperature"]["unit"], f["temperature"]["data_type"]) == (24.0, "°C", "forecast")
    assert (f["humidity"]["value"], f["humidity"]["unit"]) == (80, "%")
    assert (f["rainfall"]["value"], f["rainfall"]["unit"], f["rainfall"]["period"]) == (6.2, "mm", "daily total")
    assert (f["soil_ph"]["available"], f["soil_ph"]["value"], f["soil_ph"]["reason"]) == (False, None, "not_in_map")
    assert (f["soil_type"]["value"], f["soil_type"]["data_type"], f["soil_type"]["classification"]) == ("Vertisols", "soil_estimate", "WRB reference soil group")
    assert (f["growing_location"]["available"], f["growing_location"]["value"], f["growing_location"]["reason"]) == (False, None, "not_provided")
    assert f["selling_date"] == (TODAY + dt.timedelta(days=2)).isoformat() and f["location"]["kind"] == "selling_market_town"


def test_environmental_factors_when_every_provider_is_down_are_all_unavailable_never_zero(monkeypatch):
    _offline(monkeypatch)
    f = environmental_factors("Pune(Khadiki)", TODAY + dt.timedelta(days=2))
    for k in ("soil_ph", "soil_type", "growing_location"):
        assert f[k]["available"] is False and f[k]["value"] is None
    for k in ("temperature", "humidity", "rainfall"):     # typical estimates may exist; otherwise unavailable, never 0
        assert f[k]["value"] is None or f[k]["data_type"] == "typical"


def test_a_slow_provider_cannot_hold_up_the_prediction(monkeypatch):
    import time as _t
    monkeypatch.setattr(pw, "FACTOR_BUDGET_SECONDS", 0.2)
    monkeypatch.setattr(pw, "weather_context", lambda *a: _t.sleep(1) or {})
    monkeypatch.setattr(pw, "soil_context", lambda *a: _t.sleep(1) or {})
    start = _t.time()
    f = environmental_factors("Pune(Khadiki)", TODAY)
    assert _t.time() - start < 0.9
    assert f["temperature"]["available"] is False and f["temperature"]["reason"] == "service_unreachable"


def test_the_soil_endpoint_requires_login_and_reuses_the_stored_answer(client, user, monkeypatch):
    monkeypatch.setattr(http_client.httpx, "get", _fake_soil(65, "Cambisols"))
    assert client.get("/api/price-prediction/soil-context", params={"market": "Pune(Khadiki)"}).status_code == 401
    r = client.get("/api/price-prediction/soil-context", params={"market": "Pune(Khadiki)"}, headers=user["headers"])
    assert r.status_code == 200 and r.json()["ph"] == 6.5 and r.json()["soil_type"] == "Cambisols"
    again = client.get("/api/price-prediction/soil-context", params={"market": "Pune(Khadiki)"}, headers=user["headers"]).json()
    assert again["served_from"] == "cache" and again["ph"] == 6.5


# ------------------------------------------------------------------------------------------------ real prices
def test_observed_prices_are_real_reports_only(client):
    f = client.app.state.registry.price
    key = next(k for k in f._series if k[2] == "Cabbage")
    obs = f.observed_prices(*key)
    s = f._series[key]
    real = {d.date().isoformat(): round(float(p), 2) for d, p in zip(s.loc[s["observed"], "Date"], s.loc[s["observed"], "price"])}
    assert obs and all(real.get(o["date"]) == o["price"] for o in obs)
    assert f.observed_prices("Maharashtra", "No Such", "Cabbage", "x") == []


def test_a_provider_that_is_down_is_not_called_again_for_a_while_so_predictions_stay_fast(monkeypatch):
    calls = []
    def down(url, params=None, timeout=None, verify=None):
        calls.append(url)
        raise http_client.httpx.ConnectTimeout("SoilGrids offline")
    monkeypatch.setattr(http_client.httpx, "get", down)
    first = soil_context("Pune(Khadiki)")
    n = len(calls)
    second = soil_context("APMC Akkalkot")                   # same host, still down: answered at once, no new request
    assert n > 0 and len(calls) == n
    assert first["reason"] == second["reason"] == "service_unreachable" and second["ph"] is None
    assert _rows() == 0                                       # nothing about the failure is stored


def test_back_off_is_per_host_and_ends_after_a_success(monkeypatch):
    http_client._down_until["rest.isric.org"] = float("inf")   # SoilGrids marked down
    monkeypatch.setattr(http_client.httpx, "get", _fake_weather([]))
    assert weather_context("Pune(Khadiki)", TODAY + dt.timedelta(days=1))["status"] == "forecast"   # Open-Meteo unaffected
    http_client._down_until["rest.isric.org"] = 0.0           # time passed
    monkeypatch.setattr(http_client.httpx, "get", _fake_soil(66, "Vertisols"))
    assert soil_context("Pune(Khadiki)")["ph"] == 6.6
    assert "rest.isric.org" not in http_client._down_until


def test_a_first_timeout_pauses_the_host_at_once_so_a_parallel_request_does_not_wait(monkeypatch):
    seen = []
    def slow(url, params=None, timeout=None, verify=None):
        seen.append(url)
        if len(seen) == 2:                                      # the first attempt timed out; while this request retries ...
            assert http_client._down_until.get("rest.isric.org", 0) > 0
            assert http_client.get_json(url, {}, 1.0) == (None, "backoff")   # ... another request is answered at once
        raise http_client.httpx.ReadTimeout("slow")
    monkeypatch.setattr(http_client.httpx, "get", slow)
    assert http_client.get_json(pw.SOILGRIDS_CLASS, {}, 1.0) == (None, "timeout")
    assert len(seen) == 2                                       # only this request's own retry reached the network


# ------------------------------------------------------------------ seasonal estimate for any place (the growing location)
NASIK = {"label": "Nashik, Maharashtra, India", "latitude": 19.9973, "longitude": 73.791, "source": "test fixture"}


def _archive(calls, temp=20.0, rain=0.4, hum=60):     # synthetic archive: one value per requested day
    def get(url, params=None, timeout=None, verify=None):
        calls.append((url, params["start_date"], params["end_date"]))
        d0, d1 = dt.date.fromisoformat(params["start_date"]), dt.date.fromisoformat(params["end_date"])
        days = [d0 + dt.timedelta(days=i) for i in range((d1 - d0).days + 1)]
        return _resp(body={"daily": {"time": [d.isoformat() for d in days], "temperature_2m_mean": [temp] * len(days),
                                     "precipitation_sum": [rain] * len(days), "relative_humidity_2m_mean": [hum] * len(days)}})
    return get


def test_growing_location_beyond_the_forecast_gets_a_labelled_seasonal_estimate(monkeypatch):
    calls = []
    monkeypatch.setattr(http_client.httpx, "get", _archive(calls))
    day = TODAY + dt.timedelta(days=40)
    w = weather_context("All markets (state median)", day, NASIK)
    assert w["status"] == "typical" and w["place_kind"] == "growing_location" and w["place"] == NASIK["label"]
    assert (w["temperature_c"], w["rainfall_mm"], w["humidity_pct"]) == (20.0, 0.4, 60)
    assert w["rainfall_basis"] == "daily_average" and "not a forecast" in w["note"]
    assert w["source"] == f"Open-Meteo historical weather, same time of year, {TODAY.year - 5}-{TODAY.year - 1}"
    # one archive request spanning the same calendar window in the last five complete years, nothing after last year
    assert len(calls) == 1 and "archive" in calls[0][0]
    assert dt.date.fromisoformat(calls[0][2]) < dt.date(TODAY.year, 1, 1) + dt.timedelta(days=7)
    # stored: the next request for the same place and day is answered without calling the provider
    again = weather_context("All markets (state median)", day, NASIK)
    assert len(calls) == 1 and again["status"] == "typical" and again["temperature_c"] == 20.0


def test_seasonal_estimate_averages_only_the_same_time_of_year(monkeypatch):
    rows = {}
    for y in range(2021, 2026):
        for k in range(-30, 31):
            d = dt.date(y, 12, 6) + dt.timedelta(days=k)
            near = abs(k) <= pw.SEASONAL_WINDOW_DAYS
            rows[d.isoformat()] = {"temperature_c": 10.0 if near else 40.0, "rainfall_mm": 2.0 if near else 50.0, "humidity_pct": 50 if near else 99}
    monkeypatch.setattr(pw, "_fetch_range", lambda *a, **k: (rows, None))
    v, err = pw._seasonal(19.9, 73.8, dt.date(2026, 12, 6))
    assert err is None and (v["temperature_c"], v["rainfall_mm"], v["humidity_pct"]) == (10.0, 2.0, 50)   # days far from 6 Dec never count


def test_provider_down_beyond_the_forecast_is_unavailable_never_a_made_up_value():
    w = weather_context("All markets (state median)", TODAY + dt.timedelta(days=40), NASIK)   # conftest: every request fails
    assert w["status"] == "unavailable" and w["reason"] == "service_unreachable"
    assert w["temperature_c"] is None and w["rainfall_mm"] is None and w["humidity_pct"] is None


def test_a_forecast_day_reports_rain_for_that_single_day(monkeypatch):
    monkeypatch.setattr(http_client.httpx, "get", _fake_weather([], values=(25.0, 3.0, 60)))
    w = weather_context("All markets (state median)", TODAY + dt.timedelta(days=5), NASIK)
    assert w["status"] == "forecast" and w["rainfall_basis"] == "single_day"


def test_environmental_factors_keep_growing_location_and_selling_market_apart_and_say_what_the_rain_is(monkeypatch):
    monkeypatch.setattr(http_client.httpx, "get", _archive([]))
    monkeypatch.setattr(pw, "resolve_growing", lambda g: (NASIK, None))
    e = environmental_factors("Pune(Khadiki)", TODAY + dt.timedelta(days=40), {"name": "Nashik"})
    assert e["market"] == "Pune(Khadiki)" and e["location"]["kind"] == "growing_location" and e["location"]["name"] == NASIK["label"]
    assert e["weather"]["place"] == NASIK["label"]                       # weather is for where the crop grows, not the selling market
    assert e["temperature"]["data_type"] == "typical" and e["rainfall"]["period"] == "average per day at this time of year"
    assert e["growing_location"]["value"] == NASIK["label"]
