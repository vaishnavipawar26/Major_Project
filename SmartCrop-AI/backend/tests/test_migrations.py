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


def test_budget_plan_migration_up_and_down_keeps_old_rows(monkeypatch):
    """0003 adds three nullable columns. Run on a throwaway SQLite copy (never a real database): an old row survives both ways."""
    from sqlalchemy import inspect, text
    db = Path(tempfile.mkdtemp()) / "budget_mig.db"
    url = f"sqlite:///{db.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    try:
        cfg = Config(str(BACKEND / "alembic.ini"))
        cfg.set_main_option("script_location", str(BACKEND / "alembic"))
        command.upgrade(cfg, "0002_economic")
        engine = create_engine(url)
        old = {"user_id": 1, "nitrogen": 80, "phosphorus": 45, "potassium": 85, "temperature": 23, "humidity": 58, "ph": 6.8,
               "rainfall": 70, "month": 11, "season": "Rabi", "state": "Maharashtra", "city": "Nashik", "selling_month": 3, "area_acres": 2.0}
        cols = ", ".join(old)
        with engine.begin() as c:
            c.execute(text(f"INSERT INTO crop_recommendations ({cols}) VALUES ({', '.join(':' + k for k in old)})"), old)
        assert "budget_inr" not in {x["name"] for x in inspect(engine).get_columns("crop_recommendations")}

        command.upgrade(cfg, "head")
        with engine.begin() as c:
            row = c.execute(text("SELECT nitrogen, city, budget_inr, priority, risk_level FROM crop_recommendations")).one()
            assert tuple(row) == (80, "Nashik", None, None, None)            # the old row loads unchanged, with NULL plan inputs
            c.execute(text("UPDATE crop_recommendations SET budget_inr = 40000, priority = 'balanced', risk_level = 'medium'"))

        command.downgrade(cfg, "0002_economic")
        engine = create_engine(url)
        names = {x["name"] for x in inspect(engine).get_columns("crop_recommendations")}
        assert not names & {"budget_inr", "priority", "risk_level"}
        with engine.begin() as c:
            assert c.execute(text("SELECT nitrogen, city FROM crop_recommendations")).one() == (80, "Nashik")
        command.upgrade(cfg, "head")        # and up again
    finally:
        get_settings.cache_clear()
