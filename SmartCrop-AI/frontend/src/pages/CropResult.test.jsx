// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

for (const c of ["BestCropCard", "CropCompare", "Financials", "PlanSummary"]) {
  vi.doMock(`../components/crop/${c}`, () => ({ default: () => null }));
}
vi.mock("../services/api", () => ({ errorMessage: (e) => e.message }));
vi.mock("../services/cropService", () => ({ cropService: {} }));
vi.mock("../services/historyService", () => ({ historyService: {} }));
vi.mock("./CropRecommendation", () => ({ LAST_CROP_RESULT_KEY: "k", SOILS: ["loam"] }));

const { default: CropResult } = await import("./CropResult");

const crop = (name, rank) => ({ crop_name: name, rank, timeline: {}, range_fit: {}, important_factors: [] });
const state = { req: { nitrogen: 1 }, response: { best_overall: "Wheat", highest_profit: "Wheat", warnings: [], results: [crop("Wheat", 1), crop("Onion", 2)] } };
function Where() { const l = useLocation(); return <span data-testid="where">{l.pathname + l.search}</span>; }
const renderAt = (entry) => render(
  <MemoryRouter initialEntries={[entry]}>
    <Routes><Route path="/crop-recommendation/result" element={<CropResult />} /><Route path="/crop-recommendation/explanation" element={<span>explanation page</span>} /></Routes>
    <Where />
  </MemoryRouter>);
afterEach(cleanup);

describe("CropResult page", () => {
  it("shows no recommendation explanation, reasons or SHAP notes", () => {
    renderAt({ pathname: "/crop-recommendation/result", state });
    for (const x of ["Why this crop is recommended", "What the crop-matching model noticed", "Soil", "Weather"]) {
      expect(screen.queryByText(x)).toBeNull();
    }
    expect(document.querySelector(".why-crop, .why-item, .why-model")).toBeNull();
  });

  it("has one explanation button, linking to the record being viewed", () => {
    renderAt({ pathname: "/crop-recommendation/result", search: "?id=27", state });
    expect(screen.getAllByRole("button", { name: /View/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "View Recommendation Explanation" }));
    expect(screen.getByTestId("where").textContent).toBe("/crop-recommendation/explanation?id=27");
  });

  it("uses the response id, or no id at all (state is handed over) rather than an invalid URL", () => {
    const withId = { ...state, response: { ...state.response, id: 31 } };
    renderAt({ pathname: "/crop-recommendation/result", state: withId });
    fireEvent.click(screen.getByRole("button", { name: "View Recommendation Explanation" }));
    expect(screen.getByTestId("where").textContent).toBe("/crop-recommendation/explanation?id=31");
    cleanup();
    renderAt({ pathname: "/crop-recommendation/result", state });
    fireEvent.click(screen.getByRole("button", { name: "View Recommendation Explanation" }));
    expect(screen.getByTestId("where").textContent).toBe("/crop-recommendation/explanation");
    expect(screen.getByText("explanation page")).toBeTruthy();
  });
});
