import api from "./api";

export const weatherService = {
  /** Average weather of the last 3 completed seasons of the planting-to-selling window: { temperature, humidity, rainfall (mm / month) }. */
  growingPeriod: ({ city, plantMonth, sellMonth }, signal) =>
    api.get("/api/weather", { params: { city, planting_month: plantMonth, selling_month: sellMonth }, signal }).then((r) => r.data),
};
