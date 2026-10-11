import api from "./api";

export const priceService = {
  options: () => api.get("/api/price-prediction/options").then((r) => r.data),
  predict: (req) => api.post("/api/price-prediction/predict", req).then((r) => r.data),
  trend: (req) => api.post("/api/price-prediction/trend", req).then((r) => r.data),
  explain: (req) => api.post("/api/price-prediction/explain", req).then((r) => r.data),
  monthly: (req) => api.post("/api/price-prediction/monthly-forecast", req).then((r) => r.data),
};
