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
    assert top["recommended"] and top["crop_name"] == b["best_overall"]
    onion = next(x for x in b["results"] if x["crop_name"] == "Onion")
    assert onion["recommended"] and onion["range_fit"]["soil"]["within"] == 4
    assert top["why"] and top["summary"] and top["important_factors"]
    eligible = [x["recommendation_score"] for x in b["results"] if x["eligible"]]
    assert eligible == sorted(eligible, reverse=True)
    # eligible crops always rank above ineligible ones
    flags = [x["eligible"] for x in b["results"]]
    assert flags == sorted(flags, reverse=True)
    assert sum(x["recommended"] for x in b["results"]) <= 3


def test_wheat_profile(client, user):
    b = post(client, user, WHEAT_LIKE).json()
    assert b["results"][0]["crop_name"] == "Wheat"


def test_agronomic_score_is_the_share_of_values_in_range(client, user):
    """A = 100 x (soil + weather values inside the crop's typical range) / 7, so a crop that fits
    every value scores 100 even when another crop fits too (the classifier probability is only
    relative and is reported separately as model_match_score)."""
    for body in (ONION_LIKE, WHEAT_LIKE):
        b = post(client, user, body, "analyze").json()
        for x in b["results"]:
            f = x["range_fit"]
            n = f["soil"]["within"] + f["weather"]["within"]
            assert abs(x["agronomic_score"] - 100 * n / 7) < 0.01
            assert 0 <= x["model_match_score"] <= 100


def test_equally_suitable_crops_are_ranked_by_profit(client, user):
    """Onion and Brinjal both fit all 7 values; Brinjal earns far more, so it must rank first."""
    b = post(client, user, {**ONION_LIKE, "potassium": 80}, "analyze").json()
    by = {x["crop_name"]: x for x in b["results"]}
    assert by["Onion"]["agronomic_score"] == by["Brinjal"]["agronomic_score"] == 100
    if by["Brinjal"]["eligible"] and by["Brinjal"]["economics"]["net_profit"] > by["Onion"]["economics"]["net_profit"]:
        assert by["Brinjal"]["rank"] < by["Onion"]["rank"]
        assert b["best_overall"] == "Brinjal" == b["highest_profit"]


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
    r = post(client, user, {**ONION_LIKE, "rainfall": 900})
    assert r.status_code == 201
    assert any("rainfall" in s for s in r.json()["warnings"])
    # soil type: only the known values are accepted; skipped / "Not sure" become "unknown"
    assert post(client, user, {**ONION_LIKE, "soil_type": "Black"}).status_code == 422
    for given in (None, "", "Not sure / skip", "unknown"):
        assert post(client, user, {**ONION_LIKE, "soil_type": given}, "analyze").status_code == 200
    for given in ("Sandy loam", "Alluvial soil", "clay_loam"):
        assert post(client, user, {**ONION_LIKE, "soil_type": given}, "analyze").status_code == 200


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


def test_loss_making_crop_is_never_recommended(client, user):
    """Eligibility needs a positive expected profit, whatever the soil match."""
    for body in (ONION_LIKE, WHEAT_LIKE, {**ONION_LIKE, "area_acres": 3}):
        b = post(client, user, body, "analyze").json()
        for x in b["results"]:
            if x["economics"] and x["economics"]["net_profit"] <= 0:
                assert not x["eligible"] and not x["recommended"] and not x["profitable"]
            if x["recommended"]:
                assert x["profitable"] and x["feasible"] and not x["low_agronomic_suitability"]


def test_best_overall_and_highest_profit_are_reported_separately(client, user):
    b = post(client, user, ONION_LIKE, "analyze").json()
    rec = [x["crop_name"] for x in b["results"] if x["recommended"]]
    assert b["best_overall"] == (rec[0] if rec else None) and rec
    feasible = [x for x in b["results"] if x["feasible"] and x["economics"]]
    top = max(feasible, key=lambda x: x["economics"]["net_profit"])
    assert b["highest_profit"] == top["crop_name"]
    assert top["profit_rank"] == 1
    assert sorted(x["profit_rank"] for x in feasible) == list(range(1, len(feasible) + 1))
    # profit of the highest-profit crop is at least that of the best overall crop
    best = next(x for x in b["results"] if x["crop_name"] == b["best_overall"])
    assert top["economics"]["net_profit"] >= best["economics"]["net_profit"]
    assert b["generated_at"]


def test_range_fit_matches_inputs(client, user):
    b = post(client, user, ONION_LIKE, "analyze").json()
    onion = next(x for x in b["results"] if x["crop_name"] == "Onion")
    fit = onion["range_fit"]
    assert fit["soil"]["total"] == 4 and fit["weather"]["total"] == 3
    assert fit["soil"]["within"] == sum(fit["soil"]["items"].values())
    assert fit["soil"]["within"] >= 3 and fit["weather"]["within"] >= 2


def test_nothing_recommended_when_no_crop_is_ready(client, user):
    b = post(client, user, {**ONION_LIKE, "selling_month": 12}, "analyze").json()
    assert b["best_overall"] is None and b["highest_profit"] is None
    assert not any(x["recommended"] for x in b["results"])


def test_seasonal_outlook_is_structured(client, user):
    b = post(client, user, ONION_LIKE, "analyze").json()
    onion = next(x for x in b["results"] if x["crop_name"] == "Onion")
    s = onion["market"]["explanation"]["seasonal"]
    assert s["month"] == 3 and isinstance(s["price_vs_avg_pct"], float)


def test_viability_follows_the_range_fit_not_the_relative_classifier(client, user):
    """A crop is viable when at least 5 of the 7 values are in its typical range; the relative
    classifier probability (model_match_score) plays no part in eligibility or the score."""
    for body in (ONION_LIKE, WHEAT_LIKE):
        b = post(client, user, body, "analyze").json()
        for x in b["results"]:
            f = x["range_fit"]
            n = f["soil"]["within"] + f["weather"]["within"]
            assert x["low_agronomic_suitability"] == (n < 5)
            assert x["eligible"] == (n >= 5 and x["feasible"] and x["profitable"])


def test_feature_ranges_come_from_the_data(client, user):
    b = client.get("/api/crop-recommendation/feature-ranges", headers=user["headers"]).json()
    assert set(b) == {"N", "P", "K", "temperature", "humidity", "ph", "rainfall"}
    for f, r in b.items():
        assert set(r["perCrop"]) == CROPS and r["min"] < r["max"]
        for low, high in r["perCrop"].values():
            assert low <= high
            assert r["min"] <= low and high <= r["max"]


def test_corners_and_middle_of_the_range_do_not_warn(client, user):
    """Smoke test: every input at its dataset min, max and middle, with each soil type, gives a valid
    crop ranking and no out-of-range warning (the dataset covers the whole app range)."""
    ranges = client.get("/api/crop-recommendation/feature-ranges", headers=user["headers"]).json()
    field = {"N": "nitrogen", "P": "phosphorus", "K": "potassium", "ph": "ph",
             "temperature": "temperature", "humidity": "humidity", "rainfall": "rainfall"}
    for corner in ("min", "max", "mid"):
        values = {field[f]: (r["min"] if corner == "min" else r["max"] if corner == "max"
                             else (r["min"] + r["max"]) / 2) for f, r in ranges.items()}
        for soil in ("sandy_loam", "loam", "clay_loam", "alluvial", "unknown"):
            r = post(client, user, {**ONION_LIKE, **values, "soil_type": soil}, "analyze")
            assert r.status_code == 200, (corner, soil, r.text)
            b = r.json()
            assert not any("outside the range" in w for w in b["warnings"]), (corner, soil, b["warnings"])
            assert {x["crop_name"] for x in b["results"]} == CROPS
            assert all(0 <= x["probability"] <= 1 for x in b["results"])
            assert b["results"][0]["crop_name"] in CROPS


def test_soil_type_is_a_model_input_and_is_explained(client, user):
    b = post(client, user, {**ONION_LIKE, "soil_type": "sandy_loam"}, "analyze").json()
    feats = {f["feature"] for f in b["results"][0]["important_factors"]}
    assert "soil_type" in feats
    ranges = client.get("/api/crop-recommendation/feature-ranges", headers=user["headers"]).json()
    assert ranges["rainfall"]["min"] <= 1 and ranges["rainfall"]["max"] == 300


def test_weather_is_clipped_to_the_dataset_range_for_the_model_but_saved_as_entered(client, user):
    r = post(client, user, {**ONION_LIKE, "rainfall": 900, "temperature": 40, "humidity": 99})
    assert r.status_code == 201
    b = r.json()
    assert any("rainfall" in w and "limited to 300" in w for w in b["warnings"])
    # same answer as a request that already holds the clipped value (300), so the model never saw 900
    same = post(client, user, {**ONION_LIKE, "rainfall": 300, "temperature": 40, "humidity": 99}, "analyze").json()
    assert [x["crop_name"] for x in same["results"]] == [x["crop_name"] for x in b["results"]]
    saved = client.get(f"/api/history/recommendations/{b['id']}", headers=user["headers"]).json()
    assert saved["rainfall"] == 900          # the real value is what the user sees later
