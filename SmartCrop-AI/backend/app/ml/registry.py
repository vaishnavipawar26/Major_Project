"""Loads trained models once at application start-up (models are never trained per request)."""
from __future__ import annotations

import logging

from fastapi import HTTPException, Request, status

from app.ml.crop_recommendation.recommender import CropRecommender
from app.ml.price_prediction.forecaster import PriceForecaster
from app.ml.price_prediction.monthly_forecaster import MonthlyPriceForecaster

log = logging.getLogger(__name__)


class ModelRegistry:
    def __init__(self) -> None:
        self.price: PriceForecaster | None = None
        self.monthly: MonthlyPriceForecaster | None = None
        self.crop: CropRecommender | None = None
        self.errors: dict[str, str] = {}

    def load(self) -> "ModelRegistry":
        try:
            self.price = PriceForecaster()
        except Exception as exc:  # missing artifacts -> endpoints answer 503
            self.errors["price"] = f"{type(exc).__name__}: {exc}"
            log.error("Price model not loaded: %s", exc)
        try:
            self.monthly = MonthlyPriceForecaster()
        except Exception as exc:
            self.errors["monthly"] = f"{type(exc).__name__}: {exc}"
            log.error("Monthly price model not loaded: %s", exc)
        try:
            if self.monthly is None:
                raise RuntimeError("the monthly price model is required for recommendations")
            self.crop = CropRecommender(monthly_forecaster=self.monthly)
        except Exception as exc:
            self.errors["crop"] = f"{type(exc).__name__}: {exc}"
            log.error("Crop model not loaded: %s", exc)
        return self


def get_registry(request: Request) -> ModelRegistry:
    return request.app.state.registry


def require_price(request: Request) -> PriceForecaster:
    reg = get_registry(request)
    if reg.price is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Price model is not available. Run the training scripts first.")
    return reg.price


def require_crop(request: Request) -> CropRecommender:
    reg = get_registry(request)
    if reg.crop is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Crop recommendation model is not available. Run the training "
                            "scripts first.")
    return reg.crop


def require_monthly(request: Request) -> MonthlyPriceForecaster:
    reg = get_registry(request)
    if reg.monthly is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Monthly price model is not available. Run "
                            "scripts/train_monthly_price_model.py first.")
    return reg.monthly
