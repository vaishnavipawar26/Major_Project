// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/historyService", () => ({ historyService: { summary: vi.fn() } }));
vi.mock("../services/cropService", () => ({ cropService: { options: vi.fn() } }));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ user: { name: "Asha Patil" } }) }));
vi.mock("../components/GuidedTour", () => ({ startTour: vi.fn() }));

import { cropService } from "../services/cropService";
import { historyService } from "../services/historyService";
import Dashboard from "./Dashboard";

const item = (over) => ({
  id: 1, state: "Maharashtra", market: "APMC Mumbai", commodity: "Onion", variety: "Other", input_date: "2026-10-23", forecast_origin_date: "2026-10-23",
  arrivals: 5, horizon_days: 14, current_price: 2000, predicted_price: 2600, predicted_low: 2000, predicted_high: 3000, predicted_direction: "Increasing",
  future_trend: [], sell_hold_suggestion: "Wait", created_at: "2026-10-23T10:00:00", policy: { mode: "model", band: "8-14", reasons: [] },
  latest_recorded: { price: 1800, date: "2025-12-31" }, ...over,
});

beforeEach(() => {
  cropService.options.mockResolvedValue({ crops: [] });
  historyService.summary.mockResolvedValue({ total_price_predictions: 2, total_crop_recommendations: 0, recent_recommendations: [], recent_predictions: [
    item({ id: 1, commodity: "Onion", policy: { mode: "context_only", band: "8-14", reasons: ["no"] } }),
    item({ id: 2, commodity: "Cauliflower", predicted_price: 3100 }) ] });
});
afterEach(cleanup);

describe("dashboard recent predictions", () => {
  it("does not show the model's price or direction for context-only predictions", async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const onion = (await waitFor(() => screen.getByText("Onion"))).closest("a");
    expect(onion.textContent).toContain("No clear direction · near ₹1,800 (latest recorded, 31 Dec 2025)");
    expect(onion.textContent).not.toContain("₹2,600");
    expect(onion.textContent).not.toMatch(/Increasing|Rising/);
  });

  it("keeps the expected price for predictions where the model is used", async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const cf = (await waitFor(() => screen.getByText("Cauliflower"))).closest("a");
    expect(cf.textContent).toContain("Expected ₹3,100");
  });
});
