// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/weatherService", () => ({ weatherService: { growingPeriod: vi.fn() } }));
vi.mock("../services/api", () => ({ errorMessage: (e) => e.message }));

import { weatherService } from "../services/weatherService";
import { useWeather } from "./useWeather";

const wx = (n) => ({ temperature: n, humidity: n, rainfall: n });
const base = { city: "Pune", plantMonth: 10, sellMonth: 2 };
const wait = { timeout: 3000 };

beforeEach(() => { weatherService.growingPeriod.mockReset(); });

describe("useWeather", () => {
  it("fetches once city, planting month and selling month are all set", async () => {
    weatherService.growingPeriod.mockResolvedValue(wx(1));
    const { result } = renderHook(() => useWeather(base));
    expect(result.current.state).toBe("loading");
    await waitFor(() => expect(result.current.state).toBe("ok"), wait);
    expect(weatherService.growingPeriod).toHaveBeenCalledTimes(1);
    expect(weatherService.growingPeriod.mock.calls[0][0]).toEqual(base);
    expect(result.current.data).toEqual(wx(1));
  });

  it("does not fetch while one of the three is missing", async () => {
    const { result } = renderHook(() => useWeather({ ...base, city: "" }));
    await new Promise((r) => setTimeout(r, 700));
    expect(weatherService.growingPeriod).not.toHaveBeenCalled();
    expect(result.current.state).toBe("idle");
  });

  it("re-fetches when the city, the planting month or the selling month changes", async () => {
    weatherService.growingPeriod.mockResolvedValue(wx(1));
    const { rerender } = renderHook((p) => useWeather(p), { initialProps: base });
    await waitFor(() => expect(weatherService.growingPeriod).toHaveBeenCalledTimes(1), wait);
    rerender({ ...base, city: "Nashik" });
    await waitFor(() => expect(weatherService.growingPeriod).toHaveBeenCalledTimes(2), wait);
    rerender({ ...base, city: "Nashik", plantMonth: 11 });
    await waitFor(() => expect(weatherService.growingPeriod).toHaveBeenCalledTimes(3), wait);
    rerender({ ...base, city: "Nashik", plantMonth: 11, sellMonth: 3 });
    await waitFor(() => expect(weatherService.growingPeriod).toHaveBeenCalledTimes(4), wait);
    expect(weatherService.growingPeriod.mock.calls.map((c) => c[0])).toEqual([
      base, { ...base, city: "Nashik" }, { city: "Nashik", plantMonth: 11, sellMonth: 2 }, { city: "Nashik", plantMonth: 11, sellMonth: 3 },
    ]);
  });

  it("cancels the old request and never lets a stale answer overwrite a newer one", async () => {
    const pending = [];
    weatherService.growingPeriod.mockImplementation((_, signal) => new Promise((resolve) => pending.push({ resolve, signal })));
    const { result, rerender } = renderHook((p) => useWeather(p), { initialProps: base });
    await waitFor(() => expect(pending.length).toBe(1), wait);
    rerender({ ...base, city: "Nashik" });
    await waitFor(() => expect(pending.length).toBe(2), wait);
    expect(pending[0].signal.aborted).toBe(true);          // the first request was cancelled
    pending[1].resolve(wx(2));                             // newer answer first ...
    await waitFor(() => expect(result.current.data).toEqual(wx(2)), wait);
    pending[0].resolve(wx(1));                             // ... then the stale one arrives late
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.data).toEqual(wx(2));
  });

  it("reports a failure", async () => {
    weatherService.growingPeriod.mockImplementation(() => Promise.reject(new Error("Weather data unavailable")));
    const { result } = renderHook(() => useWeather(base));
    await waitFor(() => expect(result.current.state).toBe("error"), wait);
    expect(result.current.error).toBe("Weather data unavailable");
  });
});
