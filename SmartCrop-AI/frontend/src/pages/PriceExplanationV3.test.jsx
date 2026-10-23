// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/priceService", () => ({ priceService: { explain: vi.fn() } }));
vi.mock("../services/historyService", () => ({ historyService: { priceItem: vi.fn() } }));
vi.mock("../services/api", () => ({ errorMessage: (e) => e.message }));

import { priceService } from "../services/priceService";
import PriceExplanation from "./PriceExplanation";

const card = (group, inr, evidence, flag = "agree", extra = {}) => ({
  group, title: group, direction: inr >= 0 ? "up" : "down", inr_effect: inr, inr_effect_rounded: Math.round(inr / 10) * 10,
  evidence, evidence_available: true, mechanism: null, agreement: { flag, text: `agreement ${group}` }, ...extra,
});
const v3 = (over = {}) => ({
  schema_version: 3,
  banner: { text: "No 2026 market data yet — this forecast replays the same season of 2025.", detail: "The starting price is the 23 Oct 2025 price plus 5% for a year's inflation." },
  headline: { code: "rise", text: "The model expects Tomato to rise by about ₹120 per quintal (+5.0%) by 4 Nov 2026.", predicted_price: 2520, start_price: 2400,
    change_inr: 120, change_pct: 5, typical_miss_inr: 80, range: [2100, 2900], target_date: "2026-11-04", horizon_days: 12, band: "8-14" },
  cards: [
    card("supply", -120, "Reported arrivals at APMC Pune, 24 Sep–23 Oct 2025: 412 a day (as reported), 35% above the October average of 2023 and 2024 (305 a day).", "agree",
      { mechanism: "More supply usually lowers prices." }),
    card("market", 410, "APMC Pune's price averaged 28% above the Maharashtra median for Tomato over 27 Jul–23 Oct 2025 (₹2,096 vs ₹1,637, 71 reporting days).", "no_reading"),
    card("trend", 80, "Price on 23 Oct 2025: ₹2,000; +33% since 23 Sep 2025 (30 days).", "disagree"),
  ],
  other_factors: { inr_total: -30, inr_total_rounded: -30, text: "Other factors: −₹30", parts: [{ label: "Current price level", inr: -41.4, meaning: null }], swing_evidence: null, note: "n" },
  evidence_not_used_by_model: [{ group: "last_year", title: "Compared with last year", evidence: "Price on 23 Oct 2025: ₹2,000, 26% lower than on 23 Oct 2024 (₹2,700).", note: "n" }],
  market_breakdown: { applicable: true, text: "At the median Maharashtra market: ₹2,110. APMC Pune premium: +₹410 (forecasts for 4 Nov 2026).", evidence: "APMC Pune traded 28% above the Maharashtra median over 27 Jul–23 Oct 2025." },
  trust: { lines: ["In 3,100 backtest forecasts for Tomato, 8-14 days ahead, the average miss was about ₹470 per quintal (19%)."], warnings: ["The range was too narrow in past tests."] },
  checks: { inr_sum: 120, predicted_change_inr: 120, reconstruction_error: 1e-7 },
  ...over,
});
const exp = (over = {}) => ({
  horizon_days: 12, date: "2026-11-04", method: "SHAP", output_space: "log", base_value: 0, base_change_pct: 0, prediction_change_pct: 5, all_small: false,
  summary: { reference_price: 2400, predicted_price: 2520, change_abs: 120, change_pct: 5, direction: "higher", horizon_days: 12, within_typical_error: false, typical_error_pct: null, headline: "h" },
  farmer_explanation: [], factors: [], higher_factors: [], lower_factors: [], reasons: [], data_completeness: { basis: "b", inputs_total: 1, inputs_missing: 0, missing: [] },
  data_limitations: [], weather: { status: "not_used", used: false }, strength_basis: "x", projected: true,
  technical: { model_output_log: 0.05, sum_of_contributions_log: 0.05, features: {}, feature_values: {}, reconstruction_ok: true, reconstruction_error: 0, reconstruction_tolerance: 0.001, grouped: {}, note: "n" },
  v3: v3(), ...over,
});
const req = { state: "Maharashtra", market: "APMC Pune", commodity: "Tomato", target_date: "2026-11-04", as_of: "2026-10-23" };
const response = (e = exp(), over = {}) => ({ series: { commodity: "Tomato", market: "APMC Pune", state: "Maharashtra" }, forecast_origin_date: "2026-10-23",
  target_date: "2026-11-04", current_price: 2400, projection: { reference_origin_date: "2025-10-23", reference_price: 2286, years_ahead: 1, inflation_annual_pct: 5, price_level_factor: 1.05 },
  model: { version: "v1", algorithm: "XGBoost" }, explanations: [e], ...over });
const renderPage = (r = response()) => render(
  <MemoryRouter initialEntries={[{ pathname: "/price-prediction/explanation", state: { req, explain: r } }]}>
    <Routes><Route path="/price-prediction/explanation" element={<PriceExplanation />} /></Routes>
  </MemoryRouter>);

beforeEach(() => priceService.explain.mockReset());
afterEach(cleanup);

describe("evidence-first explanation page", () => {
  it("shows the no-2026-data banner with the real reference year, and labels the starting price as an estimate", () => {
    renderPage();
    expect(screen.getByText(/No 2026 market data yet — this forecast replays the same season of 2025/)).toBeTruthy();
    const box = screen.getByTestId("v3-verdict");
    expect(box.textContent).toContain("Estimated starting price");
    expect(box.textContent).toContain("based on 23 Oct 2025 records + inflation");
    expect(box.textContent).not.toMatch(/projected for|Same time last year/i);
  });

  it("shows the verdict, price, range and the headline text from the backend", () => {
    renderPage();
    const box = screen.getByTestId("v3-verdict");
    expect(box.textContent).toContain("₹2,520");
    expect(box.textContent).toContain("₹2,100 – ₹2,900");
    expect(screen.getByTestId("v3-headline").textContent).toContain("rise by about ₹120");
  });

  it("shows reason cards with ₹ effect, dated evidence, mechanism and the agreement flag", () => {
    renderPage();
    const supply = screen.getByTestId("reason-supply");
    expect(supply.textContent).toContain("Pushed the forecast down by about ₹120");
    expect(supply.textContent).toContain("24 Sep–23 Oct 2025");
    expect(supply.textContent).toContain("More supply usually lowers prices.");
    expect(supply.textContent).toContain("Agree");
    expect(screen.getByTestId("reason-trend").textContent).toContain("Disagree");
    expect(screen.getByTestId("reason-market").textContent).toContain("For information");
    expect(screen.getByTestId("reason-market").textContent).not.toContain("What usually follows");   // no mechanism without support
  });

  it("always shows the other-factors line with its ₹ share", () => {
    renderPage();
    expect(screen.getByTestId("v3-other").textContent).toContain("Other factors: −₹30");
  });

  it("lists evidence the model does not use separately, still dated", () => {
    renderPage();
    const d = screen.getByTestId("v3-unused");
    expect(d.textContent).toContain("23 Oct 2024");
    expect(d.textContent).toMatch(/Measured, but not used/);
  });

  it("shows the market breakdown and the trust block with case counts and warnings", () => {
    renderPage();
    expect(screen.getByTestId("v3-market").textContent).toContain("At the median Maharashtra market: ₹2,110. APMC Pune premium: +₹410");
    const trust = screen.getByTestId("v3-trust");
    expect(trust.textContent).toContain("3,100 backtest forecasts");
    expect(trust.textContent).toContain("The range was too narrow");
  });

  it("with a 'no clear direction' verdict the page does not claim a rise or fall", () => {
    const e = exp({ v3: v3({ headline: { ...v3().headline, code: "no_clear_direction", text: "No clear direction for Tomato by 4 Nov 2026: in backtests the model did not beat “price stays unchanged”." } }) });
    renderPage(response(e));
    const h = screen.getByTestId("v3-headline").textContent;
    expect(h).toContain("No clear direction");
    expect(h).not.toMatch(/rise by|fall by/);
  });

  it("without a projection banner nothing is labelled as an estimate from last year", () => {
    const e = exp({ v3: v3({ banner: null }), projected: false });
    renderPage(response(e, { projection: null }));
    expect(screen.queryByText(/replays the same season/)).toBeNull();
    expect(screen.getByTestId("v3-verdict").textContent).toContain("Latest market price");
  });

  it("for a no-change crop shows 'no clear direction' and dated records with no rupee effects, agreement flags or other-factors box", () => {
    const ctxCard = (group, evidence) => ({ group, title: group, direction: null, inr_effect: null, inr_effect_rounded: null, evidence, evidence_available: true,
      mechanism: null, agreement: { flag: "context", text: "context" }, effect_text: "Shown as context." });
    const e = exp({ v3: v3({
      context_only: true, other_factors: null, evidence_not_used_by_model: [],
      headline: { ...v3().headline, code: "no_clear_direction", predicted_price: null, change_inr: null, change_pct: null,
        text: "No clear direction for Tomato by 4 Nov 2026. In validation tests the model did not beat keeping the latest price for Tomato. The records below are context only." },
      cards: [ctxCard("supply", "Reported arrivals at APMC Pune, 24 Sep–23 Oct 2025: 56 a day (as reported)."),
        ctxCard("trend", "Price on 23 Oct 2025: ₹2,000; +33% since 23 Sep 2025 (30 days)."),
        ctxCard("last_year", "Price on 23 Oct 2025: ₹2,000, 26% lower than on 23 Oct 2024 (₹2,700).")],
      checks: { inr_sum: null, predicted_change_inr: null, reconstruction_error: null } }) });
    renderPage(response(e));
    expect(screen.getByTestId("v3-headline").textContent).toContain("No clear direction");
    const box = screen.getByTestId("v3-verdict").textContent;
    expect(box).not.toContain("Expected selling price");
    expect(box).not.toContain("Expected change");
    expect(screen.getByRole("heading", { name: "What the records show" })).toBeTruthy();
    for (const g of ["supply", "trend", "last_year"]) {
      const c = screen.getByTestId(`reason-${g}`).textContent;
      expect(c).toContain("Context only");
      expect(c).not.toMatch(/Pushed the forecast|Records vs model|Agree|Disagree/);
      expect(c).toMatch(/2025/);
    }
    expect(screen.queryByTestId("v3-other")).toBeNull();
  });

  it("falls back to a short statement when the breakdown does not reconstruct the model output", () => {
    const e = exp({ v3: v3({ checks: { inr_sum: 120, predicted_change_inr: 120, reconstruction_error: 0.5 } }) });
    renderPage(response(e));
    expect(screen.getByText("The main model factors could not be explained reliably for this prediction.")).toBeTruthy();
    expect(screen.queryByTestId("reason-supply")).toBeNull();
  });

  it("keeps the previous layout for saved responses that have no v3 block", () => {
    renderPage(response(exp({ v3: undefined })));
    expect(screen.queryByTestId("v3-verdict")).toBeNull();
    expect(screen.getByRole("heading", { name: "Predicted price" })).toBeTruthy();
  });
});

describe("explanation page range line", () => {
  const withRange = (h) => response(exp({ v3: v3({ headline: { ...v3().headline, ...h } }) }));

  it("labels the range by its measured coverage, never as 'likely'", () => {
    renderPage(withRange({ range: [2100, 2900], range_coverage_pct: 46.2, range_hidden: false }));
    const r = screen.getByTestId("v3-range").textContent;
    expect(r).toContain("₹2,100 – ₹2,900");
    expect(r).toContain("The real price fell in this range in about 46% of past tests.");
    expect(document.body.textContent).not.toMatch(/likely range/i);
  });

  it("says the range is not shown when its coverage was too low", () => {
    renderPage(withRange({ range: null, range_coverage_pct: 3, range_hidden: true }));
    expect(screen.getByTestId("v3-range-hidden").textContent).toBe("Range not shown — in testing the real price rarely fell inside it");
    expect(screen.queryByTestId("v3-range")).toBeNull();
  });
});

describe("verdict wording matches the result page", () => {
  const sameHeadline = { code: "about_the_same", text: "About the same as the starting price (₹2,100). The model's estimate is ₹2,150 per quintal, a difference of ₹50, which is smaller than its typical miss in backtests (about ₹300 per quintal at this distance), so no rise or fall is claimed.",
    predicted_price: 2150, start_price: 2100, change_inr: 50, change_pct: 2.38, typical_miss_inr: 300, range: null, target_date: "2026-11-04", horizon_days: 18, band: "15-30",
    horizon: { days_from_today: 12, counted_from: "2025-10-17", covers_days: 18, differs: true } };

  it("shows the same bold line and secondary line as the result page for 'about the same'", () => {
    renderPage(response(exp({ v3: v3({ headline: sameHeadline }) })));
    expect(screen.getByTestId("v3-headline").textContent).toBe("About the same as the starting price (₹2,100)");
    expect(screen.getByTestId("v3-headline-sub").textContent).toContain("Model estimate ₹2,150");
    expect(screen.getByTestId("v3-horizon").textContent).toBe(
      "12 days from today · counts from this market's last report (17 Oct 2025), so the estimate covers 18 days");
  });

  it("shows the one latest recorded price sentence for context-only cells, not the estimated starting price", () => {
    const lr = { price: 4250, date: "2025-12-31", age_days: 296, stale: true, age_n: 10, age_unit: "months" };
    renderPage(response(exp({ v3: v3({ context_only: true, context_reason: "Reason.", cards: [], other_factors: null,
      headline: { code: "no_clear_direction", text: "x", predicted_price: null, start_price: 1890, change_inr: null, change_pct: null, typical_miss_inr: 935, range: null,
        target_date: "2026-11-04", horizon_days: 18, band: "15-30", latest_recorded: lr } }) })));
    const box = screen.getByTestId("v3-verdict").textContent;
    expect(screen.getByTestId("v3-headline").textContent).toBe("Latest recorded price: ₹4,250 (31 Dec 2025, 10 months ago). No forecast for this crop.");
    expect(box).not.toContain("₹1,890");
    expect(box).not.toContain("Estimated starting price");
  });
});
