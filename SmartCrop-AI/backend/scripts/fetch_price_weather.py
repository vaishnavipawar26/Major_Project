"""Download daily observed/reanalysis weather for every mapped market (Open-Meteo Archive API).

Run from backend/ after build_market_locations:  python -m scripts.fetch_price_weather

* Only markets with >= MIN_MARKET_OBS reporting days are fetched (free-tier quota).
* One request per distinct 0.25-degree grid cell, cached as a parquet file in dataset/weather/cache/,
  so the script is resumable and never re-downloads a location it already has.
* Period: CLIMATOLOGY_START .. WEATHER_END. Years before the price data (2015-2022) are used
  only to compute location/day-of-year normals; they cannot leak into any 2023-2025 label.
* Variables (daily): temperature_2m_mean (degC), precipitation_sum (mm),
  relative_humidity_2m_mean (%). Units are those returned by the API and stored in the table.
* Source is the ERA5-family *reanalysis* ("best_match" model). It is an observation-like
  record of what happened, NOT a forecast that was available in advance.
* Missing days stay NaN (never zero-filled); a market-day with any NaN gets quality "partial".

Output: dataset/weather/market_weather_daily.parquet with columns
  date, market, latitude (market), longitude (market), grid_latitude, grid_longitude (the grid
  point Open-Meteo actually used), temperature_mean,
  precipitation, relative_humidity, weather_source,
  weather_quality_status, retrieved_at
"""
from __future__ import annotations

import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from app.ml.common import paths
from scripts._http import make_client

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"   # free, non-commercial use
CLIMATOLOGY_START = "2015-01-01"
MIN_MARKET_OBS = 500   # weather is fetched only for markets with at least this many reporting
                       # days (free-tier quota); other markets keep NaN weather features
GRID_DEG = 0.25   # ERA5 native resolution: markets inside one cell share one request
WEATHER_END = "2025-12-31"
# min/max temperature are not fetched: no feature uses them and each variable costs API quota
DAILY = ["temperature_2m_mean", "precipitation_sum", "relative_humidity_2m_mean"]
WEATHER_DIR = paths.DATASET_DIR / "weather"
CACHE_DIR = WEATHER_DIR / "cache"
OUT_PATH = WEATHER_DIR / "market_weather_daily.parquet"
SOURCE = "open-meteo archive (ERA5-family reanalysis, best_match)"


def fetch_location(client, lat: float, lon: float) -> pd.DataFrame:
    params = {"latitude": lat, "longitude": lon, "start_date": CLIMATOLOGY_START,
              "end_date": WEATHER_END, "daily": ",".join(DAILY), "timezone": "Asia/Kolkata"}
    for attempt in range(8):
        r = client.get(ARCHIVE_URL, params=params)
        if r.status_code == 200:
            j = r.json()
            d = pd.DataFrame(j["daily"]).rename(columns={
                "time": "date", "temperature_2m_mean": "temperature_mean",
                "precipitation_sum": "precipitation", "relative_humidity_2m_mean": "relative_humidity"})
            d["date"] = pd.to_datetime(d["date"])
            for c in ("temperature_mean", "precipitation", "relative_humidity"):
                d[c] = pd.to_numeric(d[c], errors="coerce")   # null -> NaN, never 0
            d["grid_latitude"], d["grid_longitude"] = j["latitude"], j["longitude"]
            return d
        reason = r.text[:200].lower() if r.status_code == 429 else ""
        if "daily" in reason:
            raise RuntimeError("Open-Meteo daily request limit reached; re-run tomorrow (cache is kept)")
        wait = (3700 if "hourly" in reason else 65) if r.status_code == 429 else 2 ** attempt
        print(f"  HTTP {r.status_code} for ({lat},{lon}); retry in {wait}s", flush=True)
        time.sleep(wait)
    raise RuntimeError(f"Open-Meteo archive failed for ({lat}, {lon}): HTTP {r.status_code}")


def main() -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    loc = pd.read_csv(paths.CROP_PRICE_DIR / "market_locations.csv")
    loc = loc[loc["status"] == "mapped"].copy()
    sup = pd.read_csv(paths.CROP_PRICE_DIR / "supported_series.csv")
    obs = sup[sup["Market"] != "All markets (state median)"].groupby("Market")["observations"].max()
    loc = loc[loc["market"].map(obs).fillna(0) >= MIN_MARKET_OBS].copy()
    # snap each market to the centre of its 0.25-degree cell: the weather grid point used for it
    loc["grid_lat"] = (loc["latitude"] / GRID_DEG).round() * GRID_DEG
    loc["grid_lon"] = (loc["longitude"] / GRID_DEG).round() * GRID_DEG
    coords = loc[["grid_lat", "grid_lon"]].drop_duplicates().reset_index(drop=True)
    print(f"{len(loc)} mapped markets, {len(coords)} distinct coordinates", flush=True)
    retrieved = {}
    with make_client(60.0) as client:
        for i, (lat, lon) in enumerate(zip(coords["grid_lat"], coords["grid_lon"]), 1):
            f = CACHE_DIR / f"{lat:.4f}_{lon:.4f}.parquet"
            if f.exists():
                continue
            d = fetch_location(client, lat, lon)
            d["retrieved_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
            d.to_parquet(f, index=False)
            print(f"[{i}/{len(coords)}] {lat:.4f},{lon:.4f} -> {len(d)} days", flush=True)
            time.sleep(1.0)

    frames = []
    for m, lat, lon, glat, glon in zip(loc["market"], loc["latitude"], loc["longitude"],
                                       loc["grid_lat"], loc["grid_lon"]):
        d = pd.read_parquet(CACHE_DIR / f"{glat:.4f}_{glon:.4f}.parquet")
        d.insert(1, "market", m)
        d.insert(2, "latitude", lat)
        d.insert(3, "longitude", lon)
        frames.append(d)
    w = pd.concat(frames, ignore_index=True)
    vals = ["temperature_mean", "precipitation", "relative_humidity"]
    w["weather_source"] = SOURCE
    w["weather_quality_status"] = np.where(w[vals].isna().any(axis=1), "partial", "ok")
    w = w.sort_values(["market", "date"]).reset_index(drop=True)
    w.to_parquet(OUT_PATH, index=False)
    print(f"wrote {OUT_PATH} rows={len(w):,} markets={w['market'].nunique()}")
    print(w["weather_quality_status"].value_counts().to_string())
    print(w[vals].describe().round(2).to_string())


if __name__ == "__main__":
    main()
