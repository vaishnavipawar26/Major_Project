import api from "./api";

export const authService = {
  register: (data) => api.post("/api/auth/register", data).then((r) => r.data),
  login: (data) => api.post("/api/auth/login", data).then((r) => r.data),
  me: () => api.get("/api/auth/me").then((r) => r.data),
  updateProfile: (data) => api.put("/api/auth/me", data).then((r) => r.data),
};
