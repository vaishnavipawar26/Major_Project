"""environmental_records: persistent, shared store of valid weather and soil-map answers

Revision ID: 0005_environmental_records
Revises: 0004_price_conditions
Create Date: 2026-10-28

One NEW table; no existing table, column or row is touched. Downgrade drops only this table.
Weather rows: one day for one market town, observed (archive) or forecast, kept apart by data_type.
Soil rows: the regional soil-map estimate for a place (date_key 'static').
The unique constraint (record_type, latitude, longitude, date_key, data_type) prevents duplicates when several users ask at once.
Only valid provider answers are stored; failures are never written. The price model does not read this table.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005_environmental_records"
down_revision: Union[str, None] = "0004_price_conditions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "environmental_records",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("record_type", sa.String(10), nullable=False),
        sa.Column("data_type", sa.String(16), nullable=False),
        sa.Column("market", sa.String(150), nullable=False),
        sa.Column("place_name", sa.String(120), nullable=True),
        sa.Column("latitude", sa.Numeric(9, 4), nullable=False),
        sa.Column("longitude", sa.Numeric(9, 4), nullable=False),
        sa.Column("date_key", sa.String(10), nullable=False),
        sa.Column("observation_date", sa.Date(), nullable=True),
        sa.Column("temperature_c", sa.Float(), nullable=True, comment="daily mean air temperature at 2 m, degrees Celsius"),
        sa.Column("humidity_pct", sa.Float(), nullable=True, comment="daily mean relative humidity at 2 m, percent"),
        sa.Column("rainfall_mm", sa.Float(), nullable=True, comment="precipitation total for the day, millimetres"),
        sa.Column("soil_ph", sa.Float(), nullable=True, comment="pH in water, 0-5 cm (5-15 cm if the top layer is empty)"),
        sa.Column("soil_ph_scope", sa.String(20), nullable=True),
        sa.Column("soil_type", sa.String(60), nullable=True, comment="WRB reference soil group, as the source names it"),
        sa.Column("source", sa.String(120), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("retrieved_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("record_type", "latitude", "longitude", "date_key", "data_type", name="uq_environmental_place_date_type"),
    )
    op.create_index("ix_environmental_market", "environmental_records", ["market"])


def downgrade() -> None:
    op.drop_index("ix_environmental_market", table_name="environmental_records")
    op.drop_table("environmental_records")
