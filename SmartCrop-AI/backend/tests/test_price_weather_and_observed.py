"""Background weather for the price page and the real-price history. Network calls are replaced by fixtures (labelled)."""
import datetime as dt

from app.services import price_weather_service as pw
from app.services.price_weather_service import weather_context

TODAY = dt.date(2026, 10, 27)
FAKE = {"temperature_c": 25.0, "rainfall_mm": 0.0, "humidity_pct": 60}   # synthetic test values


def test_unmapped_and_state_series_are_unavailable_never_a_substitute_place(monkeypatch):
    monkeypatch.setattr(pw, "today", lambda: TODAY)
    assert weather_context("All markets (state median)", TODAY)["status"] == "unavailable"
    r = weather_context("No Such Market", TODAY)
    assert r["status"] == "unavailable" and r["temperature_c"] is None


def test_future_date_uses_forecast_and_past_uses_archive(monkeypatch):
    monkeypatch.setattr(pw, "today", lambda: TODAY)
    calls = []
    monkeypatch.setattr(pw, "_fetch", lambda url, lat, lon, day: calls.append(url) or dict(FAKE))
    assert weather_context("Pune(Khadiki)", TODAY + dt.timedelta(days=3))["status"] == "forecast"
    assert weather_context("Pune(Khadiki)", dt.date(2025, 10, 29))["status"] == "observed"
    assert calls == [pw.FORECAST_URL, pw.ARCHIVE_URL]


def test_failed_lookup_falls_back_to_typical_or_unavailable_and_is_labelled(monkeypatch):
    monkeypatch.setattr(pw, "today", lambda: TODAY)
    monkeypatch.setattr(pw, "_fetch", lambda *a: None)
    r = weather_context("Pune(Khadiki)", TODAY + dt.timedelta(days=60))
    assert r["status"] in ("typical", "unavailable")
    if r["status"] == "typical":
        assert "typical" in r["note"].lower() and "forecast" not in r["source"].lower()
    far = weather_context("Pune(Khadiki)", dt.date(2026, 10, 20))   # past, but recent weather also failed
    assert far["status"] in ("typical", "unavailable")


def test_no_zero_fill_when_a_value_is_missing(monkeypatch):
    class R:
        def raise_for_status(self): pass
        def json(self): return {"daily": {"temperature_2m_mean": [22.0], "precipitation_sum": [None], "relative_humidity_2m_mean": [50]}}
    monkeypatch.setattr(pw.httpx, "get", lambda *a, **k: R())
    assert pw._fetch(pw.FORECAST_URL, 18.5, 73.8, TODAY) is None


def test_observed_prices_are_real_reports_only(client):
    f = client.app.state.registry.price
    key = next(k for k in f._series if k[2] == "Cabbage")
    obs = f.observed_prices(*key)
    s = f._series[key]
    real = {d.date().isoformat(): round(float(p), 2) for d, p in zip(s.loc[s["observed"], "Date"], s.loc[s["observed"], "price"])}
    assert obs and all(real.get(o["date"]) == o["price"] for o in obs)
    assert f.observed_prices("Maharashtra", "No Such", "Cabbage", "x") == []


# ---- soil-map estimates (network calls replaced by labelled fixtures)
def _fake_get(ph_value, cls_name, fail=False):
    class R:
        def __init__(self, data): self._d = data
        def raise_for_status(self): pass
        def json(self): return self._d
    def get(url, params=None, timeout=None):
        if fail:
            raise TimeoutError("boom")
        if "classification" in url:
            return R({"wrb_class_name": cls_name})
        return R({"properties": {"layers": [{"unit_measure": {"d_factor": 10}, "depths": [{"values": {"mean": ph_value}}]}]}})
    return get


def test_soil_estimate_scales_ph_labels_it_a_map_estimate_and_never_guesses(monkeypatch):
    pw._soil_cache.clear()
    monkeypatch.setattr(pw.httpx, "get", _fake_get(68, "Vertisols"))        # SoilGrids stores pH x 10
    r = pw.soil_context("Pune(Khadiki)")
    assert (r["status"], r["ph"], r["soil_type"]) == ("estimate", 6.8, "Vertisols")
    assert "not measurements from your farm" in r["note"] and "SoilGrids" in r["source"]
    pw._soil_cache.clear()
    monkeypatch.setattr(pw.httpx, "get", _fake_get(None, "Vertisols"))      # built-up area: no pH value, soil class still known
    r = pw.soil_context("Pune(Khadiki)")
    assert r["ph"] is None and r["soil_type"] == "Vertisols" and r["status"] == "estimate"
    pw._soil_cache.clear()
    monkeypatch.setattr(pw.httpx, "get", _fake_get(250, None))              # pH 25 is not a soil pH: rejected, not shown
    assert pw.soil_context("Pune(Khadiki)")["status"] == "unavailable"


def test_soil_failures_and_unmatched_markets_are_unavailable_not_errors(monkeypatch):
    pw._soil_cache.clear()
    monkeypatch.setattr(pw.httpx, "get", _fake_get(None, None, fail=True))
    r = pw.soil_context("Pune(Khadiki)")
    assert r["status"] == "unavailable" and r["ph"] is None and r["soil_type"] is None
    assert pw.soil_context("All markets (state median)")["status"] == "unavailable"
    assert pw.soil_context("No Such Market")["status"] == "unavailable"
    assert "Pune(Khadiki)" not in pw._soil_cache                              # a failure is not cached, so the next visit can succeed


def test_soil_endpoint_requires_login_and_returns_the_same_answer(client, user, monkeypatch):
    pw._soil_cache.clear()
    monkeypatch.setattr(pw.httpx, "get", _fake_get(65, "Cambisols"))
    assert client.get("/api/price-prediction/soil-context", params={"market": "Pune(Khadiki)"}).status_code == 401
    r = client.get("/api/price-prediction/soil-context", params={"market": "Pune(Khadiki)"}, headers=user["headers"])
    assert r.status_code == 200 and r.json()["ph"] == 6.5 and r.json()["soil_type"] == "Cambisols"
