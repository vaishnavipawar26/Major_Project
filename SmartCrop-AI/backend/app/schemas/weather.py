from pydantic import BaseModel


class WeatherResponse(BaseModel):
    """Average weather of the last 3 completed seasons of the chosen planting-to-selling window."""
    temperature: float   # °C
    humidity: float      # %
    rainfall: float      # mm per month
