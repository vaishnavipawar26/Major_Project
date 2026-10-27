import { useEffect, useState } from "react";
import { priceService } from "../services/priceService";

const LOADING = { state: "loading", data: null };

/**
 * Background weather (for the selling market and date) and the regional soil-map estimate (for the market's area). Both are fetched on their
 * own, so a slow or failed lookup never affects a price prediction; a failure becomes { state: "error" } and the screen shows "Unavailable".
 * Used by the result page and the explanation page, so the two always read the same data.
 */
export function useFieldConditions(market, date) {
  const [weather, setWeather] = useState(LOADING);
  const [soil, setSoil] = useState(LOADING);

  useEffect(() => {
    if (!market || !date) return undefined;
    let live = true;
    setWeather(LOADING);
    priceService.weatherContext(market, date)
      .then((data) => live && setWeather({ state: "ok", data }))
      .catch(() => live && setWeather({ state: "error", data: null }));
    return () => { live = false; };
  }, [market, date]);

  useEffect(() => {
    if (!market) return undefined;
    let live = true;
    setSoil(LOADING);
    priceService.soilContext(market)
      .then((data) => live && setSoil({ state: "ok", data }))
      .catch(() => live && setSoil({ state: "error", data: null }));
    return () => { live = false; };
  }, [market]);

  return { weather, soil };
}
