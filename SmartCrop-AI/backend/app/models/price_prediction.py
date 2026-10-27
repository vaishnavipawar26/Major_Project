from datetime import date, datetime

from sqlalchemy import (JSON, Date, DateTime, Enum, Float, ForeignKey, Index, Integer, Numeric,
                        String, func)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base

PRICE_DIRECTIONS = ("Increasing", "Decreasing", "Stable")


class PricePrediction(Base):
    __tablename__ = "price_predictions"
    __table_args__ = (Index("ix_price_predictions_user_created", "user_id", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"),
                                         nullable=False)
    model_version_id: Mapped[int | None] = mapped_column(
        ForeignKey("model_versions.id", ondelete="SET NULL"), nullable=True)

    state: Mapped[str] = mapped_column(String(100), nullable=False)
    market: Mapped[str] = mapped_column(String(150), nullable=False)
    commodity: Mapped[str] = mapped_column(String(100), nullable=False)
    variety: Mapped[str] = mapped_column(String(100), nullable=False)
    input_date: Mapped[date] = mapped_column(Date, nullable=False)
    forecast_origin_date: Mapped[date] = mapped_column(Date, nullable=False)
    arrivals: Mapped[float | None] = mapped_column(Float, nullable=True)
    horizon_days: Mapped[int] = mapped_column(Integer, nullable=False)

    current_price: Mapped[float] = mapped_column(Numeric(12, 2, asdecimal=False), nullable=False)
    predicted_price: Mapped[float] = mapped_column(Numeric(12, 2, asdecimal=False), nullable=False)
    predicted_low: Mapped[float | None] = mapped_column(Numeric(12, 2, asdecimal=False))
    predicted_high: Mapped[float | None] = mapped_column(Numeric(12, 2, asdecimal=False))
    predicted_direction: Mapped[str] = mapped_column(Enum(*PRICE_DIRECTIONS,
                                                          name="price_direction"),
                                                     nullable=False)
    future_trend: Mapped[list | None] = mapped_column(JSON, nullable=True)
    sell_hold_suggestion: Mapped[str] = mapped_column(String(60), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(),
                                                 nullable=False)

    # The farmer's field conditions. Storage only: the price model does not use them. NULL = not recorded (never 0).
    temperature: Mapped[float | None] = mapped_column(Float, nullable=True, comment="degrees Celsius")
    humidity: Mapped[float | None] = mapped_column(Float, nullable=True, comment="relative humidity, percent (0-100)")
    ph: Mapped[float | None] = mapped_column(Float, nullable=True, comment="soil pH (0-14)")
    rainfall: Mapped[float | None] = mapped_column(Float, nullable=True, comment="millimetres per month")
    soil_type: Mapped[str | None] = mapped_column(String(50), nullable=True, comment="soil type label")
    growing_location: Mapped[str | None] = mapped_column(
        String(100), nullable=True, comment="where the crop is grown (city or district); not the selling market")

    user = relationship("User", back_populates="price_predictions")
