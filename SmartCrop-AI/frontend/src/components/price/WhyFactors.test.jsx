// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WhyFactorsMatter } from "./WhyFactors";

const CROPS = ["Brinjal", "Cabbage", "Cauliflower", "Onion", "Potato", "Tomato", "Wheat"];
const IDS = ["season", "market", "temperature", "humidity", "soil", "ph", "location"];
const RAIN = /rainfall|\brain\b|बारिश|पाऊस/i;
const REMOVED = /not used to calculate|does not change the predicted price|not inputs to the current price|shown for context|Context only|Location context/i;
const nb = (s) => s.replace(/ /g, " ");

// the shapes the weather and soil lookups return (synthetic values; the component only displays what it is given)
const pune = "Pune, Maharashtra, India";
const forecastWx = { state: "ok", data: { status: "forecast", date: "2026-11-07", temperature_c: 26.3, rainfall_mm: 0, humidity_pct: 61,
  rainfall_basis: "single_day", place: pune, place_kind: "growing_location" } };
const typicalWx = { state: "ok", data: { ...forecastWx.data, status: "typical", date: "2026-12-08", temperature_c: 24.4, rainfall_mm: 0.1,
  humidity_pct: 65, rainfall_basis: "daily_average" } };
const noWx = { state: "ok", data: { status: "unavailable", date: "2026-12-08", temperature_c: null, rainfall_mm: null, humidity_pct: null, reason: "no_data" } };
const soil = { state: "ok", data: { status: "estimate", ph: 6.8, soil_type: "Vertisols", ph_scope: "town_centre", place: pune, place_kind: "growing_location" } };
const noSoil = { state: "ok", data: { status: "unavailable", ph: null, soil_type: null, reason: "service_unreachable" } };
const exp = (experimental = false, season = 89, market = -20) => ({ ...(experimental ? { v3: { context_only: true } } : {}), charts: { local: { matches_forecast: true, steps: [
  { group: "season", log_contribution: 0.03, inr: season }, { group: "crop_market", log_contribution: -0.01, inr: market }] } } });
const inputs = { season: true, crop_market: true, temperature: false, rainfall: false, humidity: false, soil_type: false, soil_ph: false };
const MARKET = "All Maharashtra markets (middle price)";

const show = (crop, { weather = forecastWx, s = soil, experimental = false, season, market } = {}) => render(
  <WhyFactorsMatter exp={exp(experimental, season, market)} crop={crop} market={MARKET} targetDate="2026-11-07"
    weather={weather} soil={s} growing={{ name: pune }} modelInputs={inputs} />);
const value = (id) => nb(screen.getByTestId(`wf-${id}-value`).textContent);
const badge = (id) => screen.getByTestId(`wf-${id}`).querySelector(".wf-status").textContent;
const twoLines = (id) => [...screen.getByTestId(`wf-${id}-contrib`).querySelectorAll("span")].map((x) => nb(x.textContent));
const lineOf = (id) => nb((screen.queryByTestId(`wf-${id}-line`) || screen.getByTestId(`wf-${id}-contrib`)).textContent);

afterEach(cleanup);

describe("Why these factors matter", () => {
  it("seven cards in the grid, no rainfall card, each with its value and badge, no subtitle", () => {
    show("Potato");
    expect([...document.querySelectorAll(".wf-grid > .wf-card")].map((c) => c.dataset.testid)).toEqual(IDS.map((id) => `wf-${id}`));
    expect(screen.queryByTestId("wf-note")).toBeNull();
    expect(IDS.map(value)).toEqual(["7 November 2026", `Potato · ${MARKET}`, "26.3 °C (forecast)", "61% (forecast)",
      "Vertisols (regional estimate)", "6.8 (regional estimate)", "Pune"]);
    expect(IDS.map(badge)).toEqual(["Used by the model", "Used by the model", "Farm guidance", "Farm guidance",
      "Regional estimate", "Regional estimate", "Location"]);
    expect(screen.queryByTestId("wf-rainfall")).toBeNull();
    expect(screen.getByTestId("why-factors").textContent).not.toMatch(RAIN);
  });

  it("season and market explain the real contribution in exactly two lines; the other cards have one short line", () => {
    show("Onion");
    expect(twoLines("season")).toEqual(["In past years, Onion prices around this time of year were above average.", "So the model adds ₹89 per quintal."]);
    expect(twoLines("market")).toEqual([`Past prices of Onion at ${MARKET} were below the model's average level.`, "So the model subtracts ₹20 per quintal."]);
    expect(lineOf("temperature")).toBe("Affects crop growth and quality.");
    expect(lineOf("humidity")).toBe("Affects disease and rotting in storage.");
    expect(lineOf("soil")).toBe("Affects drainage and water holding.");
    expect(lineOf("ph")).toBe("Affects how well crops take up nutrients.");
    expect(lineOf("location")).toBe("Where weather and soil are looked up.");
    for (const id of IDS.slice(2)) {
      const card = screen.getByTestId(`wf-${id}`);
      expect(card.querySelectorAll(".wf-text, .wf-contrib")).toHaveLength(1);
      expect(lineOf(id).split(/\s+/).length).toBeLessThanOrEqual(12);
    }
    for (const id of IDS.slice(2)) expect(screen.queryByTestId(`wf-${id}-contrib`)).toBeNull();   // weather and soil never get one
  });

  it("without a contribution the season and market cards show their plain line", () => {
    render(<WhyFactorsMatter exp={{ charts: { local: { matches_forecast: false, steps: [] } } }} crop="Wheat" market={MARKET} targetDate="2026-11-07"
      weather={forecastWx} soil={soil} growing={{ name: pune }} modelInputs={inputs} />);
    expect(lineOf("season")).toBe("Prices rise and fall with harvest seasons.");
    expect(lineOf("market")).toBe("Based on this crop's past prices at this market.");
  });

  it.each([
    ["season", 89, "In past years, Potato prices around this time of year were above average.", "So the model adds ₹89 per quintal."],
    ["season", -1234.4, "In past years, Potato prices around this time of year were below average.", "So the model subtracts ₹1,234 per quintal."],
    ["market", 42.6, `Past prices of Potato at ${MARKET} were above the model's average level.`, "So the model adds ₹43 per quintal."],
    ["market", -20, `Past prices of Potato at ${MARKET} were below the model's average level.`, "So the model subtracts ₹20 per quintal."],
  ])("%s %d: two lines with the real amount and direction, based only on past prices", (id, inr, first, second) => {
    show("Potato", id === "season" ? { season: inr } : { market: inr });
    expect(twoLines(id)).toEqual([first, second]);
    expect(screen.getByTestId(`wf-${id}-contrib`).querySelectorAll("br")).toHaveLength(1);
    expect(screen.getByTestId(`wf-${id}-contrib`).textContent).not.toMatch(/supply|demand|weather|rain/i);
    expect(badge(id)).toBe("Used by the model");
  });

  it.each(CROPS)("%s: same seven cards, same badges, no removed disclaimer", (crop) => {
    show(crop);
    expect(document.querySelectorAll(".wf-grid > .wf-card")).toHaveLength(7);
    expect(document.body.textContent).not.toMatch(REMOVED);
    expect(value("market")).toBe(`${crop} · ${MARKET}`);
  });

  it("shows the experimental note once under the cards, not on each contribution", () => {
    show("Tomato", { experimental: true });
    expect(screen.getAllByText("Experimental estimate, not validated.")).toHaveLength(1);
    expect(twoLines("season")[1]).toBe("So the model adds ₹89 per quintal.");
    expect(screen.getByTestId("wf-season-contrib").textContent).not.toContain("Experimental");
  });

  it("typical weather beyond the forecast says so", () => {
    show("Potato", { weather: typicalWx });
    expect(value("temperature")).toBe("24.4 °C (typical for this time of year)");
    expect(value("humidity")).toBe("65% (typical for this time of year)");
  });

  it("uses the selected growing location", () => {
    show("Cabbage");
    expect(value("location")).toBe("Pune");
  });

  it("genuinely missing values say Not available and show no number", () => {
    show("Wheat", { weather: noWx, s: noSoil });
    for (const id of ["temperature", "humidity", "soil", "ph"]) expect(value(id)).toBe("Not available");
  });
});
