from datetime import datetime

from sqlalchemy import JSON, DateTime, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base


class ModelVersion(Base):
    """Which trained model produced a stored prediction (for reproducibility)."""

    __tablename__ = "model_versions"
    __table_args__ = (UniqueConstraint("model_type", "version", name="uq_model_type_version"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    model_type: Mapped[str] = mapped_column(String(50), nullable=False)
    version: Mapped[str] = mapped_column(String(50), nullable=False)
    algorithm: Mapped[str] = mapped_column(String(100), nullable=False)
    metrics: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    trained_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    registered_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(),
                                                    nullable=False)
