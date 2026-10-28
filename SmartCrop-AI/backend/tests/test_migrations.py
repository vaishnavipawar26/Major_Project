"""The Alembic migration must create exactly the schema the ORM models describe."""
import os
import tempfile
from pathlib import Path

import pytest
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


def test_environmental_records_migration_up_and_down_on_a_clean_database_keeps_existing_rows(monkeypatch):
    """0005 adds one new table; an existing price prediction survives upgrade and downgrade, and the unique constraint blocks duplicates.
    Runs on a throwaway SQLite file (never a real database)."""
    from sqlalchemy import inspect, text
    from sqlalchemy.exc import IntegrityError
    db = Path(tempfile.mkdtemp()) / "env_mig.db"
    url = f"sqlite:///{db.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    try:
        cfg = Config(str(BACKEND / "alembic.ini"))
        cfg.set_main_option("script_location", str(BACKEND / "alembic"))
        command.upgrade(cfg, "0004_price_conditions")
        engine = create_engine(url)
        with engine.begin() as c:
            c.execute(text("INSERT INTO users (id, name, email, password_hash, created_at, updated_at) "
                           "VALUES (1, 't', 't@example.com', 'h', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"))
            c.execute(text("INSERT INTO price_predictions (user_id, state, market, commodity, variety, input_date, forecast_origin_date, "
                           "horizon_days, current_price, predicted_price, predicted_direction, sell_hold_suggestion, created_at) VALUES "
                           "(1, 'Maharashtra', 'APMC X', 'Cabbage', 'Other', '2026-10-27', '2025-12-31', 10, 1000, 1100, 'Stable', 'Hold', CURRENT_TIMESTAMP)"))
        assert "environmental_records" not in inspect(engine).get_table_names()

        command.upgrade(cfg, "head")
        engine = create_engine(url)
        assert "environmental_records" in inspect(engine).get_table_names()
        row = "('weather', 'forecast', 'APMC X', 18.5196, 73.8554, '2026-11-01', 24.0, 'test', 'ok', CURRENT_TIMESTAMP)"
        insert = ("INSERT INTO environmental_records (record_type, data_type, market, latitude, longitude, date_key, temperature_c, source, "
                  "status, retrieved_at) VALUES " + row)
        with engine.begin() as c:
            c.execute(text(insert))
            assert c.execute(text("SELECT market, predicted_price FROM price_predictions")).one() == ("APMC X", 1100)
        with pytest.raises(IntegrityError):              # the same place, day and type cannot be stored twice
            with engine.begin() as c:
                c.execute(text(insert))

        command.downgrade(cfg, "0004_price_conditions")
        engine = create_engine(url)
        assert "environmental_records" not in inspect(engine).get_table_names()
        with engine.begin() as c:
            assert c.execute(text("SELECT market FROM price_predictions")).one() == ("APMC X",)
        command.upgrade(cfg, "head")        # and up again
    finally:
        get_settings.cache_clear()


def test_startup_check_stops_with_a_clear_message_when_the_database_is_behind(monkeypatch):
    from app.database.schema_check import SchemaOutOfDate, check_schema
    db = Path(tempfile.mkdtemp()) / "behind.db"
    url = f"sqlite:///{db.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    try:
        cfg = Config(str(BACKEND / "alembic.ini"))
        cfg.set_main_option("script_location", str(BACKEND / "alembic"))
        engine = create_engine(url)
        command.upgrade(cfg, "0002_economic")
        try:
            check_schema(engine)
            raise AssertionError("should have refused an out-of-date database")
        except SchemaOutOfDate as e:
            assert "alembic upgrade head" in str(e) and "mysqldump" in str(e) and "0002_economic" in str(e)
        command.upgrade(cfg, "head")
        check_schema(engine)                                   # at head: fine
    finally:
        get_settings.cache_clear()


def test_startup_check_accepts_a_database_made_from_the_models_and_rejects_one_missing_columns():
    from sqlalchemy import text
    from app.database.schema_check import SchemaOutOfDate, check_schema
    engine = create_engine(f"sqlite:///{(Path(tempfile.mkdtemp()) / 'plain.db').as_posix()}")
    Base.metadata.create_all(engine)
    check_schema(engine)                                       # no alembic history but nothing missing
    with engine.begin() as c:
        c.execute(text("ALTER TABLE crop_recommendations DROP COLUMN budget_inr"))
    try:
        check_schema(engine)
        raise AssertionError("should have refused a database missing a column")
    except SchemaOutOfDate as e:
        assert "crop_recommendations.budget_inr" in str(e)
