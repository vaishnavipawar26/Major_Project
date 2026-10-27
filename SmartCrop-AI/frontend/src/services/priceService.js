import api from "./api";

export const priceService = {
  options: () => api.get("/api/price-prediction/options").then((r) => r.data),
  predict: (req) => api.post("/api/price-prediction/predict", req).then((r) => r.data),
  trend: (req) => api.post("/api/price-prediction/trend", req).then((r) => r.data),
  explain: (req) => api.post("/api/price-prediction/explain", req).then((r) => r.data),
  weatherContext: (market, targetDate) => api.get("/api/price-prediction/weather-context", { params: { market, target_date: targetDate } }).then((r) => r.data),
  soilContext: (market) => api.get("/api/price-prediction/soil-context", { params: { market } }).then((r) => r.data),
  monthly: (req) => api.post("/api/price-prediction/monthly-forecast", req).then((r) => r.data),
};
