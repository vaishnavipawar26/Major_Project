from datetime import datetime

from sqlalchemy import (JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, Numeric,
                        SmallInteger, String, UniqueConstraint, func)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base


class CropRecommendation(Base):
    __tablename__ = "crop_recommendations"
    __table_args__ = (Index("ix_crop_recommendations_user_created", "user_id", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"),
                                         nullable=False)
    model_version_id: Mapped[int | None] = mapped_column(
        ForeignKey("model_versions.id", ondelete="SET NULL"), nullable=True)

    nitrogen: Mapped[float] = mapped_column(Float, nullable=False)
    phosphorus: Mapped[float] = mapped_column(Float, nullable=False)
    potassium: Mapped[float] = mapped_column(Float, nullable=False)
    temperature: Mapped[float] = mapped_column(Float, nullable=False)
    humidity: Mapped[float] = mapped_column(Float, nullable=False)
    ph: Mapped[float] = mapped_column(Float, nullable=False)
    rainfall: Mapped[float] = mapped_column(Float, nullable=False)
    soil_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    month: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    season: Mapped[str] = mapped_column(String(20), nullable=False)
    state: Mapped[str] = mapped_column(String(100), nullable=False)
    city: Mapped[str | None] = mapped_column(String(60), nullable=True)
    selling_month: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    planting_date: Mapped[str | None] = mapped_column(String(7), nullable=True)  # YYYY-MM
    selling_date: Mapped[str | None] = mapped_column(String(7), nullable=True)
    area_acres: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(),
                                                 nullable=False)

    user = relationship("User", back_populates="crop_recommendations")
    results = relationship("RecommendationResult", back_populates="recommendation",
                           cascade="all, delete-orphan", passive_deletes=True,
                           order_by="RecommendationResult.rank")


class RecommendationResult(Base):
    __tablename__ = "recommendation_results"
    __table_args__ = (UniqueConstraint("recommendation_id", "rank", name="uq_recommendation_rank"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    recommendation_id: Mapped[int] = mapped_column(
        ForeignKey("crop_recommendations.id", ondelete="CASCADE"), nullable=False, index=True)
    rank: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    crop_name: Mapped[str] = mapped_column(String(60), nullable=False)
    recommendation_score: Mapped[float] = mapped_column(Float, nullable=False)
    agronomic_score: Mapped[float] = mapped_column(Float, nullable=False)
    seasonal_score: Mapped[float] = mapped_column(Float, nullable=False)
    price_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    predicted_price: Mapped[float | None] = mapped_column(Numeric(12, 2, asdecimal=False),
                                                          nullable=True)
    expected_price_trend: Mapped[str | None] = mapped_column(String(30), nullable=True)
    timing_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    profit_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    expected_revenue: Mapped[float | None] = mapped_column(Numeric(14, 2, asdecimal=False),
                                                           nullable=True)
    expected_cost: Mapped[float | None] = mapped_column(Numeric(14, 2, asdecimal=False),
                                                        nullable=True)
    expected_profit: Mapped[float | None] = mapped_column(Numeric(14, 2, asdecimal=False),
                                                          nullable=True)
    recommended: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    explanation: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    recommendation = relationship("CropRecommendation", back_populates="results")
