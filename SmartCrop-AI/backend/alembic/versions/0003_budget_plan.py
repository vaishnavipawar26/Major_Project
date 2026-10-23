"""budget- and risk-aware plan: the farmer's optional budget, priority and risk level

Revision ID: 0003_budget_plan
Revises: 0002_economic
Create Date: 2026-10-24

Three nullable columns on crop_recommendations. Existing rows keep NULL (= no personalised plan).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003_budget_plan"
down_revision: Union[str, None] = "0002_economic"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLUMNS = [
    sa.Column("budget_inr", sa.Float(), nullable=True),
    sa.Column("priority", sa.String(20), nullable=True),
    sa.Column("risk_level", sa.String(10), nullable=True),
]


def upgrade() -> None:
    with op.batch_alter_table("crop_recommendations") as b:
        for c in COLUMNS:
            b.add_column(c)


def downgrade() -> None:
    with op.batch_alter_table("crop_recommendations") as b:
        for c in reversed(COLUMNS):
            b.drop_column(c.name)
