// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/priceService", () => ({ priceService: { explain: vi.fn() } }));
vi.mock("../services/historyService", () => ({ historyService: { priceItem: vi.fn() } }));
vi.mock("../services/api", () => ({ errorMessage: (e) => e.message }));

import { historyService } from "../services/historyService";
import { priceService } from "../services/priceService";
import PriceExplanation from "./PriceExplanation";
import { mainFactors, matchesRequest, reliabilityView } from "../utils/explanationView";

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

beforeEach(() => { priceService.explain.mockReset(); historyService.priceItem.mockReset(); });
afterEach(cleanup);

describe("PriceExplanation page", () => {
  it("shows the passed explanation without calling the model again", () => {
    renderAt(withState());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Why is this price expected to rise or fall?");
    expect(screen.getByText(/The model expects Brinjal prices to rise from ₹2,625 to ₹2,888/)).toBeTruthy();
    expect(screen.getAllByText(/Title season/).length).toBeGreaterThan(0);
    expect(priceService.explain).not.toHaveBeenCalled();
  });

  it("shows up to three reasons with title, direction, one evidence sentence and one meaning sentence", () => {
    renderAt(withState());
    const main = screen.getByRole("heading", { name: "Main reasons behind this prediction" }).closest("section");
    const cards = main.querySelectorAll("li.factor-card");
    expect(cards).toHaveLength(3);
    expect(cards[0].textContent).toContain("Title season");
    expect(cards[0].textContent).toContain("Pushing the forecast higher");
    expect(cards[0].textContent).toContain("evidence season. meaning season.");
    expect(cards[1].textContent).toContain("Pushing the forecast lower");
    expect(main.textContent).not.toMatch(/moderate|strong effect|small effect|log|SHAP|contribution/i);
  });

  it("combines the reasons in 'What this means for you' and states what data the forecast is based on", () => {
    renderAt(withState());
    const means = screen.getByRole("heading", { name: "What this means for you" }).closest("section");
    expect(means.textContent).toContain("The forecast is higher mainly because of the seasonal pattern in earlier years.");
    expect(screen.getByText(/No live market feed is connected/)).toBeTruthy();
    expect(screen.getByText(/median across Maharashtra markets/)).toBeTruthy();
  });

  it("leaves out 'What this means' when the backend gave no summary, and notes when fewer than three reasons exist", () => {
    renderAt(withState(response({ explanations: [exp({ what_it_means: null, reasons: exp().reasons.slice(0, 1) })] })));
    expect(screen.queryByRole("heading", { name: "What this means for you" })).toBeNull();
    expect(screen.getByText(/Only 1 reason\(s\) had both a clear model contribution/)).toBeTruthy();
  });

  it("says so when no reason has supporting evidence, instead of filling cards", () => {
    renderAt(withState(response({ explanations: [exp({ reasons: [], what_it_means: null })] })));
    expect(screen.getByText(/did not give enough supporting evidence/)).toBeTruthy();
    expect(document.querySelector("li.factor-card")).toBeNull();
  });

  it("falls back to a short statement when the breakdown cannot be trusted", () => {
    const e = exp(); e.technical = { ...e.technical, reconstruction_ok: false };
    renderAt(withState(response({ explanations: [e] })));
    expect(screen.getByText("The main model factors could not be explained reliably for this prediction.")).toBeTruthy();
    expect(document.querySelector("li.factor-card")).toBeNull();
  });

  it("keeps technical diagnostics out of the farmer-facing view", () => {
    renderAt(withState());
    const farmer = document.body.cloneNode(true);
    farmer.querySelector("[data-testid=expl-advanced]")?.remove();
    expect(farmer.textContent).not.toMatch(/log_price|doy_sin|commodity_code|market_code|TreeExplainer|Base value|XGBoost|Random Forest/);
  });

  it("drops the long sections: market table, limitations list and small-factor list", () => {
    renderAt(withState());
    for (const h of ["Limits of this forecast", "Factors pointing the forecast higher", "Factors pointing the forecast lower"]) {
      expect(screen.queryByRole("heading", { name: h })).toBeNull();
    }
    expect(screen.queryByText(/Factors with a small effect/)).toBeNull();
    expect(document.querySelector("table.xai-table")?.closest("details")).toBe(screen.getByTestId("expl-advanced"));   // tables live only in the collapsed technical area
  });

  it("shows the predicted price block and a one-sentence summary from the forecast's own numbers", () => {
    renderAt(withState());
    const box = screen.getByRole("heading", { name: "Predicted price" }).closest("section");
    expect(box.textContent).toContain("₹2,625");
    expect(box.textContent).toContain("₹2,888");
    expect(box.textContent).toContain("+₹263 (+10%)");
    expect(screen.getByText("The model expects Brinjal prices to rise from ₹2,625 to ₹2,888 per quintal by 11 November 2026.")).toBeTruthy();
    expect(screen.getByText("Forecasts are estimates; actual market prices may differ.")).toBeTruthy();
  });

  it("uses fall and stable wording", () => {
    const fall = { ...exp().summary, reference_price: 2888, predicted_price: 2625, change_abs: -263, change_pct: -9.1, direction: "lower" };
    renderAt(withState(response({ explanations: [exp({ summary: fall })] })));
    expect(screen.getByText(/prices to fall from ₹2,888 to ₹2,625 per quintal/)).toBeTruthy();
    cleanup();
    const flat = { ...exp().summary, predicted_price: 2630, change_abs: 5, change_pct: 0.2, direction: "about the same" };
    renderAt(withState(response({ explanations: [exp({ summary: flat })] })));
    expect(screen.getByText(/prices to remain relatively stable/)).toBeTruthy();
  });

  it("reads the expected change against the typical error, and the message follows the numbers", () => {
    renderAt(withState());   // change ₹263 < typical error ₹300
    expect(screen.getByText(/average absolute error of about ₹300 per quintal. The expected increase of ₹263 is smaller than that error, so the actual price could stay close/)).toBeTruthy();
    cleanup();
    renderAt(withState(response({ explanations: [exp({ summary: { ...exp().summary, change_abs: 900 } })] })));
    expect(screen.getByText(/is larger than that error/)).toBeTruthy();
    expect(screen.queryByText(/could stay close/)).toBeNull();
  });

  it("uses the real evaluation numbers and says so when test data is insufficient", () => {
    const r = response({ explanations: [exp({ reliability: { basis: "b", model_mae: 300, baseline_mae: 350, beats_no_change: true, n_tests: 20, sufficient_data: false } })] });
    renderAt(withState(r));
    expect(screen.queryByText(/average absolute error/)).toBeNull();   // too few tests: no error figure is claimed
    expect(screen.getByText(/Not enough historical test results/)).toBeTruthy();
  });

  it("does not invent reliability figures that do not exist", () => {
    renderAt(withState(response({ explanations: [exp({ reliability: null })] })));
    expect(screen.getByText(/No held-out evaluation results/)).toBeTruthy();
    expect(screen.queryByText(/average absolute error/)).toBeNull();
  });

  it("keeps material data-quality warnings", () => {
    const r = response({ explanations: [exp({ projected: true, data_completeness: { basis: "b", inputs_total: 10, inputs_missing: 2, missing: ["a", "b"] } })] });
    renderAt(withState(r));
    expect(screen.getByText(/after the latest price data/)).toBeTruthy();
    expect(screen.getByText(/2 of 10 inputs were not available/)).toBeTruthy();
  });

  it("technical details start collapsed and show the reconstruction check", () => {
    renderAt(withState());
    const d = screen.getByTestId("expl-advanced");
    expect(d.open).toBe(false);
    d.open = true;
    expect(d.open).toBe(true);
    expect(d.textContent).toContain("Passed");
    expect(d.textContent).toContain("log_price");
    d.open = false;
    expect(d.open).toBe(false);
  });

  it("with no state and no id shows a fallback and never fetches", () => {
    renderAt("/price-prediction/explanation");
    expect(screen.getByText("No prediction to explain")).toBeTruthy();
    expect(priceService.explain).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Go to price prediction" }).getAttribute("href")).toBe("/price-prediction");
  });

  it("loads a saved prediction by id and fetches its explanation", async () => {
    historyService.priceItem.mockResolvedValue({ state: "Maharashtra", market: "Pune", commodity: "Brinjal", variety: null, input_date: "2026-10-16", horizon_days: 26 });
    priceService.explain.mockResolvedValue(response());
    renderAt("/price-prediction/explanation?id=7");
    await waitFor(() => expect(screen.getByText(/Title season/)).toBeTruthy());
    expect(priceService.explain.mock.calls[0][0]).toMatchObject({ commodity: "Brinjal", target_date: "2026-11-11", as_of: "2026-10-16" });
  });

  it("refuses an explanation for a different crop (no stale data)", async () => {
    priceService.explain.mockResolvedValue(response({ series: { commodity: "Onion", market: "Pune", state: "Maharashtra" } }));
    renderAt({ pathname: "/price-prediction/explanation", state: { req } });
    await waitFor(() => expect(screen.getByText(/does not match this prediction/)).toBeTruthy());
    expect(screen.queryByText(/Title season/)).toBeNull();
  });

  it("shows an error with a way back when the request fails", async () => {
    priceService.explain.mockRejectedValue(new Error("boom"));
    renderAt({ pathname: "/price-prediction/explanation", state: { req } });
    await waitFor(() => expect(screen.getByText("boom")).toBeTruthy());
    expect(screen.getByRole("link", { name: "Go to price prediction" })).toBeTruthy();
  });

  it("back button returns to the result page when there is no earlier history entry", () => {
    renderAt(withState());
    fireEvent.click(screen.getByRole("button", { name: /Back to prediction results/ }));
    expect(screen.getByText("result page")).toBeTruthy();
  });
});

describe("explanationView", () => {
  it("matchesRequest compares crop and target date", () => {
    expect(matchesRequest(req, response())).toBe(true);
    expect(matchesRequest({ ...req, target_date: "2026-12-01" }, response())).toBe(false);
    expect(matchesRequest(null, response())).toBe(false);
  });
  it("mainFactors follows the backend's top picks and never exceeds three", () => {
    expect(mainFactors(exp()).map((f) => f.factor)).toEqual(["season", "arrivals", "averages"]);
    expect(mainFactors(exp({ main_factors: undefined })).map((f) => f.factor)).toEqual(["season", "arrivals", "averages"]);
  });
  it("mainFactors skips a factor that has no evidence", () => {
    const e = exp(); e.factors[0].evidence_available = false;
    expect(mainFactors(e).map((f) => f.factor)).toEqual(["arrivals", "averages"]);
  });
  it("reliabilityView only claims an error figure with enough tests", () => {
    expect(reliabilityView(exp()).mae).toBe(300);
    expect(reliabilityView(exp({ reliability: { model_mae: 300, baseline_mae: 350, beats_no_change: true, n_tests: 5, sufficient_data: false } })).mae).toBeNull();
  });
});
