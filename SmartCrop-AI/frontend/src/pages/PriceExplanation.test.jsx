// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/priceService", () => ({ priceService: { explain: vi.fn(), weatherContext: vi.fn(), soilContext: vi.fn() } }));
vi.mock("../services/historyService", () => ({ historyService: { priceItem: vi.fn() } }));
vi.mock("../services/api", () => ({ errorMessage: (e) => e.message }));
// jsdom has no layout: give recharts' container a fixed size
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal();
  const { cloneElement } = await import("react");
  return { ...actual, ResponsiveContainer: ({ children }) => <div>{cloneElement(children, { width: 900, height: 400 })}</div> };
});

import { historyService } from "../services/historyService";
import { priceService } from "../services/priceService";
import PriceExplanation from "./PriceExplanation";
import { matchesRequest } from "../utils/explanationView";

const factor = (name, direction, strength, shap) => ({
  factor: name, title: `Title ${name}`, direction, strength, impact: strength === "small" ? "small" : direction === "up" ? "higher" : "lower",
  shap_value: shap, shap_scale: "log", evidence: [{ label: `Measure ${name}`, value: 5, unit: "%", reference: "ref", reference_value: null, change_pct: 5, source: "s" }],
  evidence_available: true, observation: `obs ${name}`, model_says: `model ${name}`, farmer_effect: `effect ${name}`, meaning: `mean ${name}`, evidence_trend: null, sentence: "",
});
const req = { state: "Maharashtra", market: "Pune", commodity: "Brinjal", target_date: "2026-11-11", as_of: "2026-10-16" };
const exp = (over = {}) => ({
  horizon_days: 26, date: "2026-11-11", method: "SHAP", output_space: "log(price[t+h] / price[t])", base_value: 0.01, base_change_pct: 1,
  prediction_change_pct: 10, all_small: false,
  summary: { reference_price: 2625, predicted_price: 2888, change_abs: 263, change_pct: 10, direction: "higher", horizon_days: 26, within_typical_error: false, typical_error_pct: null, headline: "Why is Brinjal's price forecast higher?" },
  farmer_explanation: [],
  factors: [factor("season", "up", "moderate", 0.05), factor("arrivals", "down", "strong", -0.04), factor("averages", "up", "moderate", 0.02), factor("volatility", "up", "small", 0.001)],
  main_factors: ["season", "arrivals", "averages"], projected: false,
  reasons: [
    { id: "season", title: "Title season", direction: "up", evidence: "evidence season.", meaning: "meaning season." },
    { id: "arrivals", title: "Title arrivals", direction: "down", evidence: "evidence arrivals.", meaning: "meaning arrivals." },
    { id: "averages", title: "Title averages", direction: "up", evidence: "evidence averages.", meaning: "meaning averages." },
  ],
  what_it_means: "The forecast is higher mainly because of the seasonal pattern in earlier years. However, the actual price may differ if supply or demand change.",
  data_basis: { kind: "historical", projected: false, data_end: "2025-12-31", text: "Based on historical prices up to 2025-12-31. No live market feed is connected." },
  scope: { kind: "state", text: "Prices are the median across Maharashtra markets." },
  net_summary: { code: "outweigh", forecast_side: "up", higher: ["title season", "title averages"], lower: ["title arrivals"], up_total: 0.07, down_total: 0.04 }, algorithm: "Random Forest",
  higher_factors: [], lower_factors: [],
  reliability: { basis: "b", model_mae: 300, baseline_mae: 350, beats_no_change: true, n_tests: 400, sufficient_data: true },
  price_range: null, data_completeness: { basis: "b", inputs_total: 10, inputs_missing: 0, missing: [] }, data_limitations: ["Limit A"],
  weather: { status: "not_used", used: false }, strength_basis: "x",
  technical: { model_output_log: 0.0953, sum_of_contributions_log: 0.0853, features: { log_price: 0.05, doy_cos: 0.0353 }, feature_values: { log_price: 7.8 },
    reconstruction_ok: true, reconstruction_error: 0, reconstruction_tolerance: 0.001, grouped: { season: { title: "Seasonal", shap_value: 0.05, features: [] } }, note: "n" },
  ...over,
});
const response = (over = {}) => ({ series: { commodity: "Brinjal", market: "Pune", state: "Maharashtra" }, forecast_origin_date: "2026-10-16",
  target_date: "2026-11-11", current_price: 2625, model: { version: "v1", algorithm: "XGBoost" }, explanations: [exp()], ...over });

function Probe() { const l = useLocation(); return <span data-testid="path">{l.pathname}</span>; }
const renderAt = (entry) => render(
  <MemoryRouter initialEntries={[entry]}>
    <Routes>
      <Route path="/price-prediction/explanation" element={<PriceExplanation />} />
      <Route path="/price-prediction" element={<span>form page</span>} />
      <Route path="/price-prediction/result" element={<span>result page</span>} />
    </Routes>
    <Probe />
  </MemoryRouter>);
const withState = (r = response()) => ({ pathname: "/price-prediction/explanation", state: { req, explain: r } });

beforeEach(() => {
  priceService.explain.mockReset(); historyService.priceItem.mockReset();
  priceService.weatherContext.mockReset(); priceService.weatherContext.mockResolvedValue({ status: "unavailable", temperature_c: null });
  priceService.soilContext.mockReset(); priceService.soilContext.mockResolvedValue({ status: "unavailable", ph: null, soil_type: null });
});
afterEach(cleanup);

const withCharts = () => response({ explanations: [exp({ date: "2026-11-11", base_value: 0.01, technical: { ...exp().technical, model_output_log: 0.0953, reconstruction_ok: true },
  charts: { local: { start_price: 2625, baseline_inr: 20, baseline_price: 2645, end_price: 2886, forecast_price: 2886, matches_forecast: true,
    steps: [{ group: "season", title: "Seasonal pattern", help: "h", log_contribution: 0.05, inr: 150 }, { group: "price_level", title: "Current price level", help: "h", log_contribution: 0.03, inr: 90 }] } } })] });

const OLD = /replays the same season|What the records show|Season: no usual rise|Recent prices|How far to trust this|AI's final explanation|Technical details|Your market vs|How the past tests|What Do These Conditions Mean|Advanced explanation|Pushing the Price|What This Means for You/;

describe("PriceExplanation page", () => {
  it("shows the approved view without calling the model again", () => {
    renderAt(withState(withCharts()));
    expect(screen.getByTestId("understand")).toBeTruthy();
    expect(screen.getByTestId("influence-card")).toBeTruthy();
    expect(priceService.explain).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(OLD);
  });

  it("never shows the old replay / records / technical sections, even without a trusted forecast", () => {
    // no breakdown at all (an older saved response), a breakdown that does not add up, and a crop with no forecast
    const broken = exp(); broken.technical = { ...broken.technical, reconstruction_ok: false };
    const noForecast = exp({ policy: { mode: "context_only" }, v3: { context_only: true } });
    for (const r of [response(), response({ explanations: [broken] }), response({ explanations: [noForecast] })]) {
      renderAt(withState(r));
      expect(screen.getByTestId("no-price-status")).toBeTruthy();
      expect(screen.getAllByTestId("influence-card").length).toBe(1);
      expect(document.body.textContent).not.toMatch(OLD);
      expect(document.querySelector("table, details")).toBeNull();
      cleanup();
    }
  });

  it("with no state and no id shows a fallback and never fetches", () => {
    renderAt("/price-prediction/explanation");
    expect(screen.getByText("No prediction to explain")).toBeTruthy();
    expect(priceService.explain).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Go to price prediction" }).getAttribute("href")).toBe("/price-prediction");
  });

  it("loads a saved prediction by id and fetches its explanation", async () => {
    historyService.priceItem.mockResolvedValue({ state: "Maharashtra", market: "Pune", commodity: "Brinjal", variety: null, input_date: "2026-10-16", horizon_days: 26 });
    priceService.explain.mockResolvedValue(withCharts());
    renderAt("/price-prediction/explanation?id=7");
    await waitFor(() => expect(screen.getByTestId("influence-card")).toBeTruthy());
    expect(priceService.explain.mock.calls[0][0]).toMatchObject({ commodity: "Brinjal", target_date: "2026-11-11", as_of: "2026-10-16" });
  });

  it("refuses an explanation for a different crop (no stale data)", async () => {
    priceService.explain.mockResolvedValue(response({ series: { commodity: "Onion", market: "Pune", state: "Maharashtra" } }));
    renderAt({ pathname: "/price-prediction/explanation", state: { req } });
    await waitFor(() => expect(screen.getByText(/does not match this prediction/)).toBeTruthy());
    expect(screen.queryByTestId("influence-card")).toBeNull();
  });

  it("shows an error with a way back when the request fails", async () => {
    priceService.explain.mockRejectedValue(new Error("boom"));
    renderAt({ pathname: "/price-prediction/explanation", state: { req } });
    await waitFor(() => expect(screen.getByText("boom")).toBeTruthy());
    expect(screen.getByRole("link", { name: "Go to price prediction" })).toBeTruthy();
  });

  it("back button returns to the result page when there is no earlier history entry", () => {
    renderAt(withState(withCharts()));
    fireEvent.click(screen.getByRole("button", { name: /Back to prediction results/ }));
    expect(screen.getByText("result page")).toBeTruthy();
  });

  it("matchesRequest compares crop and target date", () => {
    expect(matchesRequest(req, response())).toBe(true);
    expect(matchesRequest({ ...req, target_date: "2026-12-01" }, response())).toBe(false);
    expect(matchesRequest(null, response())).toBe(false);
  });
});

describe("What Influences Your Predicted Price? card", () => {
  it("appears exactly once, right below 'A. Your Predicted Price' and above the other sections, with this prediction's values", async () => {
    priceService.weatherContext.mockResolvedValue({ status: "forecast", market: "Pune", date: "2026-11-11", temperature_c: 31.4, rainfall_mm: 0, humidity_pct: 76, place_kind: "growing_location", place: "Nashik, Maharashtra, India" });
    priceService.soilContext.mockResolvedValue({ status: "estimate", ph: 6.9, soil_type: "Vertisols", ph_scope: "town_centre", place_kind: "growing_location", place: "Nashik, Maharashtra, India" });
    renderAt(withState(withCharts()));
    const card = await screen.findByTestId("influence-card");
    expect(document.querySelectorAll("[data-testid=influence-card]").length).toBe(1);
    expect(document.querySelectorAll("[data-testid=factor-influence] .recharts-wrapper").length).toBe(1);
    const sections = Array.from(document.querySelectorAll("[data-testid=understand] > section"));
    expect(sections[0].textContent).toContain("A. Your Predicted Price");
    expect(sections[1]).toBe(card);
    expect(sections.length).toBe(3);   // A, the card, why these factors matter
    expect(document.body.textContent).not.toMatch(/Pushing the Price|What This Means for You|What Do These Conditions Mean|Technical details/);
    expect(card.textContent).toContain("See how season, crop, market and growing conditions contribute to the prediction.");
    expect(card.textContent).toContain("Highest target weight: Season and Crop & Selling Market — 25% each");
    await screen.findByText(/31.4 °C/, { selector: ".fi-chip-value" });
    expect(card.textContent).toContain("Vertisols");
    expect(card.textContent).toContain("Pune");
    expect(card.textContent).toContain("Nashik");
    expect(card.textContent).not.toContain("design configuration");
  });

  it("shows Unavailable instead of inventing weather and soil values", async () => {
    renderAt(withState(withCharts()));
    const card = await screen.findByTestId("influence-card");
    await screen.findAllByText(/Unavailable/, { selector: ".fi-chip-value" });
    expect(card.textContent).not.toMatch(/°C|Vertisols/);
  });

  it("explains each factor from this prediction's own data", async () => {
    priceService.weatherContext.mockResolvedValue({ status: "forecast", market: "Pune", date: "2026-11-11", temperature_c: 24.7, rainfall_mm: 0, humidity_pct: 76, place_kind: "growing_location", place: "Nashik, Maharashtra, India" });
    priceService.soilContext.mockResolvedValue({ status: "estimate", ph: 6.8, soil_type: "Vertisols", ph_scope: "town_centre", place_kind: "growing_location", place: "Nashik, Maharashtra, India" });
    renderAt(withState(withCharts()));
    const why = await screen.findByTestId("why-factors");
    await screen.findByText("24.7 °C", { selector: ".wf-value" });
    const nbsp = (x) => x.replace(/\u00a0/g, " ");
    const v = (id) => nbsp(screen.getByTestId(`wf-${id}-value`).textContent);
    expect(v("season")).toBe("11 November 2026");
    expect(v("market")).toBe("Brinjal · Pune");
    expect(v("rainfall")).toBe("0 mm");
    expect(v("humidity")).toBe("76%");
    expect(v("soil")).toBe("Vertisols (regional estimate)");
    expect(v("ph")).toBe("6.8 (regional estimate)");
    expect(v("location")).toBe("Nashik");
    expect(screen.getByTestId("wf-season").textContent).toContain("Used by the model");
    expect(screen.getByTestId("wf-temperature").textContent).toContain("Context only");
    expect(why.textContent).not.toMatch(/caused/i);
    expect(screen.queryByTestId("why-changes")).toBeNull();
  });

  it("says Not available instead of inventing values, and does not call season a model input unless the explanation confirms it", async () => {
    const r = withCharts();
    r.explanations[0].charts.local.steps = r.explanations[0].charts.local.steps.filter((s) => s.group !== "season");
    renderAt(withState(r));
    await screen.findByTestId("why-factors");
    await screen.findAllByText(/Not available/, { selector: ".wf-value" });
    expect(screen.getByTestId("wf-temperature-value").textContent).toBe("Not available");
    expect(screen.getByTestId("wf-season").textContent).toContain("Not confirmed");
  });

  it("labels weather and soil 'Used by the model' only when the API says the loaded model has those inputs", async () => {
    priceService.weatherContext.mockResolvedValue({ status: "forecast", market: "Pune", date: "2026-11-11", temperature_c: 24.7, rainfall_mm: 0, humidity_pct: 76, place: "Pune" });
    priceService.soilContext.mockResolvedValue({ status: "estimate", ph: 6.8, soil_type: "Vertisols", ph_scope: "town_centre" });
    const inputs = { season: true, crop_market: true, temperature: true, rainfall: false, humidity: false, soil_type: false, soil_ph: true, growing_location: false };
    renderAt(withState({ ...withCharts(), model_inputs: inputs }));
    await screen.findByText("24.7 °C", { selector: ".wf-value" });
    const status = (id) => screen.getByTestId(`wf-${id}`).querySelector(".wf-status").textContent;
    expect(status("temperature")).toBe("Used by the model");
    expect(status("ph")).toBe("Used by the model");
    expect(status("rainfall")).toBe("Context only");
    expect(status("humidity")).toBe("Context only");
    expect(status("soil")).toBe("Regional estimate");
    expect(status("location")).toBe("Location context");           // the growing location is never a model input
    expect(screen.getByTestId("wf-temperature").textContent).toContain("not of your growing location");
    expect(screen.getByTestId("wf-note").textContent).toContain("describe the selling market's town");
  });

  it("without model_inputs from the API nothing about weather or soil is called a model input", async () => {
    priceService.weatherContext.mockResolvedValue({ status: "forecast", market: "Pune", date: "2026-11-11", temperature_c: 24.7, rainfall_mm: 0, humidity_pct: 76, place: "Pune" });
    renderAt(withState(withCharts()));
    await screen.findByText("24.7 °C", { selector: ".wf-value" });
    for (const id of ["temperature", "rainfall", "humidity", "soil", "ph", "location"]) {
      expect(screen.getByTestId(`wf-${id}`).querySelector(".wf-status").textContent).not.toBe("Used by the model");
    }
  });

  it("shows the model's own signed contribution on the season and crop/market cards, labelled experimental for a blocked crop", async () => {
    const r = withCharts();
    r.explanations[0].charts.local.steps.push({ group: "crop_market", title: "Usual behaviour", help: "h", log_contribution: -0.02, inr: -51.4 });
    renderAt(withState({ ...r, model_inputs: { season: true, crop_market: true } }));
    await screen.findByTestId("why-factors");
    expect(screen.getByTestId("wf-season-contrib").textContent).toBe("Model contribution: +₹150 per quintal. It pushes the estimate up.");
    expect(screen.getByTestId("wf-market-contrib").textContent).toContain("−₹51 per quintal. It pulls the estimate down.");
    expect(screen.queryByTestId("wf-temperature-contrib")).toBeNull();     // no invented contribution for weather, soil or location
    expect(screen.queryByTestId("wf-location-contrib")).toBeNull();
    cleanup();
    const e = r.explanations[0];
    e.v3 = { context_only: true };
    renderAt(withState({ ...r, explanations: [e], model_inputs: { season: true, crop_market: true } }));
    await screen.findByTestId("why-factors");
    expect(screen.getByTestId("wf-season-contrib").textContent).toContain("Experimental estimate, not validated");
  });
});
