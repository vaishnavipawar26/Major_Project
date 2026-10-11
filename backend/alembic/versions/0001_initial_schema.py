"""initial schema: users, model_versions, price_predictions, crop_recommendations,
recommendation_results

Revision ID: 0001_initial
Revises:
Create Date: 2026-10-08

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MYSQL_OPTS = {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4",
              "mysql_collate": "utf8mb4_unicode_ci"}


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        **MYSQL_OPTS,
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "model_versions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("model_type", sa.String(50), nullable=False),
        sa.Column("version", sa.String(50), nullable=False),
        sa.Column("algorithm", sa.String(100), nullable=False),
        sa.Column("metrics", sa.JSON(), nullable=True),
        sa.Column("trained_at", sa.String(40), nullable=True),
        sa.Column("registered_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("model_type", "version", name="uq_model_type_version"),
        **MYSQL_OPTS,
    )

    op.create_table(
        "price_predictions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("model_version_id", sa.Integer(),
                  sa.ForeignKey("model_versions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("state", sa.String(100), nullable=False),
        sa.Column("market", sa.String(150), nullable=False),
        sa.Column("commodity", sa.String(100), nullable=False),
        sa.Column("variety", sa.String(100), nullable=False),
        sa.Column("input_date", sa.Date(), nullable=False),
        sa.Column("forecast_origin_date", sa.Date(), nullable=False),
        sa.Column("arrivals", sa.Float(), nullable=True),
        sa.Column("horizon_days", sa.Integer(), nullable=False),
        sa.Column("current_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("predicted_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("predicted_low", sa.Numeric(12, 2), nullable=True),
        sa.Column("predicted_high", sa.Numeric(12, 2), nullable=True),
        sa.Column("predicted_direction",
                  sa.Enum("Increasing", "Decreasing", "Stable", name="price_direction"),
                  nullable=False),
        sa.Column("future_trend", sa.JSON(), nullable=True),
        sa.Column("sell_hold_suggestion", sa.String(60), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        **MYSQL_OPTS,
    )
    op.create_index("ix_price_predictions_user_created", "price_predictions",
                    ["user_id", "created_at"])

    op.create_table(
        "crop_recommendations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("model_version_id", sa.Integer(),
                  sa.ForeignKey("model_versions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("nitrogen", sa.Float(), nullable=False),
        sa.Column("phosphorus", sa.Float(), nullable=False),
        sa.Column("potassium", sa.Float(), nullable=False),
        sa.Column("temperature", sa.Float(), nullable=False),
        sa.Column("humidity", sa.Float(), nullable=False),
        sa.Column("ph", sa.Float(), nullable=False),
        sa.Column("rainfall", sa.Float(), nullable=False),
        sa.Column("soil_type", sa.String(50), nullable=True),
        sa.Column("month", sa.SmallInteger(), nullable=False),
        sa.Column("season", sa.String(20), nullable=False),
        sa.Column("state", sa.String(100), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        **MYSQL_OPTS,
    )
    op.create_index("ix_crop_recommendations_user_created", "crop_recommendations",
                    ["user_id", "created_at"])

    op.create_table(
        "recommendation_results",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("recommendation_id", sa.Integer(),
                  sa.ForeignKey("crop_recommendations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("rank", sa.SmallInteger(), nullable=False),
        sa.Column("crop_name", sa.String(60), nullable=False),
        sa.Column("recommendation_score", sa.Float(), nullable=False),
        sa.Column("agronomic_score", sa.Float(), nullable=False),
        sa.Column("seasonal_score", sa.Float(), nullable=False),
        sa.Column("price_score", sa.Float(), nullable=True),
        sa.Column("price_available", sa.Boolean(), nullable=False),
        sa.Column("predicted_price", sa.Numeric(12, 2), nullable=True),
        sa.Column("expected_price_trend", sa.String(30), nullable=True),
        sa.Column("explanation", sa.JSON(), nullable=True),
        sa.UniqueConstraint("recommendation_id", "rank", name="uq_recommendation_rank"),
        **MYSQL_OPTS,
    )
    op.create_index("ix_recommendation_results_recommendation_id", "recommendation_results",
                    ["recommendation_id"])


def downgrade() -> None:
    op.drop_table("recommendation_results")
    op.drop_table("crop_recommendations")
    op.drop_table("price_predictions")
    op.drop_table("model_versions")
    op.drop_table("users")
