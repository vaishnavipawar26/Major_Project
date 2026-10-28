"""farmer's field conditions on a price prediction: temperature, humidity, pH, rainfall, soil type, growing location

Revision ID: 0004_price_conditions
Revises: 0003_budget_plan
Create Date: 2026-10-27

Approved and applied on 2026-10-27 (first written as a proposal in alembic/proposed/).

Six nullable columns on price_predictions. Existing rows keep NULL (= not recorded); nothing is rewritten, nothing is dropped.
Units are written into the column comments:
  temperature       degrees Celsius
  humidity          relative humidity, percent (0-100)
  ph                soil pH (0-14)
  rainfall          millimetres per month (same unit as crop_recommendations.rainfall)
  soil_type         text label, same vocabulary as crop_recommendations.soil_type
  growing_location  where the farmer GROWS the crop (city or district); separate from price_predictions.market (where it is SOLD)
Nitrogen, phosphorus and potassium are deliberately not included.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004_price_conditions"
down_revision: Union[str, None] = "0003_budget_plan"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLUMNS = [
    sa.Column("temperature", sa.Float(), nullable=True, comment="degrees Celsius"),
    sa.Column("humidity", sa.Float(), nullable=True, comment="relative humidity, percent (0-100)"),
    sa.Column("ph", sa.Float(), nullable=True, comment="soil pH (0-14)"),
    sa.Column("rainfall", sa.Float(), nullable=True, comment="millimetres per month"),
    sa.Column("soil_type", sa.String(50), nullable=True, comment="soil type label"),
    sa.Column("growing_location", sa.String(100), nullable=True, comment="where the crop is grown (city or district); not the selling market"),
]


def upgrade() -> None:
    with op.batch_alter_table("price_predictions") as b:
        for c in COLUMNS:
            b.add_column(c)


def downgrade() -> None:
    with op.batch_alter_table("price_predictions") as b:
        for c in reversed(COLUMNS):
            b.drop_column(c.name)
