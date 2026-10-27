import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.database.connection import get_db
from app.ml.price_prediction.forecaster import PriceForecaster
from app.ml.price_prediction.monthly_forecaster import (MonthlyForecastError,
                                                       MonthlyPriceForecaster)
from app.ml.registry import require_monthly, require_price
from app.models.user import User
from app.schemas.price_prediction import (MonthlyForecastRequest, MonthlyForecastResponse,
                                          PriceExplainResponse, PriceForecastResponse,
                                          PriceOptionsResponse, PricePredictionResponse,
                                          PriceRequest)
from app.services import price_service, price_weather_service

router = APIRouter(prefix="/api/price-prediction", tags=["Price prediction"],
                   dependencies=[Depends(get_current_user)])


@router.get("/options", response_model=PriceOptionsResponse)
def options(forecaster: PriceForecaster = Depends(require_price)) -> dict:
    """Supported crops and markets (only series with enough history) and today's date."""
    return price_service.options(forecaster)


@router.post("/predict", response_model=PricePredictionResponse,
             status_code=status.HTTP_201_CREATED)
def predict(body: PriceRequest, user: User = Depends(get_current_user),
            db: Session = Depends(get_db),
            forecaster: PriceForecaster = Depends(require_price)) -> dict:
    """Forecast from today to the target date (and beyond while the model is validated),
    with the best-time-to-sell advice, and save the result to the user's history."""
    return price_service.predict(db, user, forecaster, body)


@router.post("/trend", response_model=PriceForecastResponse)
def trend(body: PriceRequest, forecaster: PriceForecaster = Depends(require_price)) -> dict:
    """Same forecast as /predict without saving it; ``as_of`` re-opens a saved prediction."""
    return price_service.trend(forecaster, body)


@router.post("/explain", response_model=PriceExplainResponse)
def explain(body: PriceRequest, forecaster: PriceForecaster = Depends(require_price)) -> dict:
    """Plain-language SHAP explanation of the target-date forecast (and of the recommended
    selling date when it differs). Not saved."""
    return price_service.explain(forecaster, body)


@router.post("/monthly-forecast", response_model=MonthlyForecastResponse)
def monthly_forecast(body: MonthlyForecastRequest,
                     forecaster: MonthlyPriceForecaster = Depends(require_monthly)) -> dict:
    """Price forecast for a future (selling) month with monthly path and SHAP explanation."""
    crop = {c.lower(): c for c in forecaster.crop_codes}.get(body.commodity.strip().lower())
    if crop is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            f"'{body.commodity}' has no monthly price model.")
    city = None
    if body.city:
        city = {c.lower(): c for c in forecaster.meta["cities"]}.get(body.city.strip().lower())
        if city is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                                f"'{body.city}' is not a supported city.")
    try:
        return forecaster.forecast_path(crop, city, body.target_year, body.target_month)
    except MonthlyForecastError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


@router.get("/weather-context")
def weather_context(market: str = Query(min_length=2, max_length=150), target_date: dt.date = Query()) -> dict:
    """Background weather for the market and date (observed, forecast, typical or unavailable). The price model does
    not use it; it is shown to farmers as context only."""
    return price_weather_service.weather_context(market, target_date)


@router.get("/soil-context")
def soil_context(market: str = Query(min_length=2, max_length=150)) -> dict:
    """Regional soil-map estimate (pH and soil class) for the market's area. Background information only: the price model does not use
    it, a failed lookup returns status "unavailable", and it never affects a price prediction."""
    return price_weather_service.soil_context(market)
