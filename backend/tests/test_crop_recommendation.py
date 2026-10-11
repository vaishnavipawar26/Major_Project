import math

ONION_LIKE = {"nitrogen": 80, "phosphorus": 45, "potassium": 85, "temperature": 23,
              "humidity": 58, "ph": 6.8, "rainfall": 70, "city": "Nashik",
              "planting_month": 11, "selling_month": 3, "planting_year": 2026}
WHEAT_LIKE = {"nitrogen": 90, "phosphorus": 45, "potassium": 40, "temperature": 20,
              "humidity": 45, "ph": 7.4, "rainfall": 30, "city": "Nagpur",
              "planting_month": 11, "selling_month": 3, "planting_year": 2026}
CROPS = {"Brinjal", "Cabbage", "Cauliflower", "Onion", "Potato", "Tomato", "Wheat"}


def post(client, user, body, path="recommend"):
    return client.post(f"/api/crop-recommendation/{path}", headers=user["headers"], json=body)


def test_recommend_ranks_all_seven_crops(client, user):
    r = post(client, user, ONION_LIKE)
    assert r.status_code == 201, r.text
    b = r.json()
    assert {x["crop_name"] for x in b["results"]} == CROPS
    assert [x["rank"] for x in b["results"]] == list(range(1, 8))
    assert b["planting_date"] == "2026-11" and b["selling_date"] == "2027-03"
    assert b["growing_months"] == 4 and b["season_used"] == "Rabi"
    top = b["results"][0]
    assert top["crop_name"] == "Onion" and top["recommended"]
    assert top["why"] and top["summary"] and top["important_factors"]
    eligible = [x["recommendation_score"] for x in b["results"] if x["eligible"]]
    assert eligible == sorted(eligible, reverse=True)
    assert sum(x["recommended"] for x in b["results"]) <= 3


def test_wheat_profile(client, user):
    b = post(client, user, WHEAT_LIKE).json()
    assert b["results"][0]["crop_name"] == "Wheat"


def test_score_formula(client, user):
    b = post(client, user, ONION_LIKE).json()
    w = b["weights"]
    for x in b["results"]:
        exp = (w["agronomic"] * x["agronomic_score"] + w["timing"] * x["timing_score"]
               + w["profit"] * x["profit_score"])
        assert abs(exp - x["recommendation_score"]) < 0.05


def test_economics_are_consistent(client, user):
    b = post(client, user, {**ONION_LIKE, "area_acres": 2}).json()
    for x in b["results"]:
        e = x["economics"]
        assert e["area_acres"] == 2
        assert abs(e["gross_revenue"] - e["effective_yield_q"] * e["selling_price"]) \
            < 0.01 * e["gross_revenue"] + 2
        assert abs(e["net_profit"] - (e["gross_revenue"] - e["total_cost"])) <= 2
        assert e["net_profit_low"] <= e["net_profit"] <= e["net_profit_high"]
        assert x["timeline"]["selling"] == "2027-03"


def test_timing_feasibility(client, user):
    # 1 month from planting to selling: no crop can be ready
    b = post(client, user, {**ONION_LIKE, "selling_month": 12}).json()
    assert not any(x["feasible"] for x in b["results"])
    assert all(x["profit_score"] == 0 for x in b["results"])
    assert any("no crop" in w.lower() for w in b["warnings"])
    # 9 months: perishable crops would spoil, wheat can be stored
    b = post(client, user, {**WHEAT_LIKE, "selling_month": 8}).json()
    status = {x["crop_name"]: x["economics"]["status"] for x in b["results"]}
    assert status["Tomato"] == "spoiled" and status["Wheat"] == "stored"


def test_market_forecast_and_price_shap(client, user):
    b = post(client, user, ONION_LIKE).json()
    m = b["results"][0]["market"]
    assert m["target_month"] == "2027-03" and m["history"] and m["path"]
    assert m["path"][-1]["month"] >= "2027-03"
    assert m["price_low"] <= m["predicted_price"] <= m["price_high"]
    e = m["explanation"]
    assert e["headline"] and e["factors"]
    total = e["base_value"] + sum(t["shap_value"] for t in e["technical"]) + e["inflation_log"]
    assert abs(math.exp(total) * m["latest_price"] - m["predicted_price"]) \
        < 0.01 * m["predicted_price"]


def test_validation_and_warnings(client, user):
    assert post(client, user, {**ONION_LIKE, "ph": 15}).status_code == 422
    assert post(client, user, {**ONION_LIKE, "city": "Atlantis"}).status_code == 422
    assert post(client, user, {**ONION_LIKE, "state": "Kerala"}).status_code == 422
    r = post(client, user, {**ONION_LIKE, "rainfall": 900, "soil_type": "Black"})
    assert r.status_code == 201
    w = r.json()["warnings"]
    assert any("rainfall" in s for s in w) and any("Soil type" in s for s in w)


def test_analyze_does_not_save(client, user):
    r = post(client, user, ONION_LIKE, "analyze")
    assert r.status_code == 200 and "id" not in r.json()
    assert client.get("/api/history/recommendations", headers=user["headers"]).json()["total"] == 0


def test_explain_shap_additivity(client, user):
    inputs = {k: v for k, v in ONION_LIKE.items() if k != "planting_year"}
    r = post(client, user, {**inputs, "crop_name": "onion"}, "explain")
    assert r.status_code == 200
    b = r.json()
    total = b["base_value"] + sum(f["shap_value"] for f in b["factors"])
    assert abs(total - b["margin"]) < 1e-3   # SHAP additivity in log-odds space
    assert {g["group"] for g in b["groups"]} == {"soil", "weather", "timing", "location"}
    assert post(client, user, {**inputs, "crop_name": "rice"}, "explain").status_code == 422


def test_options_endpoint(client, user):
    b = client.get("/api/crop-recommendation/options", headers=user["headers"]).json()
    assert set(b["crops"]) == CROPS
    assert "Pune" in b["cities"] and "Nashik" in b["cities"]
    assert b["calendar"]["Wheat"]["planting_months"] == [10, 11, 12]


def test_monthly_price_endpoint(client, user):
    r = client.post("/api/price-prediction/monthly-forecast", headers=user["headers"],
                    json={"commodity": "onion", "city": "Pune", "target_month": 11,
                          "target_year": 2026})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["crop"] == "Onion" and b["target_month"] == "2026-11"
    assert b["explanation"]["factors"]
    bad = client.post("/api/price-prediction/monthly-forecast", headers=user["headers"],
                      json={"commodity": "rice", "target_month": 11, "target_year": 2026})
    assert bad.status_code == 422
