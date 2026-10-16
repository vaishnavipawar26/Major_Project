from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth.dependencies import get_current_user
from app.schemas.weather import WeatherResponse
from app.services import weather_service
from app.services.weather_service import WeatherError

router = APIRouter(prefix="/api", tags=["Weather"], dependencies=[Depends(get_current_user)])


def _month(raw: str | None, name: str) -> int:
    try:
        n = int(raw)
    except (TypeError, ValueError):
        raise HTTPException(400, f"{name} must be an integer from 1 to 12") from None
    if not 1 <= n <= 12:
        raise HTTPException(400, f"{name} must be an integer from 1 to 12")
    return n


@router.get("/weather", response_model=WeatherResponse)
def weather(city: str = Query(""), planting_month: str | None = Query(None),
            selling_month: str | None = Query(None)) -> dict:
    """Average temperature, humidity and monthly rainfall of the last 3 completed seasons of the
    window from the planting month to the selling month (used to fill the crop form)."""
    city = " ".join(city.split())
    if not city or len(city) > 60:
        raise HTTPException(400, "city is required")
    plant, sell = _month(planting_month, "planting_month"), _month(selling_month, "selling_month")
    try:
        return weather_service.growing_period_weather(city, plant, sell)
    except WeatherError as e:
        raise HTTPException(e.status_code, e.message)
