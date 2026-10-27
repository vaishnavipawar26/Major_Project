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
  location: { score: 80, growing_area_share_pct: 12, growing_area_score: 100, climate_score: 100, climate: { months: [1], values: { temperature: 24, humidity: 60, rainfall: 80 }, items: { temperature: true, humidity: true, rainfall: true } } },
  planting_fit_score: 100, selling_fit_score: 100, profit_score_used: pts.profit * 5,
  range_fit: { soil: { within: 3, total: 4, items: { N: true, P: true, K: false, ph: true } }, weather: { within: 3, total: 3, items: { temperature: true, humidity: true, rainfall: true } } },
  economics: { selling_price: 2000, gross_revenue: 90000, cultivation_cost: 30000, marketing_cost: 5000, storage_cost: 0, total_cost: 35000,
    net_profit: 55000, net_profit_low: 40000, net_profit_high: 70000, roi_pct: 157, effective_yield_q: 45 },
  timeline: { status: "fresh", planting: "2026-10", harvest_start: "2027-01", harvest_end: "2027-02", selling: "2027-02", planting_in_window: true },
  important_factors: [factor("N", 90, 60, 120), factor("P", 40, 30, 60), factor("K", 250, 100, 200), factor("ph", 6.5, 6, 7),
    factor("temperature", 24, 18, 30, " °C"), factor("humidity", 70, 50, 90, " %"), factor("rainfall", 90, 50, 150, " mm")],
  limitations: [], status: { key: "best", tone: "good" }, ...extra,
});
const response = () => ({
  selling_date: "2027-02", city: "Pune", state: "Maharashtra", area_acres: 1, best_overall: "Wheat", highest_profit: "Wheat",
  weights: { location: 0.2, planting: 0.2, selling: 0.1, soil: 0.15, weather: 0.15, profit: 0.2 },
  ranking_explanation: { best_overall: "Wheat", highest_profit: "Wheat", same_crop: true, profit_gap: null, reasons: [] },
  results: [crop("Wheat", 1, 82, { location: 16, planting: 20, selling: 10, soil: 11.25, weather: 15, profit: 20, agronomic: 26.25, timing: 30 }), crop("Onion", 2, 70, { location: 12, planting: 20, selling: 10, soil: 11.25, weather: 15, profit: 14, agronomic: 26.25, timing: 30 }, { profit_rank: 2 })],
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

globalThis.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
beforeEach(() => { cropService.analyze.mockReset(); historyService.recommendationItem.mockReset(); });
afterEach(cleanup);

describe("CropExplanation page", () => {
  it("shows the summary, ONE factor chart, and the main-factor card", () => {
    renderAt(withState());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Recommendation explanation");
    expect(screen.getByRole("heading", { name: "What influences your crop recommendation?" })).toBeTruthy();
    expect(screen.queryByText("Why this crop?")).toBeNull();
    const card = screen.getByRole("group", { name: "Strongest influence on this recommendation" });
    expect(card.textContent).not.toMatch(/Onion|points over/);                       // explains this crop only, no comparison
    expect(screen.getAllByRole("img").length).toBe(1);                                  // one chart
    const tl = screen.getByRole("heading", { name: "Crop growing and selling timeline" });      // the timeline lives here, last on the page
    expect(tl).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).compareDocumentPosition(tl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tl.closest("section").nextElementSibling).toBeNull();
    for (const h of ["Why is Wheat recommended for your farm?", "AI's final explanation", "What influenced this recommendation?"]) {
      expect(screen.queryByRole("heading", { name: h }), h).toBeNull();
    }
    expect(screen.getByRole("group", { name: "Suitability score" }).textContent).toContain("82/100");
  });

  it("keeps the detailed explanation collapsed until asked, then shows it and can hide it again", () => {
    renderAt(withState());
    const btn = screen.getByRole("button", { name: /Show detailed explanation/ });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("View detailed crop suitability analysis")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Why is Wheat recommended for your farm?" })).toBeNull();
    expect(document.getElementById("xp-soil")).toBeNull();
    expect(screen.getByRole("heading", { name: "What influences your crop recommendation?" })).toBeTruthy();   // main section stays
    // order on the page: chart card, then the collapsible
    const pos = (el) => el.compareDocumentPosition.bind(el);
    expect(pos(screen.getByRole("heading", { name: "What influences your crop recommendation?" }))(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("What supports it?")).toBeNull();                     // the short-reasons card is gone
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(btn.textContent).toContain("Hide detailed explanation");
    expect(screen.getByRole("region", { name: "View detailed crop suitability analysis" })).toBeTruthy();
    expect(screen.queryByText(/SmartCrop AI checked your location/)).toBeNull();      // the old heading and intro are gone
    for (const k of ["location", "planting", "soil", "temperature", "rainfall", "profit"]) expect(document.getElementById(`xp-${k}`), k).toBeTruthy();
    expect(screen.getByRole("heading", { name: "AI's final explanation" })).toBeTruthy();
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("xp-soil")).toBeNull();
  });

  it("explains the crop chosen by ?crop=, not always the best one", () => {
    const st = withState();
    renderAt({ pathname: "/crop-recommendation/explanation", search: "?crop=Onion", state: st.state });
    expect(screen.getByText(/Onion ranks #2/)).toBeTruthy();
    expect(screen.getByRole("group", { name: "Suitability score" }).textContent).toContain("70/100");
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
    await waitFor(() => expect(screen.getByRole("group", { name: "Suitability score" }).textContent).toContain("82/100"));
    expect(screen.getByRole("link", { name: "Back to History" }).getAttribute("href")).toBe("/history");
  });

  it("back button returns to the result page", () => {
    renderAt(withState());
    fireEvent.click(screen.getByRole("button", { name: /Back to Results/ }));
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
