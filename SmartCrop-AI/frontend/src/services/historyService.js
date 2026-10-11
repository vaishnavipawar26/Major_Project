import api from "./api";

export const historyService = {
  summary: () => api.get("/api/history/summary").then((r) => r.data),
  price: (limit = 10, offset = 0) =>
    api.get("/api/history/price", { params: { limit, offset } }).then((r) => r.data),
  priceItem: (id) => api.get(`/api/history/price/${id}`).then((r) => r.data),
  deletePrice: (id) => api.delete(`/api/history/price/${id}`),
  recommendations: (limit = 10, offset = 0) =>
    api.get("/api/history/recommendations", { params: { limit, offset } }).then((r) => r.data),
  recommendationItem: (id) => api.get(`/api/history/recommendations/${id}`).then((r) => r.data),
  deleteRecommendation: (id) => api.delete(`/api/history/recommendations/${id}`),
};
