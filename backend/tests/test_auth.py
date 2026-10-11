from datetime import datetime, timedelta, timezone

import jwt
from sqlalchemy import select

from app.database.connection import SessionLocal
from app.models.user import User


def test_register_hashes_password_and_returns_token(client):
    r = client.post("/api/auth/register",
                    json={"name": "  Asha   Patil ", "email": "Asha@Example.com",
                          "password": "harvest2025"})
    assert r.status_code == 201
    body = r.json()
    assert body["token_type"] == "bearer" and body["access_token"]
    assert body["user"]["email"] == "asha@example.com"
    assert body["user"]["name"] == "Asha Patil"
    assert "password" not in str(body) and "password_hash" not in body["user"]
    with SessionLocal() as db:
        u = db.scalar(select(User).where(User.email == "asha@example.com"))
        assert u.password_hash != "harvest2025" and u.password_hash.startswith("$2")


def test_duplicate_email_rejected(client, user):
    r = client.post("/api/auth/register",
                    json={"name": "X Y", "email": user["email"].upper(), "password": "secret123"})
    assert r.status_code == 409


def test_weak_or_invalid_registration(client):
    assert client.post("/api/auth/register", json={"name": "A B", "email": "a@b.com",
                                                   "password": "short1"}).status_code == 422
    assert client.post("/api/auth/register", json={"name": "A B", "email": "a@b.com",
                                                   "password": "onlyletters"}).status_code == 422
    assert client.post("/api/auth/register", json={"name": "A B", "email": "not-an-email",
                                                   "password": "secret123"}).status_code == 422


def test_login(client, user):
    r = client.post("/api/auth/login", json={"email": user["email"], "password": "secret123"})
    assert r.status_code == 200 and r.json()["access_token"]
    bad = client.post("/api/auth/login", json={"email": user["email"], "password": "wrong999"})
    assert bad.status_code == 401
    nouser = client.post("/api/auth/login", json={"email": "nobody@x.com", "password": "abc12345"})
    assert nouser.status_code == 401


def test_me_requires_valid_token(client, user):
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me",
                      headers={"Authorization": "Bearer garbage"}).status_code == 401
    r = client.get("/api/auth/me", headers=user["headers"])
    assert r.status_code == 200 and r.json()["id"] == user["id"]


def test_expired_and_forged_tokens_rejected(client, user):
    now = datetime.now(timezone.utc)
    expired = jwt.encode({"sub": str(user["id"]), "type": "access", "iat": now - timedelta(hours=2),
                          "exp": now - timedelta(hours=1)},
                         "test-secret-key-that-is-at-least-32-chars", algorithm="HS256")
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {expired}"})
    assert r.status_code == 401 and "expired" in r.json()["detail"].lower()
    forged = jwt.encode({"sub": str(user["id"]), "type": "access", "iat": now,
                         "exp": now + timedelta(hours=1)}, "a-different-secret-key-0123456789",
                        algorithm="HS256")
    assert client.get("/api/auth/me",
                      headers={"Authorization": f"Bearer {forged}"}).status_code == 401


def test_profile_update(client, user):
    r = client.put("/api/auth/me", headers=user["headers"], json={"name": "New Name"})
    assert r.status_code == 200 and r.json()["name"] == "New Name"
    bad = client.put("/api/auth/me", headers=user["headers"],
                     json={"current_password": "wrong", "new_password": "newpass123"})
    assert bad.status_code == 400
    ok = client.put("/api/auth/me", headers=user["headers"],
                    json={"current_password": "secret123", "new_password": "newpass123"})
    assert ok.status_code == 200
    assert client.post("/api/auth/login", json={"email": user["email"],
                                                "password": "newpass123"}).status_code == 200


def test_protected_ml_endpoints_require_auth(client):
    assert client.get("/api/price-prediction/options").status_code == 401
    assert client.post("/api/crop-recommendation/recommend", json={}).status_code == 401
    assert client.get("/api/history/price").status_code == 401
