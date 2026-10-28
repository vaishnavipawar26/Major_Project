import { useEffect, useMemo, useState } from "react";
import { priceService } from "../services/priceService";

const LOADING = { state: "loading", data: null };

/**
 * Background weather and the regional soil-map estimate for the farmer's growing location (or, for older requests without one, the selling
 * market) and the selling date. Both are fetched on their own, so a slow or failed lookup never affects a price prediction; a failure becomes
 * { state: "error" } and the screen shows "Unavailable". Used by the result page and the explanation page, so the two always read the same
 * data. ``initial`` is the ``environmental_factors`` block of a prediction response: when it is given, its weather and soil answers are used
 * as they are and nothing is fetched again (older saved results without it fall back to the two lookups). ``growing`` is the request's
 * growing location ({ name, latitude, longitude } or a saved label).
 */
export function useFieldConditions(market, date, initial = null, growing = null) {
  const given = Boolean(initial?.weather && initial?.soil);
  const [weather, setWeather] = useState(given ? { state: "ok", data: initial.weather } : LOADING);
  const [soil, setSoil] = useState(given ? { state: "ok", data: initial.soil } : LOADING);
  const gName = typeof growing === "string" ? growing : growing?.name;
  const gLat = typeof growing === "object" ? growing?.latitude : null;
  const gLon = typeof growing === "object" ? growing?.longitude : null;
  const place = useMemo(() => (gName ? { name: gName, latitude: gLat ?? null, longitude: gLon ?? null } : null), [gName, gLat, gLon]);

  useEffect(() => {
    if (given) { setWeather({ state: "ok", data: initial.weather }); setSoil({ state: "ok", data: initial.soil }); }
  }, [given, initial]);

  useEffect(() => {
    if (given || !market || !date) return undefined;
    let live = true;
    setWeather(LOADING);
    priceService.weatherContext(market, date, place)
      .then((data) => live && setWeather({ state: "ok", data }))
      .catch(() => live && setWeather({ state: "error", data: null }));
    return () => { live = false; };
  }, [given, market, date, place]);

  useEffect(() => {
    if (given || !market) return undefined;
    let live = true;
    setSoil(LOADING);
    priceService.soilContext(market, place)
      .then((data) => live && setSoil({ state: "ok", data }))
      .catch(() => live && setSoil({ state: "error", data: null }));
    return () => { live = false; };
  }, [given, market, place]);

  return { weather, soil };
}
