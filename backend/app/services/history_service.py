"""History queries. Every query is filtered by the authenticated user's id; a record owned by
another user is reported as 404 so its existence is not revealed."""
from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models.crop_recommendation import CropRecommendation
from app.models.price_prediction import PricePrediction


def _page(db: Session, model, user_id: int, limit: int, offset: int, options=()):
    total = db.scalar(select(func.count()).select_from(model).where(model.user_id == user_id))
    items = db.scalars(select(model).where(model.user_id == user_id).options(*options)
                       .order_by(model.created_at.desc(), model.id.desc())
                       .limit(limit).offset(offset)).all()
    return {"total": total or 0, "limit": limit, "offset": offset, "items": items}


def list_price(db: Session, user_id: int, limit: int, offset: int) -> dict:
    return _page(db, PricePrediction, user_id, limit, offset)


def list_recommendations(db: Session, user_id: int, limit: int, offset: int) -> dict:
    return _page(db, CropRecommendation, user_id, limit, offset,
                 (selectinload(CropRecommendation.results),))


def _get_owned(db: Session, model, user_id: int, item_id: int, options=()):
    obj = db.scalar(select(model).where(model.id == item_id, model.user_id == user_id)
                    .options(*options))
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Record not found")
    return obj


def get_price(db: Session, user_id: int, item_id: int) -> PricePrediction:
    return _get_owned(db, PricePrediction, user_id, item_id)


def get_recommendation(db: Session, user_id: int, item_id: int) -> CropRecommendation:
    return _get_owned(db, CropRecommendation, user_id, item_id,
                      (selectinload(CropRecommendation.results),))


def delete_owned(db: Session, model, user_id: int, item_id: int) -> None:
    obj = _get_owned(db, model, user_id, item_id)
    db.delete(obj)
    db.commit()


def summary(db: Session, user_id: int, recent: int = 5) -> dict:
    p = list_price(db, user_id, recent, 0)
    r = list_recommendations(db, user_id, recent, 0)
    return {"total_price_predictions": p["total"], "total_crop_recommendations": r["total"],
            "recent_predictions": p["items"], "recent_recommendations": r["items"]}
