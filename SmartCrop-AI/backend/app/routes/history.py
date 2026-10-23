from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.database.connection import get_db
from app.models.crop_recommendation import CropRecommendation
from app.models.price_prediction import PricePrediction
from app.models.user import User
from app.schemas.history import (HistorySummary, PriceHistoryItem, PriceHistoryPage,
                                 RecommendationHistoryItem, RecommendationHistoryPage)
from app.schemas.crop_recommendation import CropRequest
from app.services import history_service, recommendation_service

router = APIRouter(prefix="/api/history", tags=["History"])


def _with_policy(items: list, request: Request) -> list:
    """Attach the display policy and the latest recorded price to saved price predictions (read-only, no DB change)."""
    fc = getattr(request.app.state.registry, "price", None) if hasattr(request.app.state, "registry") else None
    if fc is None:
        return items
    out = []
    for it in items:
        m = PriceHistoryItem.model_validate(it)
        out.append(m.model_copy(update=fc.saved_view(m.state, m.market, m.commodity, m.variety, m.input_date, m.horizon_days,
                                                     m.forecast_origin_date, m.current_price, m.predicted_price)))
    return out


def _with_pick(items: list, request: Request) -> list:
    """Attach the personalised pick (re-derived from the saved inputs; only for records that have a budget, priority or risk level)."""
    reg = getattr(request.app.state, "registry", None) if hasattr(request.app.state, "registry") else None
    rec = getattr(reg, "crop", None)
    out = []
    for it in items:
        m = RecommendationHistoryItem.model_validate(it)
        if rec is not None and m.city and m.selling_month and (m.budget_inr is not None or m.priority or m.risk_level):
            try:
                body = CropRequest(nitrogen=m.nitrogen, phosphorus=m.phosphorus, potassium=m.potassium, temperature=m.temperature,
                                   humidity=m.humidity, ph=m.ph, rainfall=m.rainfall, soil_type=m.soil_type or "unknown", city=m.city,
                                   planting_month=m.month, selling_month=m.selling_month, area_acres=m.area_acres or 1.0,
                                   budget_inr=m.budget_inr, priority=m.priority, risk_level=m.risk_level)
                plan = recommendation_service.analyze(rec, body).get("personal_plan")
                m = m.model_copy(update={"personal_pick": plan["best_for_you"] if plan else None})
            except Exception:    # the history must still load
                pass
        out.append(m)
    return out


@router.get("/summary", response_model=HistorySummary)
def summary(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    s = history_service.summary(db, user.id)
    s["recent_recommendations"] = _with_pick(s["recent_recommendations"], request)
    s["recent_predictions"] = _with_policy(s["recent_predictions"], request)
    return s


@router.get("/price", response_model=PriceHistoryPage)
def price_history(request: Request, limit: int = Query(10, ge=1, le=100), offset: int = Query(0, ge=0),
                  user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    page = history_service.list_price(db, user.id, limit, offset)
    page["items"] = _with_policy(page["items"], request)
    return page


@router.get("/price/{item_id}", response_model=PriceHistoryItem)
def price_item(item_id: int, request: Request, user: User = Depends(get_current_user),
               db: Session = Depends(get_db)):
    return _with_policy([history_service.get_price(db, user.id, item_id)], request)[0]


@router.delete("/price/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_price(item_id: int, user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)) -> Response:
    history_service.delete_owned(db, PricePrediction, user.id, item_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/recommendations", response_model=RecommendationHistoryPage)
def recommendation_history(request: Request, limit: int = Query(10, ge=1, le=100), offset: int = Query(0, ge=0),
                           user: User = Depends(get_current_user),
                           db: Session = Depends(get_db)) -> dict:
    page = history_service.list_recommendations(db, user.id, limit, offset)
    page["items"] = _with_pick(page["items"], request)
    return page


@router.get("/recommendations/{item_id}", response_model=RecommendationHistoryItem)
def recommendation_item(item_id: int, request: Request, user: User = Depends(get_current_user),
                        db: Session = Depends(get_db)):
    return _with_pick([history_service.get_recommendation(db, user.id, item_id)], request)[0]


@router.delete("/recommendations/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recommendation(item_id: int, user: User = Depends(get_current_user),
                          db: Session = Depends(get_db)) -> Response:
    history_service.delete_owned(db, CropRecommendation, user.id, item_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
