// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/priceService", () => ({ priceService: { trend: vi.fn(), explain: vi.fn() } }));
vi.mock("../services/historyService", () => ({ historyService: { priceItem: vi.fn() } }));
vi.mock("../services/api", () => ({ errorMessage: (e) => e.message }));
// the chart is tested elsewhere; here only the props the page passes matter
vi.mock("../components/charts/PriceTrendChart", () => ({
  default: (p) => <div data-testid="chart" data-show-range={String(p.showRange)} data-range-pct={String(p.rangePct)} />,
}));

import { priceService } from "../services/priceService";
import PriceResult from "./PriceResult";

const storage = { crop: "Tomato", category: "Highly perishable", max_hold_days: 7, farm_hold_days: 7, note: "Ripe tomatoes keep about a week." };
const advice = (over = {}) => ({
  code: "SELL_ON_TARGET", label: "Sell on your planned date", recommended_date: "2026-11-04", recommended_horizon_days: 12, recommended_price: 2520,
  recommended_low: 2100, recommended_high: 2900, target_date: "2026-11-04", target_price: 2520, target_low: 2100, target_high: 2900, extra_per_quintal: 0, extra_pct: 0,
  wait_days: 0, typical_error_pct: 12, explanation: "Your planned date has the best predicted price.", reason: "Check current mandi prices.", falls_after_target: false,
  needs_special_storage: false, best_before: null, best_after: null, alternative: null, beyond_storage: null, farm_option: null, peak: null, storage,
  considerations: [], disclaimer: "d", ...over,
});
const forecast = (over = {}) => ({
  series: { state: "Maharashtra", market: "APMC Mumbai", commodity: "Tomato", variety: "Other" },
  input_date: "2026-10-23", forecast_origin_date: "2026-10-23", target_date: "2026-11-04", target_horizon_days: 12, current_price: 2100, arrivals_used: 50,
  target: { horizon_days: 12, date: "2026-11-04", predicted_price: 2520, lower: 2100, upper: 2900, change_pct: 20, stable_band_pct: 10, direction: "Increasing",
    actual_price: null, beats_baseline: true, model_mae: 300, baseline_mae: 350 },
  path: [], last_validated_days: 12, validated_days: 12, max_horizon_days: 60, advice: advice(), history: [], history_is_reference: true, actual_after_origin: [],
  model: { version: "v", algorithm: "XGBoost", approach: "a", data_end: "2025-12-31" },
  projection: { reference_origin_date: "2025-10-23", reference_price: 2000, years_ahead: 1, inflation_annual_pct: 5, price_level_factor: 1.05 },
  source: { kind: "market", method: "trained_model", requested_market: "APMC Mumbai", requested_variety: "Other", used_market: "APMC Mumbai", used_variety: "Other",
    data_age_days: 0, fallback: false, observations: 800 },
  dates: { forecast_start: "2026-10-23", target_date: "2026-11-04", reference_date: "2025-10-23", origin_observation_date: "2025-10-23", latest_data_date: "2025-12-31", years_shifted: 1 },
  disclaimer: "d", policy: { mode: "model", band: "8-14", reasons: ["ok"] },
  range_info: { coverage_pct: 82.4, n: 4200, scope: "projection", min_coverage_to_show_pct: 40, shown: true, typical_miss_inr: 300 },
  latest_recorded: { price: 1950, date: "2025-12-31", age_days: 296, stale: true, age_n: 10, age_unit: "months" }, ...over,
});
const req = { state: "Maharashtra", market: "APMC Mumbai", commodity: "Tomato", target_date: "2026-11-04", as_of: "2026-10-23" };
const renderPage = (f) => render(
  <MemoryRouter initialEntries={[{ pathname: "/price-prediction/result", state: { req, prediction: f } }]}>
    <Routes><Route path="/price-prediction/result" element={<PriceResult />} /></Routes>
  </MemoryRouter>);

beforeEach(() => { priceService.explain.mockReset(); priceService.explain.mockResolvedValue(null); });
afterEach(cleanup);

describe("result page for context-only cells", () => {
  const ctx = () => forecast({ policy: { mode: "context_only", band: "8-14", reasons: ["no"] }, advice: advice({
    code: "UNAVAILABLE", label: "Reliable comparison unavailable", target_price: null, recommended_price: null, recommended_low: null, recommended_high: null,
    target_low: null, target_high: null, peak: null, explanation: "For Tomato, the model is not used to predict a rise or fall this far ahead.", reason: "Check current mandi prices before deciding." }) });

  it("says 'Latest recorded price: ₹X (date, N months ago). No forecast for this crop.' and shows no model price or change", () => {
    renderPage(ctx());
    const box = screen.getByTestId("no-direction").textContent;
    expect(box).toContain("Latest recorded price: ₹1,950 (31 Dec 2025, 10 months ago). No forecast for this crop.");
    expect(document.body.textContent).not.toContain("₹2,520");            // the model's price
    expect(document.body.textContent).not.toMatch(/Expected change|Likely range|likely range/);
    expect(screen.queryByTestId("range-line")).toBeNull();
    expect(box).toContain("In testing, estimates like this missed by about ₹300 per quintal");
    expect(document.body.textContent).toContain("Your selling date 4 Nov 2026");
    expect(document.body.textContent).not.toContain("Expected market price on");     // no price is expected in a no-direction cell
  });

  it("replaces the forecast chart and the selling comparison by plain statements without prices", () => {
    renderPage(ctx());
    expect(screen.queryByTestId("chart")).toBeNull();
    expect(screen.getByTestId("no-forecast-line").textContent).toContain("No forecast line is drawn");
    const sell = screen.getByTestId("sell-context-only").textContent;
    expect(sell).toContain("the model is not used to predict a rise or fall");
    expect(sell).not.toMatch(/₹\d/);
  });

  it("does not show the estimated starting price next to the recorded one", () => {
    renderPage(ctx());
    expect(document.body.textContent).not.toContain("Estimated starting price");
  });

  it("falls back to a plain statement when the series has no recorded price", () => {
    renderPage({ ...ctx(), latest_recorded: null });
    expect(screen.getByTestId("no-direction").textContent).toContain("No clear direction for this crop and distance.");
  });
});

describe("result page range line", () => {
  it("labels the range by its measured coverage and never calls it 'likely'", () => {
    renderPage(forecast());
    const line = screen.getByTestId("range-line").textContent;
    expect(line).toContain("Range ₹2,100 – ₹2,900");
    expect(line).toContain("the real price fell in this range in about 82% of past tests");
    expect(document.body.textContent).not.toMatch(/likely range/i);
    expect(screen.getByTestId("chart").getAttribute("data-show-range")).toBe("true");
    expect(screen.getByTestId("chart").getAttribute("data-range-pct")).toBe("82");
  });

  it("hides the range when measured coverage is below 40%", () => {
    renderPage(forecast({ range_info: { coverage_pct: 3, n: 900, scope: "projection", min_coverage_to_show_pct: 40, shown: false, typical_miss_inr: 300 } }));
    const line = screen.getByTestId("range-line").textContent;
    expect(line).toBe("Range not shown — in testing the real price rarely fell inside it");
    expect(line).not.toMatch(/₹2,100|₹2,900/);
    expect(screen.getByTestId("chart").getAttribute("data-show-range")).toBe("false");
  });

  it("shows the range from exactly 40% and says so when coverage was never measured", () => {
    renderPage(forecast({ range_info: { coverage_pct: 40, n: 900, scope: "projection", min_coverage_to_show_pct: 40, shown: true, typical_miss_inr: 300 } }));
    expect(screen.getByTestId("range-line").textContent).toContain("in about 40% of past tests");
    cleanup();
    renderPage(forecast({ range_info: null }));
    expect(screen.getByTestId("range-line").textContent).toContain("has not been measured");
  });
});

describe("starting price label", () => {
  it("is an estimate dated by its real reference year when the forecast replays an earlier season", () => {
    renderPage(forecast());
    expect(document.body.textContent).toContain("Estimated starting price");
    expect(document.body.textContent).toContain("based on 23 Oct 2025 records + inflation");
    expect(document.body.textContent).not.toMatch(/projected for/i);
  });

  it("is the latest market price when the forecast starts from current records", () => {
    renderPage(forecast({ projection: null }));
    expect(document.body.textContent).toContain("Latest market price");
    expect(document.body.textContent).toContain("reported 23 Oct 2026");
  });

  it("shows the freshness-gate note when a stale market was replaced", () => {
    renderPage(forecast({ source: { ...forecast().source, note: "The latest price for APMC Mumbai is 46 days old, so the latest Maharashtra median price is used instead." } }));
    expect(screen.getByText(/46 days old/)).toBeTruthy();
  });
});

describe("result page headline when the change is below the typical miss", () => {
  const same = () => forecast({ verdict: { code: "about_the_same", start_price: 2100, model_estimate: 2150, change_inr: 50, change_pct: 2.38, typical_miss_inr: 300 } });

  it("says 'About the same as the starting price (₹X)' with the model estimate as secondary text", () => {
    renderPage(same());
    const box = screen.getByTestId("about-same").textContent;
    expect(box).toContain("About the same as the starting price (₹2,100)");
    expect(box).toContain("Model estimate ₹2,150");
    expect(document.body.textContent).not.toContain("Expected market price on");
    expect(screen.queryByTestId("range-line")).toBeNull();
  });

  it("keeps the model price as the headline for a rise or fall", () => {
    renderPage(forecast({ verdict: { code: "rise", start_price: 2100, model_estimate: 2520, change_inr: 420, change_pct: 20, typical_miss_inr: 300 } }));
    expect(screen.queryByTestId("about-same")).toBeNull();
    expect(document.body.textContent).toContain("₹2,520");
  });
});

describe("days ahead", () => {
  it("says what the horizon counts from when it differs from the days asked for", () => {
    renderPage(forecast({ horizon: { days_from_today: 12, counted_from: "2025-10-17", covers_days: 18, differs: true } }));
    expect(screen.getByTestId("horizon").textContent).toBe(
      "12 days from today · counts from this market's last report (17 Oct 2025), so the estimate covers 18 days");
  });

  it("is just the days from today when nothing differs", () => {
    renderPage(forecast({ horizon: { days_from_today: 12, counted_from: "2026-10-23", covers_days: 12, differs: false } }));
    expect(screen.getByTestId("horizon").textContent).toBe("12 days from today");
  });
});
