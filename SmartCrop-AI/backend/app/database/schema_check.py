"""Startup guard: the database must be at the newest Alembic revision, or the app stops with a clear message
instead of failing later inside a page ("Unknown column ...")."""
from __future__ import annotations

from pathlib import Path

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import inspect
from sqlalchemy.engine import Engine

import app.models  # noqa: F401  (registers the tables)
from app.database.base import Base

BACKEND = Path(__file__).resolve().parents[2]


class SchemaOutOfDate(RuntimeError):
    pass


def _head() -> str | None:
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    return ScriptDirectory.from_config(cfg).get_current_head()


def missing_columns(engine: Engine) -> list[str]:
    """``table.column`` names the models expect but the database does not have (a whole missing table counts every column)."""
    insp = inspect(engine)
    have = set(insp.get_table_names())
    out = []
    for table in Base.metadata.sorted_tables:
        cols = {c["name"] for c in insp.get_columns(table.name)} if table.name in have else set()
        out += [f"{table.name}.{c.name}" for c in table.columns if c.name not in cols]
    return out


def check_schema(engine: Engine) -> None:
    """Raise SchemaOutOfDate unless the database is at the newest revision. A database that was created straight from the models and
    never stamped (no alembic_version row) is accepted when it already has every table and column."""
    with engine.connect() as conn:
        current = MigrationContext.configure(conn).get_current_revision()
    head = _head()
    if current == head:
        return
    if current is None:
        missing = missing_columns(engine)
        if not missing:
            return
        detail = f"the database has no migration history and is missing {', '.join(missing[:6])}{' ...' if len(missing) > 6 else ''}"
    else:
        detail = f"the database is at revision '{current}' but this version of the app needs '{head}'"
    raise SchemaOutOfDate(
        f"The database schema is out of date: {detail}.\n"
        "  Run:  alembic upgrade head      (from the backend folder)\n"
        "  Back up first:  mysqldump -u <user> -p smartcrop_ai > backup.sql")
