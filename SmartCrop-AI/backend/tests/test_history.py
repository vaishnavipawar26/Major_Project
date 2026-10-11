from tests.test_crop_recommendation import ONION_LIKE
from tests.test_price_prediction import STATE_REQ, fixed_today  # noqa: F401 (autouse: fixed "today")


def test_users_only_see_their_own_history(client, user, other_user):
    p = client.post("/api/price-prediction/predict", headers=user["headers"], json=STATE_REQ).json()
    c = client.post("/api/crop-recommendation/recommend", headers=user["headers"],
                    json=ONION_LIKE).json()

    # owner sees both
    assert client.get(f"/api/history/price/{p['id']}", headers=user["headers"]).status_code == 200
    rec = client.get(f"/api/history/recommendations/{c['id']}", headers=user["headers"])
    assert rec.status_code == 200 and len(rec.json()["results"]) == 7

    # another user cannot list, read or delete them
    oh = other_user["headers"]
    assert client.get("/api/history/price", headers=oh).json()["total"] == 0
    assert client.get("/api/history/recommendations", headers=oh).json()["total"] == 0
    assert client.get(f"/api/history/price/{p['id']}", headers=oh).status_code == 404
    assert client.get(f"/api/history/recommendations/{c['id']}", headers=oh).status_code == 404
    assert client.delete(f"/api/history/price/{p['id']}", headers=oh).status_code == 404
    assert client.delete(f"/api/history/recommendations/{c['id']}", headers=oh).status_code == 404

    # still there for the owner
    assert client.get(f"/api/history/price/{p['id']}", headers=user["headers"]).status_code == 200


def test_summary_and_delete(client, user):
    client.post("/api/price-prediction/predict", headers=user["headers"], json=STATE_REQ)
    c = client.post("/api/crop-recommendation/recommend", headers=user["headers"],
                    json=ONION_LIKE).json()
    s = client.get("/api/history/summary", headers=user["headers"]).json()
    assert s["total_price_predictions"] == 1 and s["total_crop_recommendations"] == 1
    assert s["recent_recommendations"][0]["results"][0]["rank"] == 1
    d = client.delete(f"/api/history/recommendations/{c['id']}", headers=user["headers"])
    assert d.status_code == 204
    s = client.get("/api/history/summary", headers=user["headers"]).json()
    assert s["total_crop_recommendations"] == 0


def test_pagination(client, user):
    for _ in range(3):
        client.post("/api/crop-recommendation/recommend", headers=user["headers"], json=ONION_LIKE)
    page = client.get("/api/history/recommendations?limit=2&offset=0",
                      headers=user["headers"]).json()
    assert page["total"] == 3 and len(page["items"]) == 2
    assert client.get("/api/history/recommendations?limit=500",
                      headers=user["headers"]).status_code == 422
