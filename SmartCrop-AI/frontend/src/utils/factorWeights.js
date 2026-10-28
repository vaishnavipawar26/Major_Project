// Target importance weights of the "What Influences Your Predicted Price?" chart. A product-design setting, NOT learned model weights and
// NOT measured contributions: the deployed price model does not use weather or soil. They are shown on one percentage scale and add up to 100.
export const FACTOR_WEIGHTS = [
  { id: "season", label: "Season", weight: 25 },
  { id: "market", label: "Crop & Selling Market", weight: 25 },
  { id: "temperature", label: "Temperature", weight: 12 },
  { id: "rainfall", label: "Rainfall", weight: 12 },
  { id: "humidity", label: "Humidity", weight: 8 },
  { id: "soil", label: "Soil Type", weight: 6 },
  { id: "ph", label: "Soil pH", weight: 5 },
  { id: "location", label: "Growing Location", weight: 7 },
];

export const WEIGHT_TOTAL = FACTOR_WEIGHTS.reduce((a, f) => a + f.weight, 0);

/** The factors that share the highest weight, from the configuration (so a tie is shown as a tie). */
export function topFactors(factors = FACTOR_WEIGHTS) {
  const max = Math.max(...factors.map((f) => f.weight));
  return { weight: max, ids: factors.filter((f) => f.weight === max).map((f) => f.id) };
}

/**
 * Whether each factor's data was found, from the same weather and soil answers the page already fetched (useFieldConditions).
 * Season and market always come from the request; the rest are "unavailable" when the lookup failed or has no value. Never a guess.
 */
export function availability({ weather, soil, growing, market }) {
  const w = weather?.data, s = soil?.data;
  const wxOk = weather?.state === "ok" && w && w.status !== "unavailable";
  const soilOk = soil?.state === "ok" && s && s.status === "estimate";
  const has = (v) => v !== null && v !== undefined;
  const place = growing?.available && growing?.value ? growing.value
    : [w, s].find((x) => x?.place_kind === "growing_location" && x.place)?.place || null;
  return {
    season: { ok: true },
    market: { ok: Boolean(market), value: market || null },
    temperature: { ok: Boolean(wxOk && has(w.temperature_c)), value: w?.temperature_c },
    rainfall: { ok: Boolean(wxOk && has(w.rainfall_mm)), value: w?.rainfall_mm },
    humidity: { ok: Boolean(wxOk && has(w.humidity_pct)), value: w?.humidity_pct },
    soil: { ok: Boolean(soilOk && s.soil_type), value: s?.soil_type },
    ph: { ok: Boolean(soilOk && has(s.ph)), value: s?.ph },
    location: { ok: Boolean(place), value: place ? String(place).split(",")[0] : null, full: place },
  };
}
