"""The growing location on the price form: location search, weather and soil looked up at the growing location (not the selling market),
separate stored records per place, invalid/missing locations and provider outages, and an unchanged price prediction and SHAP explanation.
Every provider is a labelled fixture (conftest.py keeps tests offline); all coordinates and values below are synthetic test data, except
Nashik's and Pune's coordinates, which are the GeoNames ones."""
import datetime as dt

import pandas as pd
import pytest
from sqlalchemy import delete, func, select, text

from app.database.base import Base
from app.database.connection import SessionLocal, engine
from app.models.environmental_record import EnvironmentalRecord
from app.ml.common import paths
from app.services import geocoding_service as geo
from app.services import http_client, price_service
from app.services import price_weather_service as pw
from app.services.price_weather_service import environmental_factors, soil_context, weather_context

TODAY = dt.date(2025, 6, 16)              # the price tests' fixed day, inside the price dataset
NASHIK = {"name": "Nashik, Maharashtra, India", "latitude": 19.9973, "longitude": 73.791}
SINNAR = {"name": "Sinnar, Nashik, Maharashtra, India", "latitude": 19.8454, "longitude": 74.0001}
CITIES = {r.city: (round(r.latitude, 4), round(r.longitude, 4))           # the project's verified city coordinates
          for r in pd.read_csv(paths.CITY_COORDS_PATH).itertuples()}
REQ = {"state": "Maharashtra", "market": "APMC Pune", "commodity": "Onion", "target_date": "2025-06-30"}
GEO_ROWS = [   # what the geocoding service returns for "Nashik" (shortened)
    {"name": "Nashik", "latitude": 19.99727, "longitude": 73.79096, "country_code": "IN", "country": "India", "admin1": "Maharashtra",
     "admin2": "Nashik", "admin3": "Nashik"},
    {"name": "Nashik Road", "latitude": 19.95, "longitude": 73.83, "country_code": "IN", "country": "India", "admin1": "Maharashtra",
     "admin2": "Nashik"},
    {"name": "Nashik", "latitude": 26.1, "longitude": 80.1, "country_code": "IN", "country": "India", "admin1": "Uttar Pradesh"},
]


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    Base.metadata.create_all(engine, tables=[EnvironmentalRecord.__table__])
    with SessionLocal() as s:
        s.execute(delete(EnvironmentalRecord))
        s.commit()
    monkeypatch.setattr(pw, "today", lambda: TODAY)
    monkeypatch.setattr(price_service, "today", lambda: TODAY)


def _resp(body, status=200):
    class R:
        status_code = status
        def json(self): return body
    return R()


def providers(calls, temp_by_lat=None, geo=GEO_ROWS, weather_down=False, soil_down=False, geo_down=False):
    """One fake httpx.get for all three services. Weather values depend on the latitude asked for, so a mix-up of places shows."""
    def get(url, params=None, timeout=None, verify=None):
        calls.append((url, dict(params or {})))
        if "geocoding-api" in url:
            if geo_down:
                raise http_client.httpx.ConnectTimeout("geocoder down")
            return _resp({"results": geo})
        if "open-meteo" in url:
            if weather_down:
                raise http_client.httpx.ConnectTimeout("weather down")
            t = (temp_by_lat or {}).get(round(params["latitude"], 4), 30.0)
            return _resp({"daily": {"temperature_2m_mean": [t], "precipitation_sum": [1.5], "relative_humidity_2m_mean": [70]}})
        if soil_down:
            raise http_client.httpx.ConnectTimeout("soil down")
        if "classification" in url:
            return _resp({"wrb_class_name": "Vertisols"})
        return _resp({"properties": {"layers": [{"unit_measure": {"d_factor": 10}, "depths": [{"values": {"mean": 78}}]}]}})
    return get


def _rows(**where):
    with SessionLocal() as s:
        q = select(func.count()).select_from(EnvironmentalRecord)
        for k, v in where.items():
            q = q.where(getattr(EnvironmentalRecord, k) == v)
        return s.execute(q).scalar()


# ------------------------------------------------------------------------------------------------ grown in Nashik, sold at APMC Pune
def test_crop_grown_in_nashik_and_sold_in_pune_uses_nashiks_coordinates_for_weather_and_soil(monkeypatch):
    calls = []
    monkeypatch.setattr(http_client.httpx, "get", providers(calls, temp_by_lat={19.9973: 22.0}))
    f = environmental_factors("APMC Pune", TODAY + dt.timedelta(days=3), NASHIK)
    pune_lat, pune_lon, _ = pw._place("APMC Pune")
    asked = {(round(p["latitude"], 2), round(p["longitude"], 2)) for u, p in calls if "open-meteo" in u}
    asked |= {(round(p["lat"], 2), round(p["lon"], 2)) for u, p in calls if "isric" in u and "classification" in u}
    assert asked == {(20.0, 73.79)}                                       # Nashik only
    assert (round(pune_lat, 2), round(pune_lon, 2)) not in asked           # never Pune, the selling market
    assert f["temperature"]["value"] == 22.0 and f["temperature"]["data_type"] == "forecast"
    assert f["soil_ph"]["value"] == 7.8 and f["soil_type"]["value"] == "Vertisols" and f["soil_type"]["data_type"] == "soil_estimate"
    g = f["growing_location"]
    assert (g["available"], g["value"], g["latitude"], g["longitude"]) == (True, NASHIK["name"], 19.9973, 73.791)
    assert f["location"]["kind"] == "growing_location" and f["market"] == "APMC Pune"
    assert f["weather"]["place_kind"] == f["soil"]["place_kind"] == "growing_location"


def test_two_growing_locations_sold_at_the_same_market_get_separate_records(monkeypatch):
    calls = []
    monkeypatch.setattr(http_client.httpx, "get", providers(calls, temp_by_lat={19.9973: 22.0, 19.8454: 26.0}))
    day = TODAY + dt.timedelta(days=3)
    a = environmental_factors("APMC Pune", day, NASHIK)
    b = environmental_factors("APMC Pune", day, SINNAR)
    assert (a["temperature"]["value"], b["temperature"]["value"]) == (22.0, 26.0)
    assert _rows(record_type="weather") == 2 and _rows(record_type="soil") == 2
    with SessionLocal() as s:
        places = set(s.execute(select(EnvironmentalRecord.place_name).where(EnvironmentalRecord.record_type == "weather")).scalars())
    assert places == {NASHIK["name"], SINNAR["name"]}
    # asking again for Nashik reuses Nashik's own record, not Sinnar's
    again = environmental_factors("APMC Pune", day, NASHIK)
    assert again["temperature"]["value"] == 22.0 and again["temperature"]["served_from"] == "cache"


def test_a_past_date_uses_the_archive_and_a_near_future_date_the_forecast(monkeypatch):
    calls = []
    monkeypatch.setattr(http_client.httpx, "get", providers(calls))
    past = weather_context("APMC Pune", TODAY - dt.timedelta(days=30), {**NASHIK, "label": NASHIK["name"]})
    future = weather_context("APMC Pune", TODAY + dt.timedelta(days=10), {**NASHIK, "label": NASHIK["name"]})
    assert past["status"] == "observed" and "archive" in calls[0][0] and calls[0][1]["start_date"] == "2025-05-17"
    assert future["status"] == "forecast" and "api.open-meteo.com/v1/forecast" in calls[1][0] and calls[1][1]["start_date"] == "2025-06-26"


def test_beyond_the_forecast_range_a_growing_location_is_unavailable_not_a_market_average(monkeypatch):
    calls = []
    monkeypatch.setattr(http_client.httpx, "get", providers(calls))
    r = weather_context("APMC Pune", TODAY + dt.timedelta(days=40), {**NASHIK, "label": NASHIK["name"]})
    assert (r["status"], r["reason"], r["temperature_c"]) == ("unavailable", "beyond_forecast_range", None)
    assert not [u for u, _ in calls if "open-meteo" in u]                 # nothing asked for a day no forecast covers


# ------------------------------------------------------------------------------------------------ invalid or missing locations
def test_a_label_without_coordinates_is_searched_again_with_its_district_and_state(monkeypatch):
    calls = []
    monkeypatch.setattr(http_client.httpx, "get", providers(calls))
    place, reason = pw.resolve_growing({"name": "Nashik Road, Nashik, Maharashtra, India"})
    assert reason is None and (place["latitude"], place["longitude"]) == (19.95, 73.83)
    assert calls[0][1]["name"] == "Nashik Road" and calls[0][1]["countryCode"] == "IN"
    place, _ = pw.resolve_growing({"name": "Ahilyanagar, Maharashtra, India"})   # a project city: its verified coordinates
    assert (place["latitude"], place["longitude"]) == CITIES["Ahilyanagar"]


def test_a_growing_location_that_cannot_be_found_is_unavailable_and_never_replaced_by_the_market(monkeypatch):
    calls = []
    monkeypatch.setattr(http_client.httpx, "get", providers(calls, geo=[]))
    f = environmental_factors("APMC Pune", TODAY + dt.timedelta(days=3), {"name": "Nowhereville, Maharashtra"})
    for k in ("temperature", "humidity", "rainfall", "soil_ph", "soil_type", "growing_location"):
        assert f[k]["available"] is False and f[k]["value"] is None
    assert f["growing_location"]["reason"] == "location_not_found" and f["growing_location"]["entered"] == "Nowhereville, Maharashtra"
    assert f["temperature"]["reason"] == "location_not_found"
    assert not [u for u, _ in calls if "geocoding" not in u]                # no weather or soil asked for any other place
    assert _rows() == 0


def test_missing_or_invalid_growing_location_in_a_request_is_rejected(client, user):
    for bad in ("", " ", "x", {"name": "Nashik", "latitude": 19.9}, {"name": "Nashik", "latitude": 95, "longitude": 73.8}):
        r = client.post("/api/price-prediction/predict", headers=user["headers"], json={**REQ, "growing_location": bad})
        assert r.status_code == 422, (bad, r.text)


def test_the_location_search_endpoint(client, user, monkeypatch):
    calls = []
    monkeypatch.setattr(http_client.httpx, "get", providers(calls))
    assert client.get("/api/price-prediction/locations", params={"q": "Nashik"}).status_code == 401
    r = client.get("/api/price-prediction/locations", params={"q": "Nashik, Maharashtra, India"}, headers=user["headers"])
    assert r.status_code == 200
    res = r.json()["results"]
    assert [p["label"] for p in res] == ["Nashik, Maharashtra, India", "Nashik Road, Nashik, Maharashtra, India"]
    # the project's own Nashik (verified coordinates) replaces GeoNames' entry with the same label; other places follow
    assert (res[0]["latitude"], res[0]["longitude"], res[0]["source"]) == (*CITIES["Nashik"], geo.CITY_SOURCE)
    assert (res[1]["latitude"], res[1]["longitude"], res[1]["district"]) == (19.95, 73.83, "Nashik")
    assert client.get("/api/price-prediction/locations", params={"q": "N"}, headers=user["headers"]).status_code == 422
    monkeypatch.setattr(http_client.httpx, "get", providers([], geo=[]))
    empty = client.get("/api/price-prediction/locations", params={"q": "Zzqx"}, headers=user["headers"])
    assert empty.status_code == 200 and empty.json()["results"] == []
    monkeypatch.setattr(http_client.httpx, "get", providers([], geo_down=True))
    down = client.get("/api/price-prediction/locations", params={"q": "Sinnar"}, headers=user["headers"])
    assert down.status_code == 503


# ------------------------------------------------------------------------------------------------ outages
def test_weather_outage_is_unavailable_and_nothing_is_stored(monkeypatch):
    monkeypatch.setattr(http_client.httpx, "get", providers([], weather_down=True))
    f = environmental_factors("APMC Pune", TODAY + dt.timedelta(days=3), NASHIK)
    assert f["temperature"]["value"] is None and f["temperature"]["reason"] == "service_unreachable"
    assert f["soil_ph"]["value"] == 7.8                                   # soil still works
    assert f["growing_location"]["available"] is True
    assert _rows(record_type="weather") == 0


def test_soil_outage_is_unavailable_and_nothing_is_stored(monkeypatch):
    monkeypatch.setattr(http_client.httpx, "get", providers([], soil_down=True))
    s = soil_context("APMC Pune", {**NASHIK, "label": NASHIK["name"]})
    assert (s["status"], s["reason"], s["ph"], s["soil_type"]) == ("unavailable", "service_unreachable", None, None)
    assert _rows(record_type="soil") == 0


def test_geocoder_outage_for_a_saved_label_outside_the_city_list_makes_the_factors_unavailable(monkeypatch):
    monkeypatch.setattr(http_client.httpx, "get", providers([], geo_down=True))
    f = environmental_factors("APMC Pune", TODAY + dt.timedelta(days=3), {"name": "Sinnar, Nashik, Maharashtra, India"})
    assert f["growing_location"]["reason"] == "service_unreachable" and f["temperature"]["value"] is None


def test_context_endpoints_accept_the_growing_location(client, user, monkeypatch):
    calls = []
    monkeypatch.setattr(http_client.httpx, "get", providers(calls, temp_by_lat={19.9973: 21.0}))
    params = {"market": "APMC Pune", "target_date": "2025-06-20", "growing_location": NASHIK["name"],
              "latitude": NASHIK["latitude"], "longitude": NASHIK["longitude"]}
    w = client.get("/api/price-prediction/weather-context", params=params, headers=user["headers"]).json()
    assert (w["temperature_c"], w["place"], w["place_kind"]) == (21.0, NASHIK["name"], "growing_location")
    s = client.get("/api/price-prediction/soil-context", params={k: v for k, v in params.items() if k != "target_date"},
                   headers=user["headers"]).json()
    assert (s["ph"], s["latitude"]) == (7.8, 19.9973)
    half = client.get("/api/price-prediction/soil-context", params={"market": "APMC Pune", "growing_location": "Nashik", "latitude": 20},
                      headers=user["headers"])
    assert half.status_code == 422


# ------------------------------------------------------------------------------------------------ price and SHAP unchanged
def test_growing_location_never_changes_the_price_or_the_shap_explanation(client, user, monkeypatch):
    monkeypatch.setattr(http_client.httpx, "get", providers([], temp_by_lat={19.9973: 22.0}))
    h = user["headers"]
    plain = client.post("/api/price-prediction/predict", headers=h, json=REQ).json()
    grown = client.post("/api/price-prediction/predict", headers=h, json={**REQ, "growing_location": NASHIK}).json()
    assert grown["target"] == plain["target"] and grown["path"] == plain["path"] and grown["advice"] == plain["advice"]
    assert grown["series"]["market"] == plain["series"]["market"]          # the selling market still drives the price
    assert grown["environmental_factors"]["temperature"]["value"] == 22.0
    assert grown["environmental_factors"]["location"]["kind"] == "growing_location"
    assert plain["environmental_factors"]["location"]["kind"] == "selling_market_town"   # older clients: unchanged behaviour

    ex_plain = client.post("/api/price-prediction/explain", headers=h, json={**REQ, "as_of": plain["input_date"]}).json()
    ex_grown = client.post("/api/price-prediction/explain", headers=h,
                           json={**REQ, "as_of": grown["input_date"], "growing_location": NASHIK}).json()
    assert ex_grown["explanations"] == ex_plain["explanations"]

    with engine.connect() as c:
        saved = c.execute(text("select growing_location, market from price_predictions where id = :i"), {"i": grown["id"]}).one()
    assert tuple(saved) == (NASHIK["name"], "APMC Pune")
    item = client.get(f"/api/history/price/{grown['id']}", headers=h)
    assert item.status_code == 200 and item.json()["growing_location"] == NASHIK["name"]


# ------------------------------------------------------------------------------------------------ popular places
def test_popular_places_come_first_in_the_requested_order_with_verified_coordinates(client, user):
    assert client.get("/api/price-prediction/locations/popular").status_code == 401
    r = client.get("/api/price-prediction/locations/popular", headers=user["headers"])
    assert r.status_code == 200
    res = r.json()["results"]
    assert [p["name"] for p in res[:7]] == ["Nashik", "Pune", "Nagpur", "Mumbai", "Ahilyanagar", "Satara", "Dharashiv"]
    assert len(res) == len(CITIES)
    for p in res:
        assert (p["latitude"], p["longitude"]) == CITIES[p["name"]] and p["label"] == f"{p['name']}, Maharashtra, India"


def test_typing_matches_popular_places_including_former_city_names(monkeypatch):
    monkeypatch.setattr(http_client.httpx, "get", providers([], geo=[]))
    assert [p["name"] for p in geo.search("Ahil")[0]] == ["Ahilyanagar"]            # GeoNames has no Ahilyanagar entry
    assert [p["name"] for p in geo.search("Ahmednagar")[0]] == ["Ahilyanagar"]       # renamed in 2023
    assert [p["name"] for p in geo.search("Osmanabad")[0]] == ["Dharashiv"]
    assert [p["name"] for p in geo.search("sat")[0]] == ["Satara"]
    assert geo.search("Satara, Kerala")[0] == []                                   # a qualifier that does not fit Maharashtra


def test_popular_places_still_answer_while_the_location_service_is_down(client, user, monkeypatch):
    monkeypatch.setattr(http_client.httpx, "get", providers([], geo_down=True))
    places, err = geo.search("Nag")
    assert err is None and [p["name"] for p in places] == ["Nagpur"]
    assert geo.search("Sinnar")[0] == [] and geo.search("Sinnar")[1] in ("timeout", "backoff")   # not in the list: the outage is reported
    r = client.get("/api/price-prediction/locations/popular", headers=user["headers"])
    assert r.status_code == 200 and r.json()["results"]


def test_choosing_a_popular_place_uses_its_coordinates_for_weather_and_soil(monkeypatch):
    calls = []
    monkeypatch.setattr(http_client.httpx, "get", providers(calls))
    satara = next(p for p in geo.popular() if p["name"] == "Satara")
    f = environmental_factors("APMC Pune", TODAY + dt.timedelta(days=3),
                              {"name": satara["label"], "latitude": satara["latitude"], "longitude": satara["longitude"]})
    asked = {(round(p["latitude"], 4), round(p["longitude"], 4)) for u, p in calls if "open-meteo" in u}
    assert asked == {CITIES["Satara"]}
    assert f["growing_location"]["value"] == "Satara, Maharashtra, India" and f["market"] == "APMC Pune"
