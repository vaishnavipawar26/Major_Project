from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, Index, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base

RECORD_TYPES = ("weather", "soil")
DATA_TYPES = ("observed", "forecast", "soil_estimate")


class EnvironmentalRecord(Base):
    """One VALID environmental answer for a place (and, for weather, a day), shared by every user of this database.

    Weather rows hold one day's values for a market town: ``observed`` (a past day, from the archive) or ``forecast`` (today up to 15 days
    ahead); the two are kept apart, so a forecast is never mistaken for a record. Soil rows hold the regional soil-map estimate for a place
    (``soil_estimate``, ``date_key`` 'static'). Failed or empty provider answers are never stored. Values that are missing stay NULL, never 0.
    The price model does not use any of these values: they are context shown beside the prediction.
    """
    __tablename__ = "environmental_records"
    __table_args__ = (
        UniqueConstraint("record_type", "latitude", "longitude", "date_key", "data_type", name="uq_environmental_place_date_type"),
        Index("ix_environmental_market", "market"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    record_type: Mapped[str] = mapped_column(String(10), nullable=False)              # weather | soil
    data_type: Mapped[str] = mapped_column(String(16), nullable=False)                # observed | forecast | soil_estimate
    market: Mapped[str] = mapped_column(String(150), nullable=False)                  # market that first asked (others in the same town reuse it)
    place_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    latitude: Mapped[float] = mapped_column(Numeric(9, 4, asdecimal=False), nullable=False)
    longitude: Mapped[float] = mapped_column(Numeric(9, 4, asdecimal=False), nullable=False)
    date_key: Mapped[str] = mapped_column(String(10), nullable=False)                 # YYYY-MM-DD for weather, 'static' for soil
    observation_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    temperature_c: Mapped[float | None] = mapped_column(Float, nullable=True, comment="daily mean air temperature at 2 m, degrees Celsius")
    humidity_pct: Mapped[float | None] = mapped_column(Float, nullable=True, comment="daily mean relative humidity at 2 m, percent")
    rainfall_mm: Mapped[float | None] = mapped_column(Float, nullable=True, comment="precipitation total for the day, millimetres")
    soil_ph: Mapped[float | None] = mapped_column(Float, nullable=True, comment="pH in water, 0-5 cm (5-15 cm if the top layer is empty)")
    soil_ph_scope: Mapped[str | None] = mapped_column(String(20), nullable=True)      # town_centre | surrounding_area
    soil_type: Mapped[str | None] = mapped_column(String(60), nullable=True, comment="WRB reference soil group, as the source names it")

    source: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="ok")     # ok | partial (some values missing)
    retrieved_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)      # NULL = never stale (a past day's record)
