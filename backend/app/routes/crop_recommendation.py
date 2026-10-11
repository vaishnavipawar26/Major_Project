from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.database.connection import get_db
from app.ml.crop_recommendation.recommender import CropRecommender
from app.ml.registry import require_crop
from app.models.user import User
from app.schemas.crop_recommendation import (CropAnalysis, CropExplainRequest,
                                             CropExplainResponse, CropRecommendationResponse,
                                             CropRequest, RecommendationOptions)
from app.services import recommendation_service

router = APIRouter(prefix="/api/crop-recommendation", tags=["Crop recommendation"],
                   dependencies=[Depends(get_current_user)])


@router.get("/options", response_model=RecommendationOptions)
def options(rec: CropRecommender = Depends(require_crop)) -> dict:
    """Supported crops and cities, cropping calendar, economics assumptions, input ranges."""
    return recommendation_service.options(rec)


@router.post("/recommend", response_model=CropRecommendationResponse,
             status_code=status.HTTP_201_CREATED)
def recommend(body: CropRequest, user: User = Depends(get_current_user),
              db: Session = Depends(get_db), rec: CropRecommender = Depends(require_crop)) -> dict:
    """All 7 crops ranked by suitability, timing and expected profit, with SHAP explanations,
    price forecasts and economics; saved to the user's history."""
    return recommendation_service.recommend(db, user, rec, body)


@router.post("/analyze", response_model=CropAnalysis)
def analyze(body: CropRequest, rec: CropRecommender = Depends(require_crop)) -> dict:
    """Same analysis as /recommend without saving (used to reopen a history item)."""
    return recommendation_service.analyze(rec, body)


@router.post("/explain", response_model=CropExplainResponse)
def explain(body: CropExplainRequest, rec: CropRecommender = Depends(require_crop)) -> dict:
    """SHAP explanation of why the model does (or does not) favour a given crop."""
    return recommendation_service.explain(rec, body)
