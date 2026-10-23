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
const card4 = () => screen.getByRole("heading", { name: "4. Field size, budget & priorities" }).closest("section");
const area = () => document.getElementById("area_acres");
const type = (v) => fireEvent.change(area(), { target: { value: v } });
const convert = () => screen.getByTestId("area-convert").textContent;

describe("field size moved into the Step 4 card", () => {
  it("lives in the Step 4 card, before the budget, and no longer in the place card", async () => {
    await renderForm();
    expect(card4().contains(area())).toBe(true);
    expect(screen.getByRole("heading", { name: "2. Place and dates" }).closest("section").contains(area())).toBe(false);
    const inputs = Array.from(card4().querySelectorAll("input"));
    expect(inputs.indexOf(area())).toBeLessThan(inputs.indexOf(document.getElementById("budget_inr")));
    expect(card4().querySelector("[aria-label='Decrease field size']")).toBeTruthy();
    expect(card4().querySelector("[aria-label='Increase field size']")).toBeTruthy();
  });

  it("marks only the budget, priority and risk as optional; the field size stays required with a 1 acre default", async () => {
    await renderForm();
    expect(screen.getByLabelText(/Money available for this crop, ₹ \(optional\)/)).toBeTruthy();
    expect(screen.getByText("What matters most to you? (optional)")).toBeTruthy();
    expect(screen.getByText("How much risk are you okay with? (optional)")).toBeTruthy();
    const label = document.querySelector('label[for="area_acres"]');
    expect(label.textContent).toContain("Field size");
    expect(label.textContent).not.toMatch(/optional/i);
    expect(label.querySelector(".field-req")).toBeTruthy();
    expect(area().value).toBe("1");
  });

  it("uses the default size and never holds up the stepper when the farmer does not visit Step 4", async () => {
    await renderForm();
    fillExample();
    const items = Array.from(document.querySelectorAll("ol.steps li"));
    expect(items.every((li) => li.classList.contains("is-done"))).toBe(true);        // including Step 4: valid by default
    await submit();
    expect(sent().area_acres).toBe(1);
  });

  it("is still filled by the example buttons", async () => {
    await renderForm();
    fireEvent.click(screen.getByText("Nagpur · Nov → Mar"));                           // the Wheat example is a 2-acre field
    expect(area().value).toBe("2");
    await submit();
    expect(sent().area_acres).toBe(2);
  });
});

describe("acre and guntha", () => {
  it("converts both ways with a live line under the input", async () => {
    await renderForm();
    expect(screen.getByTestId("unit-acre").getAttribute("aria-checked")).toBe("true");   // acre is the default
    type("0.5");
    expect(convert()).toBe("= 20 guntha");
    fireEvent.click(screen.getByTestId("unit-guntha"));
    expect(area().value).toBe("20");                                                     // the same field, shown in guntha
    expect(convert()).toBe("= 0.5 acre");
    type("30");
    expect(convert()).toBe("= 0.75 acre");
    type("1");
    expect(convert()).toBe("= 0.025 acre");
    type("100");
    expect(convert()).toBe("= 2.5 acres");
    fireEvent.click(screen.getByTestId("unit-acre"));
    expect(area().value).toBe("2.5");
    expect(convert()).toBe("= 100 guntha");
  });

  it("always sends acres, whatever unit is on screen", async () => {
    await renderForm();
    fillExample();
    fireEvent.click(screen.getByTestId("unit-guntha"));
    type("30");
    await submit();
    expect(sent().area_acres).toBe(0.75);
  });

  it("an example button refills the size in the unit that is shown", async () => {
    await renderForm();
    fireEvent.click(screen.getByTestId("unit-guntha"));
    fireEvent.click(screen.getByText("Nagpur · Nov → Mar"));                           // 2 acres
    expect(area().value).toBe("80");
    expect(convert()).toBe("= 2 acres");
  });

  it("steps by 0.5 in acres and by 1 in guntha, and never goes below the smallest size", async () => {
    await renderForm();
    fireEvent.click(screen.getByLabelText("Increase field size"));
    expect(area().value).toBe("1.5");
    fireEvent.click(screen.getByLabelText("Decrease field size"));
    fireEvent.click(screen.getByLabelText("Decrease field size"));
    expect(area().value).toBe("0.5");
    fireEvent.click(screen.getByLabelText("Decrease field size"));
    expect(area().value).toBe("0.0125");
    fireEvent.click(screen.getByTestId("unit-guntha"));
    expect(area().value).toBe("0.5");
    fireEvent.click(screen.getByLabelText("Increase field size"));
    expect(area().value).toBe("1.5");
    fireEvent.click(screen.getByLabelText("Increase field size"));
    expect(area().value).toBe("2.5");
    fireEvent.click(screen.getByLabelText("Decrease field size"));
    expect(area().value).toBe("1.5");
  });
});

describe("guntha-acre table", () => {
  it("is hidden until the link is clicked, then shows exactly the five rows, and hides again", async () => {
    await renderForm();
    expect(screen.queryByTestId("area-table")).toBeNull();
    const link = screen.getByTestId("area-table-toggle");
    expect(link.textContent).toBe("Show guntha–acre table");
    fireEvent.click(link);
    expect(link.textContent).toBe("Hide table");
    expect(Array.from(screen.getByTestId("area-table").querySelectorAll("li")).map((li) => li.textContent)).toEqual([
      "½ guntha = 0.0125 acre", "1 guntha = 0.025 acre", "10 guntha = 0.25 acre", "20 guntha = 0.5 acre", "40 guntha = 1 acre"]);
    fireEvent.click(link);
    expect(screen.queryByTestId("area-table")).toBeNull();
  });

  it("fills the input from a row, in the selected unit", async () => {
    await renderForm();
    fireEvent.click(screen.getByTestId("area-table-toggle"));
    fireEvent.click(screen.getByText("10 guntha = 0.25 acre"));
    expect(area().value).toBe("0.25");                                                    // acre mode: acres
    fireEvent.click(screen.getByTestId("unit-guntha"));
    fireEvent.click(screen.getByText("20 guntha = 0.5 acre"));
    expect(area().value).toBe("20");                                                      // guntha mode: guntha
    expect(convert()).toBe("= 0.5 acre");
    fireEvent.click(screen.getByText("½ guntha = 0.0125 acre"));
    expect(area().value).toBe("0.5");
    expect(convert()).toBe("= 0.0125 acre");
  });
});

describe("validation and the helper text", () => {
  it("checks the limits (above 0, up to 1,000 acres) and words the message in the selected unit", async () => {
    await renderForm();
    const err = () => document.getElementById("area_acres-error")?.textContent ?? null;
    for (const [v, msg] of [["", "Field size is required."], ["abc", "Field size must be a number."],
      ["0", "Enter a field size between 0.0125 and 1,000 acres."], ["0.01", "Enter a field size between 0.0125 and 1,000 acres."],
      ["1001", "Enter a field size between 0.0125 and 1,000 acres."]]) {
      type(v); fireEvent.blur(area());
      expect(err(), `"${v}" acres`).toContain(msg);
    }
    for (const v of ["0.0125", "1000", "0.5"]) { type(v); expect(err(), `${v} acres`).toBeNull(); }
    fireEvent.click(screen.getByTestId("unit-guntha"));
    for (const [v, msg] of [["0.4", "Enter a field size between 0.5 and 40,000 guntha."], ["40001", "Enter a field size between 0.5 and 40,000 guntha."]]) {
      type(v); fireEvent.blur(area());
      expect(err(), `"${v}" guntha`).toContain(msg);
    }
    for (const v of ["0.5", "40000", "7"]) { type(v); expect(err(), `${v} guntha`).toBeNull(); }
  });

  it("does not submit while the field size is wrong", async () => {
    await renderForm();
    fillExample();
    type("0");
    fireEvent.click(screen.getByRole("button", { name: /Compare crops for my field/ }));
    expect(cropService.recommend).not.toHaveBeenCalled();
  });

  it("updates the budget helper text live as the size changes, and shows no ₹0 for a very small field", async () => {
    await renderForm();
    const hint = () => document.getElementById("budget_inr-hint").textContent;
    const first = hint();
    type("3");
    expect(hint()).not.toBe(first);
    expect(hint()).toMatch(/^For your 3 acres field, the crops cost about ₹[\d,]+–₹[\d,]+\.$/);
    type("0.5");
    expect(hint()).toMatch(/^For your 0\.5 acre field,/);
    type("0.0125");                                                                      // half a guntha
    expect(hint()).toMatch(/^For your 0\.0125 acre field, the crops cost about ₹[1-9][\d,]*–₹[1-9][\d,]*\.$/);
    expect(hint()).not.toMatch(/₹0\b/);
    fireEvent.click(screen.getByTestId("unit-guntha"));                                  // the same size seen in guntha: the same helper text
    expect(hint()).toMatch(/^For your 0\.0125 acre field/);
  });
});
