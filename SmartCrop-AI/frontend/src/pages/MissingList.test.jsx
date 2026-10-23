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
  state: "Maharashtra", crops: ["Wheat"], cities: ["Pune", "Nashik", "Nagpur", "Ahilyanagar"], soil_types: ["loam"], price_data_end: "2025-12", inflation_annual_pct: 5,
  calendar: { Wheat: { planting_months: [11], growth_months_min: 3, growth_months_max: 5, max_storage_months: 0 } }, economics: { Wheat: econ(28000) }, input_ranges: {},
};
const range = { min: 0, max: 300, hardMin: 0, hardMax: 300, perCrop: {} };
const ranges = Object.fromEntries(["N", "P", "K", "ph", "temperature", "humidity", "rainfall"].map((k) => [k, range]));

beforeEach(() => {
  cropService.options.mockReset().mockResolvedValue(options);
  cropService.featureRanges.mockReset().mockResolvedValue(ranges);
});
afterEach(cleanup);

const renderForm = async () => {
  render(<MemoryRouter><CropRecommendation /></MemoryRouter>);
  await waitFor(() => expect(document.getElementById("nitrogen")).toBeTruthy());
};
const note = () => document.querySelector(".cf-submit-note").textContent;
const type = (id, v) => fireEvent.change(document.getElementById(id), { target: { value: v } });
const WEATHER = " The weather is still loading; wait for it, or type it yourself, to continue.";

describe("the live 'what is missing' line under the button", () => {
  it("lists the empty soil fields, and the weather that is still loading, instead of 'complete all three steps'", async () => {
    await renderForm();
    expect(note()).toBe(`Fill Nitrogen, Phosphorus, Potassium and Soil pH to continue.${WEATHER}`);
    expect(document.body.textContent).not.toContain("Complete all three steps");
  });

  it("shrinks as the fields are filled in", async () => {
    await renderForm();
    type("nitrogen", "80");
    expect(note()).toBe(`Fill Phosphorus, Potassium and Soil pH to continue.${WEATHER}`);
    type("phosphorus", "45");
    expect(note()).toBe(`Fill Potassium and Soil pH to continue.${WEATHER}`);
    type("potassium", "85");
    expect(note()).toBe(`Fill Soil pH to continue.${WEATHER}`);
    type("ph", "6.8");
    expect(note()).toBe(WEATHER.trim());
  });

  it("names a value the form will not accept, separately from the empty ones", async () => {
    await renderForm();
    type("nitrogen", "500");
    type("phosphorus", "45");
    expect(note()).toContain("Fill Potassium and Soil pH to continue.");
    expect(note()).toContain("Fix Nitrogen to continue.");
  });

  it("when the weather is typed by hand, the empty weather fields are named too", async () => {
    await renderForm();
    fireEvent.click(screen.getByText("Nashik · Nov → Mar"));                       // an example fills everything and switches to typed weather
    expect(note()).toBe("Takes about 5 seconds. Results are estimates.");
    type("potassium", ""); type("temperature", ""); type("rainfall", "");
    expect(note()).toBe("Fill Potassium, Average temperature and Average rainfall to continue.");
  });

  it("asks for a different selling month when it equals the planting month, and goes back to the normal note when everything is right", async () => {
    await renderForm();
    fireEvent.click(screen.getByText("Nashik · Nov → Mar"));
    fireEvent.change(document.getElementById("selling_month"), { target: { value: "11" } });
    expect(note()).toBe("Selling month must be different from the planting month.");
    fireEvent.change(document.getElementById("selling_month"), { target: { value: "3" } });
    expect(note()).toBe("Takes about 5 seconds. Results are estimates.");
  });
});
