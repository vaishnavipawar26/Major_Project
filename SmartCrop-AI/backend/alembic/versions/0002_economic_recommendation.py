"""economic recommendation: city, selling month, area and profit columns

Revision ID: 0002_economic
Revises: 0001_initial
Create Date: 2026-10-10

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_economic"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

REC_COLUMNS = [
    sa.Column("city", sa.String(60), nullable=True),
    sa.Column("selling_month", sa.SmallInteger(), nullable=True),
    sa.Column("planting_date", sa.String(7), nullable=True),
    sa.Column("selling_date", sa.String(7), nullable=True),
    sa.Column("area_acres", sa.Float(), nullable=True),
]
RESULT_COLUMNS = [
    sa.Column("timing_score", sa.Float(), nullable=True),
    sa.Column("profit_score", sa.Float(), nullable=True),
    sa.Column("expected_revenue", sa.Numeric(14, 2), nullable=True),
    sa.Column("expected_cost", sa.Numeric(14, 2), nullable=True),
    sa.Column("expected_profit", sa.Numeric(14, 2), nullable=True),
    sa.Column("recommended", sa.Boolean(), nullable=True),
]


def upgrade() -> None:
    with op.batch_alter_table("crop_recommendations") as b:
        for c in REC_COLUMNS:
            b.add_column(c)
    with op.batch_alter_table("recommendation_results") as b:
        for c in RESULT_COLUMNS:
            b.add_column(c)


def downgrade() -> None:
    with op.batch_alter_table("recommendation_results") as b:
        for c in reversed(RESULT_COLUMNS):
            b.drop_column(c.name)
    with op.batch_alter_table("crop_recommendations") as b:
        for c in reversed(REC_COLUMNS):
            b.drop_column(c.name)
