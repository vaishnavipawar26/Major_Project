// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/historyService", () => ({
  historyService: { summary: vi.fn(), price: vi.fn(), recommendations: vi.fn(), deletePrice: vi.fn(), deleteRecommendation: vi.fn() },
}));
vi.mock("../services/api", () => ({ errorMessage: (e) => e.message }));

import { historyService } from "../services/historyService";
import History from "./History";

const item = (over) => ({
  id: 1, state: "Maharashtra", market: "APMC Mumbai", commodity: "Onion", variety: "Other", input_date: "2026-10-23", forecast_origin_date: "2026-10-23",
  arrivals: 5, horizon_days: 14, current_price: 2000, predicted_price: 2600, predicted_low: 2000, predicted_high: 3000, predicted_direction: "Increasing",
  future_trend: [], sell_hold_suggestion: "Wait", created_at: "2026-10-23T10:00:00", policy: { mode: "model", band: "8-14", reasons: [] },
  latest_recorded: { price: 1800, date: "2025-12-31", age_days: 296, stale: true, age_n: 10, age_unit: "months" }, ...over,
});

beforeEach(() => {
  historyService.summary.mockResolvedValue({ total_price_predictions: 2, total_crop_recommendations: 0, recent_predictions: [], recent_recommendations: [] });
  historyService.price.mockResolvedValue({ total: 2, limit: 10, offset: 0, items: [
    item({ id: 1, commodity: "Onion", policy: { mode: "context_only", band: "8-14", reasons: ["no"] } }),
    item({ id: 2, commodity: "Cauliflower", predicted_price: 3100 }) ] });
});
afterEach(cleanup);

describe("history table", () => {
  it("shows 'No clear direction' with the latest recorded price instead of the model's price for context-only rows", async () => {
    render(<MemoryRouter><History /></MemoryRouter>);
    const cell = await waitFor(() => screen.getByTestId("hist-nodir-1"));
    expect(cell.textContent).toContain("No clear direction");
    expect(cell.textContent).toContain("Latest recorded price: ₹1,800 (31 Dec 2025, 10 months ago). No forecast for this crop.");
    expect(cell.textContent).not.toContain("₹2,600");
    const row = cell.closest("tr");
    expect(row.textContent).not.toMatch(/Increasing|Rising/);          // no direction badge
  });

  it("says 'about the same' with the model estimate as secondary when the change is below the typical miss", async () => {
    historyService.price.mockResolvedValue({ total: 1, limit: 10, offset: 0, items: [
      item({ id: 3, commodity: "Cabbage", current_price: 2000, predicted_price: 2050, verdict: { code: "about_the_same", start_price: 2000, model_estimate: 2050, typical_miss_inr: 300 } }) ] });
    render(<MemoryRouter><History /></MemoryRouter>);
    const cell = await waitFor(() => screen.getByTestId("hist-same-3"));
    expect(cell.textContent).toContain("About the same as the starting price (₹2,000)");
    expect(cell.textContent).toContain("model estimate ₹2,050");
    expect(cell.closest("tr").textContent).not.toMatch(/Increasing|Rising/);
  });

  it("keeps the model's price and direction for rows where the model is used", async () => {
    render(<MemoryRouter><History /></MemoryRouter>);
    await waitFor(() => screen.getByTestId("hist-nodir-1"));
    const row = screen.getByText("Cauliflower").closest("tr");
    expect(row.textContent).toContain("₹3,100");
  });
});

describe("history of crop recommendations: the personalised pick", () => {
  const rec = (id, over = {}) => ({ id, nitrogen: 80, phosphorus: 45, potassium: 85, temperature: 23, humidity: 58, ph: 6.8, rainfall: 70, soil_type: "loam", month: 10, season: "Rabi", state: "Maharashtra",
    city: "Pune", selling_month: 2, planting_date: "2026-10", selling_date: "2027-02", area_acres: 1, created_at: "2026-10-23T10:00:00", results: [], budget_inr: null, priority: null, risk_level: null, personal_pick: null, ...over });

  it("shows one small extra line only on records that have a budget plan", async () => {
    historyService.recommendations.mockResolvedValue({ total: 3, limit: 10, offset: 0, items: [
      rec(1), rec(2, { budget_inr: 60000, priority: "balanced", risk_level: "medium", personal_pick: "Cabbage" }), rec(3, { budget_inr: 10000, priority: "spend_less", risk_level: "low" })] });
    render(<MemoryRouter initialEntries={["/history?tab=recommendations"]}><History /></MemoryRouter>);
    await waitFor(() => screen.getByTestId("hist-plan-2"));
    expect(screen.getByTestId("hist-plan-2").textContent).toBe("Your plan: Cabbage");
    expect(screen.getByTestId("hist-plan-3").textContent).toBe("Your plan: no crop fits");
    expect(screen.queryByTestId("hist-plan-1")).toBeNull();
  });
});
