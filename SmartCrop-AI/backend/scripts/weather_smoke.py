"""Manual smoke test of the live Open-Meteo lookup (needs internet).

Run from backend/:  python -m scripts.weather_smoke [city] [planting_month] [selling_month]
Default: Pune, October to February.
"""
from __future__ import annotations

import sys
from datetime import date

from app.services.weather_service import WeatherError, growing_period_weather, season_windows


def main() -> None:
    city = sys.argv[1] if len(sys.argv) > 1 else "Pune"
    plant = int(sys.argv[2]) if len(sys.argv) > 2 else 10
    sell = int(sys.argv[3]) if len(sys.argv) > 3 else 2
    print(f"{city}, months {plant} to {sell}")
    for start, end in season_windows(plant, sell, date.today()):
        print(f"  season {start} .. {end}")
    try:
        out = growing_period_weather(city, plant, sell)
    except WeatherError as e:
        raise SystemExit(f"failed: {e.status_code} {e.message}")
    print(f"temperature {out['temperature']} °C | humidity {out['humidity']} % | rainfall {out['rainfall']} mm/month")


if __name__ == "__main__":
    main()
