import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.database.connection import get_db
from app.ml.price_prediction.forecaster import PriceForecaster
from app.ml.price_prediction.monthly_forecaster import (MonthlyForecastError,
                                                       MonthlyPriceForecaster)
from app.ml.registry import require_monthly, require_price
from app.models.user import User
from app.schemas.price_prediction import (GrowingLocation, MonthlyForecastRequest, MonthlyForecastResponse,
                                          PriceExplainResponse, PriceForecastResponse,
                                          PriceOptionsResponse, PricePredictionResponse,
                                          PriceRequest)
from app.services import geocoding_service, price_service, price_weather_service

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


@router.get("/locations")
def locations(q: str = Query(min_length=2, max_length=150)) -> dict:
    """Places matching a typed growing location ("Nashik, Maharashtra, India"), best first, so the farmer can pick the right one. An empty
    list means nothing matched; 503 means the location service could not be reached."""
    places, err = geocoding_service.search(q)
    if err == "too_short":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Type at least 2 letters of the place name.")
    if err:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "The location search could not be reached. Please try again.")
    return {"query": q, "results": places, "source": geocoding_service.SOURCE}


@router.get("/locations/popular")
def popular_locations() -> dict:
    """Places offered before the farmer types anything: the project's Maharashtra cities with their verified coordinates. No network call,
    so the list is there even while the location search service is down."""
    return {"results": geocoding_service.popular(), "source": geocoding_service.CITY_SOURCE}


def _growing(growing_location: str | None, latitude: float | None, longitude: float | None) -> dict | None:
    """The growing location given as query parameters, resolved like the one in a prediction request; 422 if it cannot be found."""
    if not growing_location:
        return None
    try:
        given = GrowingLocation(name=growing_location, latitude=latitude, longitude=longitude)
    except ValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Give latitude and longitude together, or neither.") from exc
    place, reason = price_weather_service.resolve_growing(given.model_dump())
    if place is None and reason == "location_not_found":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "The growing location could not be found.")
    if place is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "The location search could not be reached. Please try again.")
    return place


_GROWING = Query(default=None, min_length=2, max_length=100, description="Where the crop is grown; weather/soil are looked up there")
_LAT = Query(default=None, ge=-90, le=90)
_LON = Query(default=None, ge=-180, le=180)


@router.get("/weather-context")
def weather_context(market: str = Query(min_length=2, max_length=150), target_date: dt.date = Query(),
                    growing_location: str | None = _GROWING, latitude: float | None = _LAT, longitude: float | None = _LON) -> dict:
    """Background weather for the growing location (or, without one, the market) and date (observed, forecast, typical or unavailable).
    The price model does not use it; it is shown to farmers as context only."""
    return price_weather_service.weather_context(market, target_date, _growing(growing_location, latitude, longitude))


@router.get("/weather-window")
def weather_window(market: str = Query(min_length=2, max_length=150), start_date: dt.date | None = Query(None),
                   growing_location: str | None = _GROWING, latitude: float | None = _LAT, longitude: float | None = _LON) -> dict:
    """Daily weather for the 60 days after ``start_date`` (default today), the price forecast's window: live forecast days, typical
    values for the time of year (labelled, not a forecast) and unavailable days. Context only; no model uses it."""
    return price_weather_service.weather_window(market, start_date or price_weather_service.today(),
                                                _growing(growing_location, latitude, longitude))


@router.get("/soil-context")
def soil_context(market: str = Query(min_length=2, max_length=150),
                 growing_location: str | None = _GROWING, latitude: float | None = _LAT, longitude: float | None = _LON) -> dict:
    """Regional soil-map estimate (pH and soil class) for the growing location's area (or, without one, the market's). Background
    information only: the price model does not use it, a failed lookup returns status "unavailable", and it never affects a price
    prediction."""
    return price_weather_service.soil_context(market, _growing(growing_location, latitude, longitude))
