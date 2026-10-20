// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../components/CropArt", () => ({ default: () => null, PHOTOS: {} }));
vi.mock("../services/api", () => ({ errorMessage: (e) => e.message }));
vi.mock("../services/cropService", () => ({ cropService: { analyze: vi.fn() } }));
vi.mock("../services/historyService", () => ({ historyService: { recommendationItem: vi.fn() } }));
vi.mock("./CropRecommendation", () => ({ LAST_CROP_RESULT_KEY: "k", SOILS: ["loam"] }));

import { cropService } from "../services/cropService";
import { historyService } from "../services/historyService";
import CropExplanation from "./CropExplanation";
import { compareToBest } from "../utils/cropExplanation";

const factor = (feature, value, low, high, unit = "") => ({ feature, value: `${value}${unit}`, typical_low: low, typical_high: high, unit });
const crop = (name, rank, score, pts, extra = {}) => ({
  crop_name: name, rank, recommended: rank === 1, feasible: true, eligible: true, profit_rank: rank, forecast_reliability: "tested",
  recommendation_score: score, agronomic_score: 80, timing_score: 90, profit_score: 70, score_points: pts,
  range_fit: { soil: { within: 3, total: 4 }, weather: { within: 3, total: 3 } },
  economics: { selling_price: 2000, gross_revenue: 90000, cultivation_cost: 30000, marketing_cost: 5000, storage_cost: 0, total_cost: 35000,
    net_profit: 55000, net_profit_low: 40000, net_profit_high: 70000, roi_pct: 157, effective_yield_q: 45 },
  timeline: { status: "fresh", planting: "2026-10", harvest_start: "2027-01", harvest_end: "2027-02", selling: "2027-02", planting_in_window: true },
  important_factors: [factor("N", 90, 60, 120), factor("P", 40, 30, 60), factor("K", 250, 100, 200), factor("ph", 6.5, 6, 7),
    factor("temperature", 24, 18, 30, " °C"), factor("humidity", 70, 50, 90, " %"), factor("rainfall", 90, 50, 150, " mm")],
  limitations: [], status: { key: "best", tone: "good" }, ...extra,
});
const response = () => ({
  selling_date: "2027-02", area_acres: 1, best_overall: "Wheat", highest_profit: "Wheat",
  weights: { agronomic: 0.4, timing: 0.2, profit: 0.4 },
  ranking_explanation: { best_overall: "Wheat", highest_profit: "Wheat", same_crop: true, profit_gap: null, reasons: [] },
  results: [crop("Wheat", 1, 82, { agronomic: 32, timing: 18, profit: 28 }), crop("Onion", 2, 70, { agronomic: 30, timing: 18, profit: 22 }, { profit_rank: 2 })],
});
const req = { nitrogen: 90, phosphorus: 40, potassium: 250, ph: 6.5, temperature: 24, humidity: 70, rainfall: 90, soil_type: "loam", city: "Pune" };

const renderAt = (entry) => render(
  <MemoryRouter initialEntries={[entry]}>
    <Routes>
      <Route path="/crop-recommendation/explanation" element={<CropExplanation />} />
      <Route path="/crop-recommendation/result" element={<span>result page</span>} />
    </Routes>
  </MemoryRouter>);
const withState = () => ({ pathname: "/crop-recommendation/explanation", state: { req, response: response() } });

beforeEach(() => { cropService.analyze.mockReset(); historyService.recommendationItem.mockReset(); });
afterEach(cleanup);

describe("CropExplanation page", () => {
  it("is a short page: summary and score breakdown, without the long field, timing, profit, comparison and limits sections", () => {
    renderAt(withState());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Why is this crop recommended?");
    for (const h of ["Recommendation summary", "Why this crop is recommended", "How the suitability score is built"]) {
      expect(screen.getAllByRole("heading", { name: h }).length, h).toBeGreaterThan(0);
    }
    for (const h of ["Your field conditions", "Planting and harvest timing", "Expected profit", "How this crop compares with the others", "Limits of this recommendation"]) {
      expect(screen.queryByRole("heading", { name: h }), h).toBeNull();
    }
    expect(screen.getByText("82/100")).toBeTruthy();
  });

  it("explains the crop chosen by ?crop=, not always the best one", () => {
    const st = withState();
    st.state.response.results[1].important_factors[3] = { ...st.state.response.results[1].important_factors[3], shap_value: 0.9, share_pct: 40 };
    renderAt({ pathname: "/crop-recommendation/explanation", search: "?crop=Onion", state: st.state });
    expect(screen.getByRole("heading", { name: "How Onion fits your field" })).toBeTruthy();
    expect(screen.getByText("70/100")).toBeTruthy();
  });

  it("uses the API's score points and weights", () => {
    renderAt(withState());
    const score = screen.getAllByRole("heading", { name: "How the suitability score is built" }).map((h) => h.closest("section")).find(Boolean);
    expect(score.textContent).toContain("32.0");
    expect(score.textContent).toContain("40%");
  });

  it("with no state and no id shows a fallback and does not crash", () => {
    renderAt("/crop-recommendation/explanation");
    expect(screen.getByText("No recommendation to explain")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Get a recommendation" }).getAttribute("href")).toBe("/crop-recommendation");
  });

  it("rejects an old session result that lacks the score fields", () => {
    const r = withState();
    delete r.state.response.results[0].score_points;
    renderAt(r);
    expect(screen.getByText("No recommendation to explain")).toBeTruthy();
  });

  it("re-opens a saved analysis by id", async () => {
    historyService.recommendationItem.mockResolvedValue({ id: 3, city: "Pune", selling_month: 2, month: 10, area_acres: 1, soil_type: "loam",
      nitrogen: 90, phosphorus: 40, potassium: 250, ph: 6.5, temperature: 24, humidity: 70, rainfall: 90, planting_date: "2026-10-01" });
    cropService.analyze.mockResolvedValue(response());
    renderAt("/crop-recommendation/explanation?id=3");
    await waitFor(() => expect(screen.getByText("82/100")).toBeTruthy());
  });

  it("back button returns to the result page", () => {
    renderAt(withState());
    fireEvent.click(screen.getByRole("button", { name: /Back to recommendation results/ }));
    expect(screen.getByText("result page")).toBeTruthy();
  });
});

describe("compareToBest", () => {
  it("lists where the alternative is behind or ahead, from score points", () => {
    const c = compareToBest({ recommendation_score: 82, score_points: { agronomic: 32, timing: 18, profit: 28 } },
      { recommendation_score: 70, score_points: { agronomic: 30, timing: 20, profit: 20 } });
    expect(c.gap).toBe(12);
    expect(c.behind).toEqual(["profit", "agronomic"]);
    expect(c.ahead).toEqual(["timing"]);
  });
});
