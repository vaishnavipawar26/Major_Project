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

const econ = (cost, year = 2024) => ({ yield_q_per_acre: 80, cost_per_acre_inr: cost, cost_reference_year: year });
const options = {
  state: "Maharashtra", crops: ["Wheat", "Tomato"], cities: ["Pune", "Nashik", "Nagpur", "Ahilyanagar"], soil_types: ["loam"], price_data_end: "2025-12", inflation_annual_pct: 5,
  calendar: { Wheat: { planting_months: [11], growth_months_min: 3, growth_months_max: 5, max_storage_months: 0 }, Tomato: { planting_months: [10], growth_months_min: 3, growth_months_max: 5, max_storage_months: 0 } },
  economics: { Wheat: econ(28000), Tomato: econ(110000) }, input_ranges: {},
};
const range = { min: 0, max: 300, hardMin: 0, hardMax: 400, perCrop: {} };
const ranges = Object.fromEntries(["N", "P", "K", "ph", "temperature", "humidity", "rainfall"].map((k) => [k, range]));

beforeEach(() => {
  cropService.options.mockReset().mockResolvedValue(options);
  cropService.featureRanges.mockReset().mockResolvedValue(ranges);
  cropService.recommend.mockReset().mockResolvedValue({ results: [], warnings: [] });
});
afterEach(cleanup);

const renderForm = async () => {
  render(<MemoryRouter><CropRecommendation /></MemoryRouter>);
  await waitFor(() => expect(screen.getByLabelText(/Money available for this crop/)).toBeTruthy());
};
const fillExample = () => fireEvent.click(screen.getByText("Nashik · Nov → Mar"));
const submit = async () => { fireEvent.click(screen.getByRole("button", { name: /Compare crops for my field/ })); await waitFor(() => expect(cropService.recommend).toHaveBeenCalled()); };
const sent = () => cropService.recommend.mock.calls[0][0];

describe("Step 4 · Budget & priorities (optional)", () => {
  it("is a fourth step in the stepper and a fourth card with the money field, two option groups and the 'leave empty' line", async () => {
    await renderForm();
    expect(screen.getByRole("heading", { name: "4. Field size, budget & priorities" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "2. Place and dates" })).toBeTruthy();
    expect(Array.from(document.querySelectorAll("ol.steps li")).map((li) => li.textContent.replace(/^\d/, ""))).toEqual(
      ["Step 1 · Soil", "Step 2 · Place & dates", "Step 3 · Weather (auto)", "Step 4 · Field & budget"]);
    expect(screen.getByRole("radiogroup", { name: /What matters most to you\?/ })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: /How much risk are you okay with\?/ })).toBeTruthy();
    expect(screen.getByText("Leave the budget empty to see the standard recommendation.")).toBeTruthy();
    expect(screen.getByTestId("priority-balanced").getAttribute("aria-checked")).toBe("true");     // defaults
    expect(screen.getByTestId("risk-medium").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByLabelText(/Money available/).value).toBe("");
  });

  it("works out the helper text from the real per-acre costs, the planting year and the field size", async () => {
    await renderForm();
    const area = document.getElementById("area_acres");
    fireEvent.change(area, { target: { value: "2" } });
    const m = document.getElementById("budget_inr-hint").textContent;
    // 2 acres: cheapest 28,000 x 1.05^years x 2 and dearest 110,000 x 1.05^years x 2, rounded to the nearest 1,000
    const year = (new Date().getMonth() + 1 <= Number(document.getElementById("planting_month").value)) ? new Date().getFullYear() : new Date().getFullYear() + 1;
    const f = (c) => (Math.round(c * 1.05 ** (year - 2024) * 2 / 1000) * 1000).toLocaleString("en-IN");
    expect(m).toBe(`For your 2 acres field, the crops cost about ₹${f(28000)}–₹${f(110000)}.`);
  });

  it("shows the amount with Indian digit grouping while typing", async () => {
    await renderForm();
    const b = screen.getByLabelText(/Money available/);
    fireEvent.change(b, { target: { value: "500000" } });
    expect(b.value).toBe("5,00,000");
    fireEvent.change(b, { target: { value: "40,000" } });
    expect(b.value).toBe("40,000");
  });

  it("gives friendly inline errors for an amount that is not a number, zero, negative or absurd", async () => {
    await renderForm();
    const b = screen.getByLabelText(/Money available/);
    for (const [text, msg] of [["abc", "Enter the amount in rupees, for example 40,000."], ["0", "The budget must be more than ₹0."],
      ["-500", "The budget must be more than ₹0."], ["99999999999", "That amount looks too large. Please check it."]]) {
      fireEvent.change(b, { target: { value: text } });
      fireEvent.blur(b);
      expect(document.getElementById("budget_inr-error").textContent, text).toContain(msg);
    }
    fireEvent.change(b, { target: { value: "40000" } });
    expect(document.getElementById("budget_inr-error")).toBeNull();
  });

  it("is not filled by the example buttons and 'Clear all' puts the defaults back", async () => {
    await renderForm();
    const b = screen.getByLabelText(/Money available/);
    fireEvent.change(b, { target: { value: "40000" } });
    fireEvent.click(screen.getByTestId("priority-spend_less"));
    fillExample();
    expect(b.value).toBe("40,000");
    expect(screen.getByTestId("priority-spend_less").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByText("Clear all"));
    expect(screen.getByLabelText(/Money available/).value).toBe("");
    expect(screen.getByTestId("priority-balanced").getAttribute("aria-checked")).toBe("true");
  });

  it("sends exactly the standard request when the card is left alone", async () => {
    await renderForm();
    fillExample();
    await submit();
    const req = sent();
    expect(Object.keys(req)).not.toEqual(expect.arrayContaining(["budget_inr"]));
    expect(req).not.toHaveProperty("priority");
    expect(req).not.toHaveProperty("risk_level");
    expect(req).toMatchObject({ city: "Nashik", planting_month: 11, selling_month: 3 });
  });

  it("sends the budget, priority and risk level once the farmer enters or changes them", async () => {
    await renderForm();
    fillExample();
    fireEvent.change(screen.getByLabelText(/Money available/), { target: { value: "5,00,000" } });
    fireEvent.click(screen.getByTestId("priority-highest_profit"));
    fireEvent.click(screen.getByTestId("risk-high"));
    await submit();
    expect(sent()).toMatchObject({ budget_inr: 500000, priority: "highest_profit", risk_level: "high" });
  });

  it("does not submit while the budget is invalid", async () => {
    await renderForm();
    fillExample();
    fireEvent.change(screen.getByLabelText(/Money available/), { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: /Compare crops for my field/ }));
    expect(cropService.recommend).not.toHaveBeenCalled();
  });
});
