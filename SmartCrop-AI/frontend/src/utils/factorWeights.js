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
    humidity: { ok: Boolean(wxOk && has(w.humidity_pct)), value: w?.humidity_pct },
    soil: { ok: Boolean(soilOk && s.soil_type), value: s?.soil_type },
    ph: { ok: Boolean(soilOk && has(s.ph)), value: s?.ph },
    location: { ok: Boolean(place), value: place ? String(place).split(",")[0] : null, full: place },
  };
}
