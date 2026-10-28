"""Import every model so Base.metadata is complete (used by Alembic)."""
from app.models.crop_recommendation import CropRecommendation, RecommendationResult
from app.models.environmental_record import EnvironmentalRecord
from app.models.model_version import ModelVersion
from app.models.price_prediction import PricePrediction
from app.models.user import User

__all__ = ["User", "ModelVersion", "PricePrediction", "CropRecommendation",
           "RecommendationResult", "EnvironmentalRecord"]
