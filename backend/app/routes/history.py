from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.database.connection import get_db
from app.models.crop_recommendation import CropRecommendation
from app.models.price_prediction import PricePrediction
from app.models.user import User
from app.schemas.history import (HistorySummary, PriceHistoryItem, PriceHistoryPage,
                                 RecommendationHistoryItem, RecommendationHistoryPage)
from app.services import history_service

router = APIRouter(prefix="/api/history", tags=["History"])


@router.get("/summary", response_model=HistorySummary)
def summary(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    return history_service.summary(db, user.id)


@router.get("/price", response_model=PriceHistoryPage)
def price_history(limit: int = Query(10, ge=1, le=100), offset: int = Query(0, ge=0),
                  user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    return history_service.list_price(db, user.id, limit, offset)


@router.get("/price/{item_id}", response_model=PriceHistoryItem)
def price_item(item_id: int, user: User = Depends(get_current_user),
               db: Session = Depends(get_db)):
    return history_service.get_price(db, user.id, item_id)


@router.delete("/price/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_price(item_id: int, user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)) -> Response:
    history_service.delete_owned(db, PricePrediction, user.id, item_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/recommendations", response_model=RecommendationHistoryPage)
def recommendation_history(limit: int = Query(10, ge=1, le=100), offset: int = Query(0, ge=0),
                           user: User = Depends(get_current_user),
                           db: Session = Depends(get_db)) -> dict:
    return history_service.list_recommendations(db, user.id, limit, offset)


@router.get("/recommendations/{item_id}", response_model=RecommendationHistoryItem)
def recommendation_item(item_id: int, user: User = Depends(get_current_user),
                        db: Session = Depends(get_db)):
    return history_service.get_recommendation(db, user.id, item_id)


@router.delete("/recommendations/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recommendation(item_id: int, user: User = Depends(get_current_user),
                          db: Session = Depends(get_db)) -> Response:
    history_service.delete_owned(db, CropRecommendation, user.id, item_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
