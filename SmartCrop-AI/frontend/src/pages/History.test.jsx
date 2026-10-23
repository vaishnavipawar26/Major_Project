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
