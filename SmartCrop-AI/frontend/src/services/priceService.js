import api from "./api";

/** Query parameters for the growing location ({ name, latitude?, longitude? } or a saved label), or none. */
const growingParams = (g) => {
  if (!g) return {};
  const name = typeof g === "string" ? g : g.name;
  return { growing_location: name, ...(typeof g === "object" && g.latitude != null ? { latitude: g.latitude, longitude: g.longitude } : {}) };
};

export const priceService = {
  options: () => api.get("/api/price-prediction/options").then((r) => r.data),
  predict: (req) => api.post("/api/price-prediction/predict", req).then((r) => r.data),
  trend: (req) => api.post("/api/price-prediction/trend", req).then((r) => r.data),
  explain: (req) => api.post("/api/price-prediction/explain", req).then((r) => r.data),
  locations: (q) => api.get("/api/price-prediction/locations", { params: { q } }).then((r) => r.data),
  popularLocations: () => api.get("/api/price-prediction/locations/popular").then((r) => r.data),
  weatherContext: (market, targetDate, growing = null) => api.get("/api/price-prediction/weather-context",
    { params: { market, target_date: targetDate, ...growingParams(growing) } }).then((r) => r.data),
  soilContext: (market, growing = null) => api.get("/api/price-prediction/soil-context",
    { params: { market, ...growingParams(growing) } }).then((r) => r.data),
  monthly: (req) => api.post("/api/price-prediction/monthly-forecast", req).then((r) => r.data),
};
