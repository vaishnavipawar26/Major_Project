// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/cropService", () => ({ cropService: { options: vi.fn(), featureRanges: vi.fn(), recommend: vi.fn() } }));
vi.mock("../services/api", () => ({ errorMessage: (e) => e.message }));
vi.mock("../hooks/useWeather", () => ({ useWeather: () => ({ state: "idle", data: null, error: null, retry: () => {}, ready: false }) }));
vi.mock("../components/PageHero", () => ({ default: ({ title }) => <h1>{title}</h1> }));

import { cropService } from "../services/cropService";
import CropRecommendation from "./CropRecommendation";

const econ = (cost) => ({ yield_q_per_acre: 80, cost_per_acre_inr: cost, cost_reference_year: 2024 });
const options = {
  state: "Maharashtra", crops: ["Wheat", "Tomato"], cities: ["Pune", "Nashik", "Nagpur", "Ahilyanagar"], soil_types: ["loam"], price_data_end: "2025-12", inflation_annual_pct: 5,
  calendar: { Wheat: { planting_months: [11], growth_months_min: 3, growth_months_max: 5, max_storage_months: 0 }, Tomato: { planting_months: [10], growth_months_min: 3, growth_months_max: 5, max_storage_months: 0 } },
  economics: { Wheat: econ(28000), Tomato: econ(110000) }, input_ranges: {},
};
// the real shape of GET /api/crop-recommendation/feature-ranges (dataset min/max, the API's own limits, each crop's usual range)
const r = (min, max, hardMin, hardMax) => ({ min, max, hardMin, hardMax, perCrop: { Wheat: [min + 1, max - 1], Tomato: [min + 2, max - 2] } });
const RANGES = { N: r(1, 140, 0, 300), P: r(5, 145, 0, 300), K: r(5, 205, 0, 400), ph: r(4.5, 9, 0, 14), temperature: r(8, 45, -10, 55), humidity: r(14, 100, 0, 100), rainfall: r(0, 300, 0, 3000) };

beforeEach(() => {
  cropService.options.mockReset().mockResolvedValue(options);
  cropService.featureRanges.mockReset().mockResolvedValue(RANGES);
  cropService.recommend.mockReset().mockResolvedValue({ results: [], warnings: [] });
});
afterEach(cleanup);

const renderForm = async () => {
  render(<MemoryRouter><CropRecommendation /></MemoryRouter>);
  await waitFor(() => expect(document.getElementById("nitrogen").placeholder).toMatch(/^Typical/));
};
const soilCard = () => screen.getByRole("heading", { name: "1. Soil test results" }).closest("section");
const field = (id) => document.getElementById(id);
const type = (id, v) => fireEvent.change(field(id), { target: { value: v } });

describe("soil card: the range is the placeholder", () => {
  it("shows the typical range as each input's placeholder", async () => {
    await renderForm();
    expect(field("nitrogen").placeholder).toBe("Typical 1–140");
    expect(field("phosphorus").placeholder).toBe("Typical 5–145");
    expect(field("potassium").placeholder).toBe("Typical 5–205");
    expect(field("ph").placeholder).toBe("Typical 4.5–9");
  });

  it("takes the numbers from the API, not from the page", async () => {
    cropService.featureRanges.mockResolvedValue({ ...RANGES, N: r(2, 150, 0, 300), ph: r(4, 9.5, 0, 14) });
    await renderForm();
    expect(field("nitrogen").placeholder).toBe("Typical 2–150");
    expect(field("ph").placeholder).toBe("Typical 4–9.5");
  });

  it("no longer prints 'Typical range' lines or draws the green range bars under the soil inputs", async () => {
    await renderForm();
    expect(soilCard().querySelectorAll(".range-bar")).toHaveLength(0);
    expect(soilCard().querySelectorAll(".hint")).toHaveLength(0);
    // the only visible text with that wording is the visually hidden one, which is for screen readers
    const visible = Array.from(soilCard().querySelectorAll("*")).filter((el) => el.children.length === 0 && /Typical range/.test(el.textContent) && !el.classList.contains("sr-only"));
    expect(visible).toHaveLength(0);
  });

  it("keeps the kg/ha unit inside N, P and K, and the pH hint text", async () => {
    await renderForm();
    for (const id of ["nitrogen", "phosphorus", "potassium"]) expect(field(id).closest(".input-unit").querySelector(".input-unit-text").textContent).toBe("kg/ha");
    expect(field("ph").closest(".field").textContent).toContain("7 is neutral; below 7 is acidic, above 7 is alkaline.");
  });

  it("keeps the range for screen readers: visually hidden text linked by aria-describedby", async () => {
    await renderForm();
    for (const [id, range] of [["nitrogen", "1–140"], ["phosphorus", "5–145"], ["potassium", "5–205"], ["ph", "4.5–9"]]) {
      const ref = `${id}-range`;
      expect(field(id).getAttribute("aria-describedby").split(" ")).toContain(ref);
      const hidden = document.getElementById(ref);
      expect(hidden.classList.contains("sr-only")).toBe(true);
      expect(hidden.textContent).toBe(`Typical range: ${range}`);
    }
  });

  it("leaves the weather fields as they were, with their own range lines", async () => {
    await renderForm();
    fireEvent.click(screen.getByText("Nashik · Nov → Mar"));                      // an example switches the weather to typed values
    await waitFor(() => expect(field("temperature")).toBeTruthy());
    expect(document.getElementById("temperature-hint").textContent).toBe("Typical range: 8–45");
    expect(field("temperature").closest(".field").querySelectorAll(".range-bar")).toHaveLength(1);
    expect(field("temperature").placeholder).not.toMatch(/^Typical/);
  });
});

describe("out-of-range soil values say what the range is", () => {
  it("shows 'should be between' with the unit when a value is outside the typical range", async () => {
    await renderForm();
    type("nitrogen", "150"); fireEvent.blur(field("nitrogen"));
    expect(document.getElementById("nitrogen-warn").textContent).toBe("Nitrogen (N) should be between 1 and 140 kg/ha");
    type("phosphorus", "2"); fireEvent.blur(field("phosphorus"));
    expect(document.getElementById("phosphorus-warn").textContent).toBe("Phosphorus (P) should be between 5 and 145 kg/ha");
    type("potassium", "300"); fireEvent.blur(field("potassium"));
    expect(document.getElementById("potassium-warn").textContent).toBe("Potassium (K) should be between 5 and 205 kg/ha");
    type("ph", "10"); fireEvent.blur(field("ph"));
    expect(document.getElementById("ph-warn").textContent).toBe("Soil pH should be between 4.5 and 9");
  });

  it("shows no message for a value inside the range, and the soft note never blocks the request", async () => {
    await renderForm();
    type("nitrogen", "80"); fireEvent.blur(field("nitrogen"));
    expect(document.getElementById("nitrogen-warn")).toBeNull();
    fireEvent.click(screen.getByText("Nashik · Nov → Mar"));
    type("nitrogen", "150");                                                      // outside the typical range, inside what the API accepts
    fireEvent.click(screen.getByRole("button", { name: /Compare crops for my field/ }));
    await waitFor(() => expect(cropService.recommend).toHaveBeenCalled());
    expect(cropService.recommend.mock.calls[0][0].nitrogen).toBe(150);
  });

  it("still blocks a value the API would reject, with the same wording and the API's limits", async () => {
    await renderForm();
    fireEvent.click(screen.getByText("Nashik · Nov → Mar"));
    type("nitrogen", "400"); fireEvent.blur(field("nitrogen"));
    expect(document.getElementById("nitrogen-error").textContent).toBe("Nitrogen (N) should be between 0 and 300 kg/ha");
    fireEvent.click(screen.getByRole("button", { name: /Compare crops for my field/ }));
    expect(cropService.recommend).not.toHaveBeenCalled();
  });

  it("the examples still fill the soil values and send them unchanged", async () => {
    await renderForm();
    fireEvent.click(screen.getByText("Nashik · Nov → Mar"));
    expect(field("nitrogen").value).toBe("80");
    expect(field("ph").value).toBe("6.8");
    fireEvent.click(screen.getByRole("button", { name: /Compare crops for my field/ }));
    await waitFor(() => expect(cropService.recommend).toHaveBeenCalled());
    expect(cropService.recommend.mock.calls[0][0]).toMatchObject({ nitrogen: 80, phosphorus: 45, potassium: 85, ph: 6.8 });
  });
});
