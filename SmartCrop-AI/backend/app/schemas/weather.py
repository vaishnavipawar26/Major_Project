from pydantic import BaseModel


class WeatherResponse(BaseModel):
    """Growing-period climate for a city (field names are camelCase, as the frontend expects)."""
    city: str
    lat: float
    lon: float
    avgTemperature: float   # °C
    avgHumidity: float      # %
    avgRainfall: float      # mm per month
    source: str
    monthsUsed: list[int]
