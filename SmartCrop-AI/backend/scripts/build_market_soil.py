"""Build dataset/soil/market_soil.csv: a regional soil-map estimate (pH and soil group) for each mapped selling market's town.

Run from backend/ with internet access to the ISRIC SoilGrids services:  python -m scripts.build_market_soil

Uses the same lookups as the result page (app.services.price_weather_service). A market whose lookup fails or has no map value gets an
EMPTY value in the table (never a default); the script can be re-run and only fills the markets that are still empty. Values are regional
estimates for the market's town, not measurements from any farm.
"""
from __future__ import annotations

import time

import pandas as pd

from app.ml.common import paths
from app.services import price_weather_service as pws

OUT = paths.DATASET_DIR / "soil" / "market_soil.csv"


def main() -> None:
    locs = pws._locations()
    locs = locs[locs["status"] == "mapped"].drop_duplicates("market")
    done = pd.read_csv(OUT) if OUT.exists() else pd.DataFrame(columns=["market", "soil_ph", "soil_class", "latitude", "longitude"])
    have = set(done.loc[done["soil_ph"].notna() | done["soil_class"].notna(), "market"])
    rows = [r for r in done.to_dict("records") if r["market"] in have]
    for _, m in locs.iterrows():
        if m["market"] in have:
            continue
        ph, _scope, _why = pws._wcs_ph(float(m["latitude"]), float(m["longitude"]))
        cls, _why2 = pws._wcs_class(float(m["latitude"]), float(m["longitude"]))
        rows.append({"market": m["market"], "soil_ph": ph, "soil_class": cls, "latitude": m["latitude"], "longitude": m["longitude"]})
        print(f"{m['market']}: pH {ph} class {cls}")
        time.sleep(0.3)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_csv(OUT, index=False)
    got = sum(1 for r in rows if r["soil_ph"] is not None and not pd.isna(r["soil_ph"]))
    print(f"wrote {OUT}: {len(rows)} markets, {got} with a pH")


if __name__ == "__main__":
    main()
