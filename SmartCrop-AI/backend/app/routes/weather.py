from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth.dependencies import get_current_user
from app.schemas.weather import WeatherResponse
from app.services import weather_service
from app.services.weather_service import WeatherError

router = APIRouter(prefix="/api", tags=["Weather"], dependencies=[Depends(get_current_user)])


@router.get("/weather", response_model=WeatherResponse)
def weather(city: str = Query(min_length=2, max_length=60),
            state: str = Query("Maharashtra", min_length=2, max_length=60),
            plant_month: int = Query(alias="plantMonth", ge=1, le=12),
            sell_month: int = Query(alias="sellMonth", ge=1, le=12)) -> dict:
    """Average temperature, humidity and monthly rainfall of the last 3 years for the months
    from planting to selling, used to fill the crop form automatically."""
    try:
        return weather_service.growing_period_weather(city, state, plant_month, sell_month)
    except WeatherError as e:
        raise HTTPException(e.status_code, e.message)
