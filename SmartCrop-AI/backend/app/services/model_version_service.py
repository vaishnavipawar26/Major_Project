from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.model_version import ModelVersion


def get_or_create_model_version(db: Session, model_type: str, version: str, algorithm: str,
                                metrics: dict | None, trained_at: str | None) -> ModelVersion:
    stmt = select(ModelVersion).where(ModelVersion.model_type == model_type,
                                      ModelVersion.version == version)
    mv = db.scalar(stmt)
    if mv is not None:
        return mv
    mv = ModelVersion(model_type=model_type, version=version, algorithm=algorithm,
                      metrics=metrics, trained_at=trained_at)
    db.add(mv)
    try:
        db.flush()
    except IntegrityError:  # registered concurrently by another request
        db.rollback()
        mv = db.scalar(stmt)
    return mv
