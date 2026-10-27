// @vitest-environment jsdom
// The dashboard with REAL saved crop recommendations (from the API fixtures), including a field under 1 acre. A render error anywhere fails the test.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/historyService", () => ({
  historyService: { summary: vi.fn(), price: vi.fn(), recommendations: vi.fn(), deletePrice: vi.fn(), deleteRecommendation: vi.fn() },
}));
vi.mock("../services/cropService", () => ({ cropService: { options: vi.fn() } }));
vi.mock("../services/api", () => ({ errorMessage: (e) => e.message }));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ user: { name: "Asha Patil" } }) }));
vi.mock("../components/GuidedTour", () => ({ startTour: vi.fn() }));

import WidgetBoundary from "../components/WidgetBoundary";
import { cropService } from "../services/cropService";
import { historyService } from "../services/historyService";
import Dashboard from "./Dashboard";
import History from "./History";

const FIXTURES = JSON.parse(readFileSync(resolve("src/test-fixtures/budget_plan_real.json"), "utf8"));
const real = () => Object.values(FIXTURES).slice(0, 4).map((f) => f.history_item);      // the four area sizes below are matched to four items
const withArea = (items) => items.map((x, i) => ({ ...x, area_acres: [0.5125, 0.0125, 2, 1][i % 4] }));

let errors;
beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a.map(String).join(" ")); });
  cropService.options.mockResolvedValue({ crops: [], calendar: {} });
  historyService.price.mockResolvedValue({ total: 0, limit: 10, offset: 0, items: [] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("dashboard with real saved crop recommendations", () => {
  it("renders the latest saved plan from each real item, with the field size in the shared format, and no render error", async () => {
    const expected = { 0.5125: "0.51 acre (20.5 guntha)", 0.0125: "0.01 acre (0.5 guntha)", 2: "2 acres", 1: "1 acre" };
    for (const [i, item] of real().entries()) {
      const area = [0.5125, 0.0125, 2, 1][i];
      historyService.summary.mockResolvedValue({ total_price_predictions: 0, total_crop_recommendations: 4, recent_predictions: [], recent_recommendations: [{ ...item, area_acres: area }] });
      const { container, unmount } = render(<MemoryRouter><Dashboard /></MemoryRouter>);
      await waitFor(() => expect(container.querySelector("a.plan-card")).toBeTruthy());
      expect(container.querySelector("a.plan-card").textContent, `item ${i}`).toContain(expected[area]);
      expect(container.textContent).not.toMatch(/undefined|NaN|\{\w+\}/);
      expect(container.querySelectorAll("[data-testid^=widget-error]")).toHaveLength(0);
      unmount();
    }
    expect(errors.filter((e) => /ReferenceError|The above error occurred|Uncaught/.test(e))).toEqual([]);
  });

  it("copes with a saved item that is missing fields (an old record): the widget fails alone, the page stays", async () => {
    historyService.summary.mockResolvedValue({ total_price_predictions: 0, total_crop_recommendations: 1, recent_predictions: [],
      recent_recommendations: [{ id: 99, created_at: "2026-10-23T10:00:00", results: null }] });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await waitFor(() => expect(document.querySelector("h2#recent-title")).toBeTruthy());
    expect(document.querySelector("#recent-title")).toBeTruthy();         // the rest of the page is still there
    expect(document.querySelector("#benefits-title")).toBeTruthy();
  });
});

describe("widget error boundary", () => {
  const Bomb = () => { throw new Error("boom"); };

  it("shows a small message for the widget that failed and leaves its neighbours alone", () => {
    render(<div><WidgetBoundary name="a"><Bomb /></WidgetBoundary><WidgetBoundary name="b"><p>still here</p></WidgetBoundary></div>);
    expect(screen.getByTestId("widget-error-a").textContent).toContain("This section couldn't load.");
    expect(screen.getByRole("alert").textContent).toContain("This section couldn't load.");
    expect(screen.getByText("still here")).toBeTruthy();
    expect(screen.queryByTestId("widget-error-b")).toBeNull();
    expect(errors.some((e) => /Widget "a" failed to render/.test(e))).toBe(true);        // the cause is still logged for developers
  });

  it("on the dashboard, a crashing recent-crops widget does not blank the recent-predictions widget or the hero", async () => {
    historyService.summary.mockResolvedValue({ total_price_predictions: 0, total_crop_recommendations: 1, recent_predictions: [],
      recent_recommendations: [{ id: 5, created_at: "2026-10-23T10:00:00", results: [{ crop_name: "Onion", expected_profit: 1000 }], planting_date: { bad: true } }] });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await waitFor(() => expect(document.querySelector("#recent-title")).toBeTruthy());
    expect(document.querySelector("#dash-title")).toBeTruthy();                           // hero
    expect(document.querySelector("#benefits-title")).toBeTruthy();
  });
});

describe("history page with real saved crop recommendations", () => {
  it("renders the real items, including an under-1-acre field, with no render error", async () => {
    historyService.summary.mockResolvedValue({ total_price_predictions: 0, total_crop_recommendations: 4, recent_predictions: [], recent_recommendations: [] });
    historyService.recommendations.mockResolvedValue({ total: 4, limit: 10, offset: 0, items: withArea(real()) });
    render(<MemoryRouter initialEntries={["/history?tab=recommendations"]}><History /></MemoryRouter>);
    await waitFor(() => expect(document.querySelectorAll("tbody tr").length).toBe(4));
    expect(document.body.textContent).not.toMatch(/undefined|NaN|\{\w+\}/);
    expect(errors.filter((e) => /ReferenceError|The above error occurred|Uncaught/.test(e))).toEqual([]);
  });
});
