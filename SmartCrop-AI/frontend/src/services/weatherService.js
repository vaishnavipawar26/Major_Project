import api from "./api";

export const weatherService = {
  /** Growing-period climate for a city: { city, lat, lon, avgTemperature, avgHumidity, avgRainfall, source, monthsUsed }. */
  growingPeriod: ({ city, state, plantMonth, sellMonth }, signal) =>
    api.get("/api/weather", { params: { city, state, plantMonth, sellMonth }, signal }).then((r) => r.data),
};
