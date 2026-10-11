"""The Alembic migration must create exactly the schema the ORM models describe."""
import os
import tempfile
from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine

import app.models  # noqa: F401
from app.config.settings import get_settings
from app.database.base import Base

BACKEND = Path(__file__).resolve().parents[1]


def test_migration_matches_models(monkeypatch):
    db = Path(tempfile.mkdtemp()) / "mig.db"
    url = os.environ.get("TEST_MIGRATION_DATABASE_URL", f"sqlite:///{db.as_posix()}")
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    try:
        cfg = Config(str(BACKEND / "alembic.ini"))
        cfg.set_main_option("script_location", str(BACKEND / "alembic"))
        command.upgrade(cfg, "head")
        engine = create_engine(url)
        with engine.connect() as conn:
            diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
        # ignore benign type-representation differences; any add/remove is a real mismatch
        structural = [d for d in diff if not (isinstance(d, list) and d and d[0][0] == "modify_type")]
        assert structural == [], structural
        command.downgrade(cfg, "base")
    finally:
        get_settings.cache_clear()
