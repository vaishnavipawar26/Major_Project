// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/priceService", () => ({ priceService: { options: vi.fn(), predict: vi.fn(), locations: vi.fn(), popularLocations: vi.fn() } }));
vi.mock("../services/api", () => ({ errorMessage: (e) => e.message }));
vi.mock("../components/PageHero", () => ({ default: ({ title }) => <h1>{title}</h1> }));

import Footer from "../components/Footer";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { priceService } from "../services/priceService";
import PricePrediction from "./PricePrediction";

const options = {
  today: "2026-10-20", data_end: "2025-12-31", max_horizon_days: 60, inflation_annual_pct: 5, unsupported_series: 182, min_listed_days: 30,
  commodities: [{ commodity: "Onion", states: ["Maharashtra"], validated_horizons: [10],
    markets: [{ market: "All markets (state median)", is_state_aggregate: true, varieties: ["All"], default_variety: "All", first_date: "2023-01-01", last_date: "2025-12-31" },
      { market: "APMC Pune", is_state_aggregate: false, varieties: ["Other"], default_variety: "Other", first_date: "2023-01-01", last_date: "2025-12-31" }] }],
};
afterEach(cleanup);
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};   // jsdom has none; the form scrolls to the first error
// what the location search returns for "Nashik" (GeoNames coordinates)
const NASHIK = { name: "Nashik", district: "Nashik", state: "Maharashtra", country: "India", latitude: 19.9973, longitude: 73.791,
  source: "Open-Meteo geocoding (GeoNames)", label: "Nashik, Maharashtra, India" };
const NASHIK_ROAD = { ...NASHIK, name: "Nashik Road", latitude: 19.95, longitude: 73.83, label: "Nashik Road, Nashik, Maharashtra, India" };
/** Type a growing location and pick the first suggestion. */
const chooseGrowing = async (text = "Nashik") => {
  priceService.locations.mockResolvedValue({ query: text, results: [NASHIK, NASHIK_ROAD] });
  fireEvent.change(screen.getByLabelText(/Growing location/), { target: { value: text } });
  const opt = await screen.findByRole("option", { name: "Nashik, Maharashtra, India" }, { timeout: 2000 });
  fireEvent.mouseDown(opt);
};
const GROWN = { growing_location: { name: "Nashik, Maharashtra, India", latitude: 19.9973, longitude: 73.791 } };
// the popular list as the backend serves it (the project's city_coordinates.csv values for these cities)
const city = (name, latitude, longitude) => ({ name, district: null, state: "Maharashtra", country: "India", latitude, longitude,
  source: "SmartCrop AI city list (verified coordinates)", label: `${name}, Maharashtra, India`, popular: true });
const POPULAR = [city("Nashik", 19.9975, 73.7898), city("Pune", 18.5204, 73.8567), city("Nagpur", 21.1458, 79.0882), city("Mumbai", 19.076, 72.8777),
  city("Ahilyanagar", 19.0952, 74.7496), city("Satara", 17.6805, 74.0183), city("Dharashiv", 18.186, 76.0419), city("Solapur", 17.6599, 75.9064)];
const renderForm = async (popular = []) => {
  priceService.options.mockResolvedValue(options);
  priceService.popularLocations.mockReset();
  if (popular === null) priceService.popularLocations.mockRejectedValue(new Error("down"));
  else priceService.popularLocations.mockResolvedValue({ results: popular });
  render(<MemoryRouter><PricePrediction /></MemoryRouter>);
  await waitFor(() => expect(screen.getByLabelText("Crop")).toBeTruthy());
};

describe("price prediction form", () => {
  it("shows only the essentials, with placeholders and the live starting date", async () => {
    await renderForm();
    expect(screen.getByRole("option", { name: "Choose a crop" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Choose a market" })).toBeTruthy();
    expect(document.querySelector(".date-ph").getAttribute("data-placeholder")).toBe("Choose a selling date");
    expect(screen.getByText("Forecast starting point: 20 Oct 2026")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "State" })).toBeNull();       // the state is shown, locked: not a form control
    const text = document.body.textContent;
    for (const gone of ["The crop you want to sell", "Choose one APMC market", "most reliable choice", "available for Maharashtra only",
      "available up to", "adjusted for about", "market price series are not listed", "are required", "Good to know"]) {
      expect(text, gone).not.toContain(gone);
    }
  });

  it("keeps the button disabled until crop, market, growing location and a valid date are chosen, then sends the same request", async () => {
    await renderForm();
    const btn = screen.getByRole("button", { name: "Show expected price" });
    expect(btn.disabled).toBe(true);
    expect(screen.getByLabelText("Market (mandi)").disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Crop"), { target: { value: "Onion" } });
    expect(screen.getByLabelText("Market (mandi)").disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Market (mandi)"), { target: { value: "APMC Pune" } });
    fireEvent.change(document.getElementById("target_date"), { target: { value: "2026-12-30" } });   // 71 days ahead: outside the 60-day limit
    expect(btn.disabled).toBe(true);
    fireEvent.change(document.getElementById("target_date"), { target: { value: "2026-11-05" } });
    expect(btn.disabled).toBe(true);                       // no growing location yet
    await chooseGrowing();
    expect(btn.disabled).toBe(false);
    priceService.predict.mockResolvedValue({ input_date: "2026-10-20" });
    fireEvent.click(btn);
    await waitFor(() => expect(priceService.predict).toHaveBeenCalledWith(
      { state: "Maharashtra", market: "APMC Pune", commodity: "Onion", variety: "Other", target_date: "2026-11-05", ...GROWN }));
  });

  it("the footer drops 'Good to know' on this page only", () => {
    const at = (path) => render(<MemoryRouter initialEntries={[path]}><Footer /></MemoryRouter>);
    at("/price-prediction");
    expect(screen.queryByText("Good to know")).toBeNull();
    cleanup();
    at("/history");
    expect(screen.getByText("Good to know")).toBeTruthy();
  });
});

describe("no manual field-condition inputs on the price form", () => {
  it("does not ask the farmer for soil pH or soil type, and sends only the essentials plus the growing location", async () => {
    await renderForm();
    for (const id of ["ph", "soil_type"]) expect(document.getElementById(id)).toBeNull();
    expect(document.body.textContent).not.toMatch(/soil pH|your field \(optional\)/i);
    priceService.predict.mockReset(); priceService.predict.mockResolvedValue({ input_date: "2026-10-20" });
    fireEvent.change(screen.getByLabelText("Crop"), { target: { value: "Onion" } });
    fireEvent.change(screen.getByLabelText("Market (mandi)"), { target: { value: "APMC Pune" } });
    fireEvent.change(document.getElementById("target_date"), { target: { value: "2026-11-05" } });
    await chooseGrowing();
    fireEvent.click(screen.getByRole("button", { name: "Show expected price" }));
    await waitFor(() => expect(priceService.predict).toHaveBeenCalledWith(
      { state: "Maharashtra", market: "APMC Pune", commodity: "Onion", variety: "Other", target_date: "2026-11-05", ...GROWN }));
  });
});

describe("growing location on the price form", () => {
  const fill = () => {
    fireEvent.change(screen.getByLabelText("Crop"), { target: { value: "Onion" } });
    fireEvent.change(screen.getByLabelText("Market (mandi)"), { target: { value: "APMC Pune" } });
    fireEvent.change(document.getElementById("target_date"), { target: { value: "2026-11-05" } });
  };
  const submit = () => fireEvent.submit(document.querySelector("form"));

  it("is its own required field, separate from the selling market, with an example", async () => {
    await renderForm();
    const input = screen.getByLabelText(/Growing location/);
    expect(input.getAttribute("placeholder")).toBe("e.g. Nashik, Maharashtra, India");
    expect(screen.getByLabelText("Market (mandi)")).not.toBe(input);
    expect(document.body.textContent).toContain("2. Where is the crop grown?");
    expect(document.body.textContent).toContain("3. When do you plan to sell?");
  });

  it("shows suggestions, and the chosen place with its coordinates so the farmer can check it", async () => {
    await renderForm();
    await chooseGrowing("Nashik, Maharashtra, India");
    expect(priceService.locations).toHaveBeenLastCalledWith("Nashik, Maharashtra, India");
    const resolved = screen.getByTestId("growing-resolved").textContent;
    expect(resolved).toContain("Nashik, Maharashtra, India");
    expect(resolved).toContain("19.9973° N, 73.7910° E");
    expect(screen.queryByTestId("growing-suggestions")).toBeNull();
    fireEvent.change(screen.getByLabelText(/Growing location/), { target: { value: "Sinnar" } });   // editing clears the choice
    expect(screen.queryByTestId("growing-resolved")).toBeNull();
  });

  it("an empty growing location is a clear error and nothing is sent", async () => {
    await renderForm();
    priceService.predict.mockReset();
    fill();
    submit();
    expect(await screen.findByText("Enter where the crop is grown (village, town or district).")).toBeTruthy();
    expect(priceService.predict).not.toHaveBeenCalled();
    await chooseGrowing();                                       // choosing a place clears the error
    expect(screen.queryByText("Enter where the crop is grown (village, town or district).")).toBeNull();
    expect(screen.queryByText(/highlighted field/)).toBeNull();
  });

  it("text that matches no place says so, and typed text that was not chosen from the list is not sent", async () => {
    await renderForm();
    priceService.predict.mockReset();
    priceService.locations.mockResolvedValue({ query: "Zzqx", results: [] });
    fill();
    fireEvent.change(screen.getByLabelText(/Growing location/), { target: { value: "Zzqx" } });
    expect(await screen.findByTestId("growing-none", {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show expected price" }).disabled).toBe(true);
    submit();
    expect(await screen.findByText("Choose your place from the list so it can be found on the map.")).toBeTruthy();
    expect(priceService.predict).not.toHaveBeenCalled();
  });

  it("when the location search is down, the farmer can still continue with the typed place", async () => {
    await renderForm();
    priceService.predict.mockReset(); priceService.predict.mockResolvedValue({ input_date: "2026-10-20" });
    priceService.locations.mockRejectedValue({ response: { status: 503 } });
    fill();
    fireEvent.change(screen.getByLabelText(/Growing location/), { target: { value: "Sinnar, Nashik" } });
    expect(await screen.findByTestId("growing-down", {}, { timeout: 2000 })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show expected price" }));
    await waitFor(() => expect(priceService.predict).toHaveBeenCalledWith(expect.objectContaining({ growing_location: { name: "Sinnar, Nashik" } })));
  });
});

describe("locked State on the price form", () => {
  const group = () => screen.getByRole("group", { name: "State" });

  it("shows 'Maharashtra' as a label and a value, with the hint under it", async () => {
    await renderForm();
    expect(group().textContent).toContain("State");
    expect(group().querySelector(".state-chip").textContent).toBe("Maharashtra");
    expect(group().querySelector(".hint").textContent).toBe("SmartCrop AI currently covers Maharashtra markets only.");
  });

  it("is the same grey pill with a lock icon as the crop form, not an editable or focusable control", async () => {
    await renderForm();
    const chip = group().querySelector(".state-chip");
    expect(chip.querySelector("svg")).toBeTruthy();                                   // the lock
    expect(group().querySelectorAll("input, select, textarea, button, [tabindex], [contenteditable]")).toHaveLength(0);
    expect(screen.queryByRole("textbox", { name: "State" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "State" })).toBeNull();
    expect(screen.queryByDisplayValue("Maharashtra")).toBeNull();                     // no form field holds the value
    fireEvent.click(chip);
    expect(chip.textContent).toBe("Maharashtra");
    const src = readFileSync(resolve("src/pages/CropRecommendation.jsx"), "utf8");
    expect(src).toContain("<LockedState");                                           // one shared component for both pages
    expect(readFileSync(resolve("src/pages/PricePrediction.jsx"), "utf8")).toContain("<LockedState");
  });

  it("comes first, before Crop and Market, in the reading order", async () => {
    await renderForm();
    const pos = (el) => el.compareDocumentPosition.bind(el);
    expect(pos(group())(screen.getByLabelText("Crop")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pos(screen.getByLabelText("Crop"))(screen.getByLabelText("Market (mandi)")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(group().closest(".form-grid").classList.contains("form-grid-3")).toBe(true);
  });

  it("is one row of three at desktop width and stacks State, Crop, Market at phone width", () => {
    const css = readFileSync(resolve("src/index.css"), "utf8");
    expect(css).toMatch(/\.price-form \.form-grid\.form-grid-3 \{ grid-template-columns: minmax\(9\.5rem, 0\.7fr\) minmax\(0, 1fr\) minmax\(0, 1\.3fr\);/);      // State narrower
    expect(css).toMatch(/@media \(max-width: 900px\) \{ \.price-form \.form-grid\.form-grid-3 \{ grid-template-columns: minmax\(0, 1fr\); \} \}/);    // one column
  });
});

describe("growing location suggestions", () => {
  const input = () => screen.getByLabelText(/Growing location/);
  const shown = () => screen.queryAllByRole("option").filter((o) => o.closest("[data-testid=growing-suggestions]")).map((o) => o.textContent);

  it("clicking the field shows popular Maharashtra places at once, in the agreed order", async () => {
    await renderForm(POPULAR);
    await waitFor(() => expect(priceService.popularLocations).toHaveBeenCalled());
    expect(screen.queryByTestId("growing-suggestions")).toBeNull();                 // closed until the field is used
    fireEvent.focus(input());
    await screen.findByTestId("growing-suggestions");
    expect(screen.getByText("Popular places in Maharashtra")).toBeTruthy();
    expect(shown().slice(0, 7)).toEqual(["Nashik", "Pune", "Nagpur", "Mumbai", "Ahilyanagar", "Satara", "Dharashiv"].map((c) => `${c}, Maharashtra, India`));
    expect(priceService.locations).not.toHaveBeenCalledWith("");                   // nothing searched before typing
  });

  it("typing filters the popular places immediately, and a click sets that place's coordinates", async () => {
    await renderForm(POPULAR);
    priceService.locations.mockReset(); priceService.locations.mockResolvedValue({ results: [] });
    await waitFor(() => expect(priceService.popularLocations).toHaveBeenCalled());
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "sa" } });
    await waitFor(() => expect(shown()).toEqual(["Satara, Maharashtra, India"]));
    fireEvent.change(input(), { target: { value: "Ahil" } });
    await waitFor(() => expect(shown()).toEqual(["Ahilyanagar, Maharashtra, India"]));
    fireEvent.mouseDown(screen.getByRole("option", { name: "Ahilyanagar, Maharashtra, India" }));
    expect(screen.getByTestId("growing-resolved").textContent).toContain("19.0952° N, 74.7496° E");
    expect(screen.queryByTestId("growing-suggestions")).toBeNull();
  });

  it("can be used with the keyboard: arrows move, Enter chooses, Escape closes", async () => {
    await renderForm(POPULAR);
    await waitFor(() => expect(priceService.popularLocations).toHaveBeenCalled());
    fireEvent.focus(input());
    await screen.findByTestId("growing-suggestions");
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByTestId("growing-suggestions")).toBeNull();
    fireEvent.keyDown(input(), { key: "ArrowDown" });                               // opens again
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(input().getAttribute("aria-activedescendant")).toBe("growing-opt-1");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(input().value).toBe("Pune, Maharashtra, India");
    expect(screen.getByTestId("growing-resolved").textContent).toContain("18.5204° N, 73.8567° E");
  });

  it("a place outside the popular list is found with the location search", async () => {
    await renderForm(POPULAR);
    const SINNAR = { name: "Sinnar", district: "Nashik", state: "Maharashtra", country: "India", latitude: 19.8451, longitude: 73.9987,
      source: "Open-Meteo geocoding (GeoNames)", label: "Sinnar, Nashik, Maharashtra, India" };
    priceService.locations.mockReset(); priceService.locations.mockResolvedValue({ results: [SINNAR] });
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "Sinnar" } });
    const opt = await screen.findByRole("option", { name: "Sinnar, Nashik, Maharashtra, India" }, { timeout: 2000 });
    expect(priceService.locations).toHaveBeenLastCalledWith("Sinnar");
    fireEvent.mouseDown(opt);
    expect(screen.getByTestId("growing-resolved").textContent).toContain("19.8451° N, 73.9987° E");
  });

  it("the growing location and the selling market stay independent, and the request carries the chosen place", async () => {
    await renderForm(POPULAR);
    priceService.predict.mockReset(); priceService.predict.mockResolvedValue({ input_date: "2026-10-20" });
    await waitFor(() => expect(priceService.popularLocations).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Crop"), { target: { value: "Onion" } });
    fireEvent.change(screen.getByLabelText("Market (mandi)"), { target: { value: "APMC Pune" } });
    fireEvent.change(document.getElementById("target_date"), { target: { value: "2026-11-05" } });
    fireEvent.focus(input());
    fireEvent.mouseDown(await screen.findByRole("option", { name: "Satara, Maharashtra, India" }));
    expect(screen.getByLabelText("Market (mandi)").value).toBe("APMC Pune");          // choosing a place does not touch the market
    fireEvent.change(screen.getByLabelText("Market (mandi)"), { target: { value: "All markets (state median)" } });
    expect(screen.getByTestId("growing-resolved").textContent).toContain("Satara");  // nor the market the place
    fireEvent.change(screen.getByLabelText("Market (mandi)"), { target: { value: "APMC Pune" } });
    fireEvent.click(screen.getByRole("button", { name: "Show expected price" }));
    await waitFor(() => expect(priceService.predict).toHaveBeenCalledWith(expect.objectContaining({
      market: "APMC Pune", growing_location: { name: "Satara, Maharashtra, India", latitude: 17.6805, longitude: 74.0183 } })));
  });

  it("if the popular list cannot be loaded, typing still searches", async () => {
    await renderForm(null);
    priceService.locations.mockReset(); priceService.locations.mockResolvedValue({ results: [NASHIK] });
    fireEvent.focus(input());
    expect(screen.queryByTestId("growing-suggestions")).toBeNull();
    fireEvent.change(input(), { target: { value: "Nashik" } });
    expect(await screen.findByRole("option", { name: "Nashik, Maharashtra, India" }, { timeout: 2000 })).toBeTruthy();
  });
});
