"""Test configuration.

By default the API tests use a temporary SQLite file so they run anywhere. To run the same
tests against MySQL, set TEST_DATABASE_URL to an EMPTY test database, e.g.
  TEST_DATABASE_URL=mysql+pymysql://user:pass@localhost:3306/smartcrop_ai_test
"""
import os
import tempfile
import uuid
from pathlib import Path

_tmp = Path(tempfile.mkdtemp()) / "test.db"
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", f"sqlite:///{_tmp.as_posix()}")
os.environ["JWT_SECRET_KEY"] = "test-secret-key-that-is-at-least-32-chars"
os.environ.setdefault("ACCESS_TOKEN_EXPIRE_MINUTES", "30")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.models  # noqa: E402,F401
from app.database.base import Base  # noqa: E402
from app.database.connection import engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def no_live_providers(monkeypatch):
    """Tests never call Open-Meteo or SoilGrids: by default every outside HTTP request fails at once (like being offline) and retries do
    not wait. A test that needs provider data replaces httpx.get with its own labelled fixture."""
    from app.services import geocoding_service, http_client

    def offline(*a, **k):
        raise http_client.httpx.ConnectError("tests run offline")
    monkeypatch.setattr(http_client.httpx, "get", offline)
    monkeypatch.setattr(http_client, "_pause", lambda s: None)
    http_client._down_until.clear()             # no back-off carried over from another test
    geocoding_service._cache.clear()            # nor remembered location searches


@pytest.fixture(scope="session")
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with TestClient(app) as c:
        yield c
    Base.metadata.drop_all(engine)


def make_user(client) -> dict:
    email = f"farmer_{uuid.uuid4().hex[:10]}@example.com"
    r = client.post("/api/auth/register",
                    json={"name": "Test Farmer", "email": email, "password": "secret123"})
    assert r.status_code == 201, r.text
    body = r.json()
    return {"email": email, "password": "secret123", "id": body["user"]["id"],
            "headers": {"Authorization": f"Bearer {body['access_token']}"}}


@pytest.fixture
def user(client):
    return make_user(client)


@pytest.fixture
def other_user(client):
    return make_user(client)
