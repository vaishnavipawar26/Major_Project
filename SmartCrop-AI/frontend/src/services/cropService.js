import api from "./api";

export const cropService = {
  options: () => api.get("/api/crop-recommendation/options").then((r) => r.data),
  featureRanges: () => api.get("/api/crop-recommendation/feature-ranges").then((r) => r.data),
  recommend: (req) => api.post("/api/crop-recommendation/recommend", req).then((r) => r.data),
  analyze: (req) => api.post("/api/crop-recommendation/analyze", req).then((r) => r.data),
  explain: (req) => api.post("/api/crop-recommendation/explain", req).then((r) => r.data),
};
