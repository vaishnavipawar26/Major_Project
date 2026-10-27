// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/priceService", () => ({ priceService: { trend: vi.fn(), explain: vi.fn() } }));
vi.mock("../services/historyService", () => ({ historyService: { priceItem: vi.fn() } }));
vi.mock("../services/api", () => ({ errorMessage: (e) => e.message }));
// the chart is tested in its own file; here only the props the page passes matter
vi.mock("../components/charts/PriceTrendChart", () => ({
  default: (p) => <div data-testid="chart" data-forecast={String(p.forecast)} data-path={String(p.chartPath.length)} data-rows={String(p.referenceRows.length)}
    data-selected={String(p.selected?.price)} data-end={p.chartEnd} data-caption={p.caption} />,
}));

import { priceService } from "../services/priceService";
import PriceResult from "./PriceResult";

const day = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const run = (n) => Array.from({ length: n }, (_, i) => i);
const TODAY = "2026-10-23", PLANNED = "2026-11-04";
const storage = (over = {}) => ({ crop: "Tomato", category: "Storable", max_hold_days: 60, farm_hold_days: 60, note: "Ripe tomatoes keep about a week.", ...over });
const advice = (over = {}) => ({ code: "SELL_ON_TARGET", label: "x", target_date: PLANNED, storage: storage(), ...over });
// predicted price by date: planned date 2520; any other date from `price(date)`
const chartPath = (price) => run(30).map((i) => {
  const date = day(TODAY, i + 1);
  return { horizon_days: i + 1, date, predicted_price: date === PLANNED ? 2520 : price(date), lower: 2100, upper: 2900, beats_baseline: true, model_mae: 300, baseline_mae: 350 };
});
const flat = () => 2400;
const forecast = (over = {}) => ({
  series: { state: "Maharashtra", market: "APMC Mumbai", commodity: "Tomato", variety: "Other" },
  input_date: TODAY, forecast_origin_date: TODAY, target_date: PLANNED, target_horizon_days: 12, current_price: 2100, arrivals_used: 50,
  target: { horizon_days: 12, date: PLANNED, predicted_price: 2520, lower: 2100, upper: 2900, change_pct: 20, stable_band_pct: 10, direction: "Increasing",
    actual_price: null, beats_baseline: true, model_mae: 300, baseline_mae: 350 },
  path: [], chart_path: chartPath(flat), chart_end_date: day(PLANNED, 14), last_validated_days: 12, validated_days: 12, max_horizon_days: 60,
  advice: advice(), history: [], history_is_reference: true, reference_after: [], actual_after_origin: [], earlier_years: [],
  model: { version: "v", algorithm: "XGBoost", approach: "a", data_end: "2025-12-31" },
  projection: { reference_origin_date: "2025-10-23", reference_price: 2000, years_ahead: 1, inflation_annual_pct: 5, price_level_factor: 1.05 },
  source: { kind: "market", method: "trained_model", fallback: false },
  dates: { forecast_start: TODAY, target_date: PLANNED, reference_date: "2025-10-23", origin_observation_date: "2025-10-23", latest_data_date: "2025-12-31", years_shifted: 1 },
  disclaimer: "d", policy: { mode: "model", band: "8-14", reasons: ["ok"] },
  range_info: { coverage_pct: 82.4, n: 4200, scope: "projection", min_coverage_to_show_pct: 40, shown: true, typical_miss_inr: 300 },
  latest_recorded: { price: 1950, date: "2025-12-31", age_days: 296, stale: true, age_n: 10, age_unit: "months" }, ...over,
});
// blocked crop: last year's prices from the start date on, 2000 on the planned date
const blocked = (over = {}) => forecast({
  policy: { mode: "context_only", band: "8-14", reasons: ["no"] },
  reference_after: run(30).map((i) => ({ date: day(TODAY, i + 1), price: 1900 + i * 8 + (day(TODAY, i + 1) === PLANNED ? 0 : 0) })), ...over,
});
const req = { state: "Maharashtra", market: "APMC Mumbai", commodity: "Tomato", target_date: PLANNED, as_of: TODAY };
const renderPage = (f) => render(
  <MemoryRouter initialEntries={[{ pathname: "/price-prediction/result", state: { req, prediction: f } }]}>
    <Routes><Route path="/price-prediction/result" element={<PriceResult />} /></Routes>
  </MemoryRouter>);
const body = () => document.body.textContent.replace(/ /g, " ");
const tiles = () => Array.from(document.querySelectorAll(".sell-cell")).map((c) => c.textContent.replace(/ /g, " "));

beforeEach(() => { priceService.explain.mockReset(); priceService.explain.mockResolvedValue(null); });
afterEach(cleanup);

describe("Your estimated price card", () => {
  it("shows only the date, the price and the likely range", () => {
    renderPage(forecast());
    expect(screen.getByTestId("price-label").textContent).toBe("Estimated price on 4 Nov 2026");
    expect(screen.getByTestId("hero-price").textContent.replace(/ /g, " ")).toBe("₹2,520 per quintal");
    expect(screen.getByTestId("range-line").textContent.replace(/ /g, " ")).toBe("Likely range: ₹2,100 to ₹2,900");
    const card = document.getElementById("step-price").closest("section").textContent;
    expect(card).not.toMatch(/Based on the latest recorded price|days from today|counts from this market|Only the price|Starting price|Latest market price/i);
  });

  it("leaves out the range when past tests showed it is not reliable", () => {
    renderPage(forecast({ range_info: { coverage_pct: 3, n: 900, scope: "projection", min_coverage_to_show_pct: 40, shown: false, typical_miss_inr: 300 } }));
    expect(screen.queryByTestId("range-line")).toBeNull();
  });

  it("blocked crop: last year's price on that date, no range and no expected price", () => {
    renderPage(blocked());
    expect(screen.getByTestId("price-label").textContent).toBe("Last year's price on 4 Nov 2026");
    expect(screen.queryByTestId("range-line")).toBeNull();
    expect(document.getElementById("step-price").closest("section").textContent).not.toMatch(/Estimated price|Expected|Likely range/);
  });
});

describe("one price for the selected date", () => {
  it("forecast allowed: the estimate card, the chart dot and the planned-date tile all show the same price", () => {
    renderPage(forecast());
    const price = 2520;
    expect(screen.getByTestId("hero-price").textContent).toContain("2,520");
    expect(screen.getByTestId("chart").getAttribute("data-selected")).toBe(String(price));
    expect(tiles()[0]).toContain("₹2,520");
  });

  it("blocked: all three show last year's price on that date", () => {
    renderPage(blocked());
    const last = 1900 + 11 * 8;   // 4 Nov is 12 days after the start
    expect(screen.getByTestId("hero-price").textContent).toContain(last.toLocaleString("en-IN"));
    expect(screen.getByTestId("chart").getAttribute("data-selected")).toBe(String(last));
    expect(tiles()[0]).toContain(`₹${last.toLocaleString("en-IN")}`);
  });
});

describe("Smart Selling", () => {
  it("(A) a later date within the typical miss: no clear advantage, the planned date is recommended", () => {
    renderPage(forecast({ chart_path: chartPath((d) => (d === "2026-11-11" ? 2600 : 2400)) }));
    expect(screen.getByTestId("sell-card").getAttribute("data-outcome")).toBe("A");
    expect(screen.getByTestId("sell-chip").textContent).toBe("No clear advantage from waiting");
    const [planned, alt, diff, wait] = tiles();
    expect(planned).toContain("Recommended");
    expect(alt).toContain("11 Nov 2026");
    expect(alt).toContain("₹2,600");
    expect(alt).toContain("Gain is within forecast uncertainty");
    expect(alt).not.toContain("Recommended");
    expect(diff).toContain("₹80 (+3.2%)");
    expect(wait).toContain("7 days");
    expect(screen.getByTestId("sell-why").textContent.replace(/ /g, " ")).toBe(
      "The model expects about ₹2,600 on 11 November, but the expected increase is small compared with forecast uncertainty, so waiting may not be worthwhile.");
    expect(screen.getByTestId("sell-store").textContent).toContain("storing your Tomato for 7 days more");
  });

  it("(B) a better date inside the shelf life: waiting may pay off, the better date is recommended", () => {
    renderPage(forecast({ chart_path: chartPath((d) => (d === "2026-11-11" ? 2900 : 2400)) }));
    expect(screen.getByTestId("sell-card").getAttribute("data-outcome")).toBe("B");
    expect(screen.getByTestId("sell-chip").textContent).toBe("Waiting may pay off");
    const [planned, alt, diff] = tiles();
    expect(planned).not.toContain("Recommended");
    expect(alt).toContain("Recommended");
    expect(alt).toContain("Higher than your planned date");
    expect(diff).toContain("₹380 (+15.1%)");
    expect(screen.getByTestId("sell-why").textContent.replace(/ /g, " ")).toBe(
      "The expected price on 11 November is ₹380 higher than on your planned date, which is more than the usual forecast miss.");
    expect(screen.getByTestId("sell-store").textContent).toContain("within its safe storage time of about 60 days");
    expect(screen.getByTestId("sell-store").textContent).toContain("Ripe tomatoes keep about a week.");
  });

  it("a gain beyond the shelf life is not offered", () => {
    renderPage(forecast({ advice: advice({ storage: storage({ farm_hold_days: 14, max_hold_days: 14 }) }), chart_path: chartPath((d) => (d === "2026-11-18" ? 5000 : 2400)) }));
    expect(screen.getByTestId("sell-card").getAttribute("data-outcome")).not.toBe("B");   // 18 Nov is 26 days away, shelf life 14
    expect(body()).not.toContain("₹5,000");
  });

  it("(C) blocked with no earlier-year evidence: no best date, no higher price", () => {
    renderPage(blocked());
    expect(screen.getByTestId("sell-card").getAttribute("data-outcome")).toBe("C");
    expect(screen.getByTestId("sell-chip").textContent).toBe("No clear advantage from waiting");
    const [planned, alt, diff, wait] = tiles();
    expect(planned).toContain("Recommended");
    expect(alt).toContain("Not available");
    expect(alt).not.toMatch(/Nov 2026|₹/);
    expect(diff).toMatch(/-$/);
    expect(wait).toMatch(/-$/);
    expect(screen.getByTestId("sell-why").textContent.replace(/ /g, " ")).toBe(
      "We cannot say that a later date will give a higher price. Sell on your planned date or check today's mandi price before deciding.");
    expect(screen.getByTestId("sell-store").textContent).toContain("only worth it if the price rises more than your storage cost");
  });

  it("blocked with 3 earlier years that agree: uses them and says so, never the forecast", () => {
    const year = (y, up) => ({ year: y, date: `${y}-11-04`, price: 2000, raw_price: 1900, n: 9, weekly: { 0: 2000, 7: 2000 * up } });
    renderPage(blocked({ earlier_years: [year(2025, 1.2), year(2024, 1.15), year(2023, 1.18)] }));
    expect(screen.getByTestId("sell-card").getAttribute("data-outcome")).toBe("B");
    expect(screen.getByTestId("sell-chip").textContent).toBe("Waiting may pay off");
    expect(body()).not.toContain("₹2,520");                          // the forecast price is never shown for a blocked crop
  });

  it("(D) planned date beyond the shelf life: sell soon, and storing is not recommended", () => {
    renderPage(forecast({ advice: advice({ storage: storage({ farm_hold_days: 7, max_hold_days: 7 }) }),
      chart_path: chartPath((d) => (d === "2026-10-28" ? 2450 : 2400)) }));
    expect(screen.getByTestId("sell-card").getAttribute("data-outcome")).toBe("D");
    expect(screen.getByTestId("sell-chip").textContent).toBe("Sell soon");
    expect(screen.getByTestId("sell-why").textContent).toBe("Tomato cannot be stored safely until 4 November. Sell by 30 October.");
    const [planned, alt] = tiles();
    expect(planned).not.toContain("Recommended");
    expect(alt).toContain("28 Oct 2026");
    expect(alt).toContain("Recommended");
    expect(screen.getByTestId("sell-store").textContent).toContain("Sell it by 30 October instead of storing it");
  });

  it("shows the storage box with the crop's own tip and storage times", () => {
    renderPage(forecast({ advice: advice({ storage: storage({ farm_hold_days: 21, max_hold_days: 60, note: "Keep potatoes cool and dark." }) }) }));
    const t = document.querySelector(".sell-store-general").textContent;
    expect(t).toContain("General storage guidance:");
    expect(t).toContain("Keep potatoes cool and dark.");
    expect(t).toContain("Ordinary farm storage: about 21 days.");
    expect(t).toContain("With good storage (such as cold storage): up to about 60 days.");
  });
});

describe("chart section", () => {
  it("allowed: the description mentions the likely range, the caption says expected prices are estimates, the chart gets the forecast", () => {
    renderPage(forecast());
    const sec = document.getElementById("step-chart").closest("section");
    expect(sec.textContent).toContain("Daily predicted mandi price from 23 Oct 2026 to 18 Nov 2026");
    expect(sec.textContent).toContain("The shaded band shows the likely range.");
    expect(sec.textContent).toContain("The chart continues after your date so you can compare later selling dates.");
    const chart = screen.getByTestId("chart");
    expect(chart.getAttribute("data-forecast")).toBe("true");
    expect(chart.getAttribute("data-path")).toBe("30");
    expect(chart.getAttribute("data-end")).toBe("2026-11-18");
    expect(chart.getAttribute("data-caption")).toBe("Expected prices are estimates. Actual market prices may differ.");
  });

  it("a latest report older than 7 days adds the reference notice", () => {
    renderPage(forecast());
    expect(screen.getByTestId("chart-notice").textContent).toContain("Recent mandi prices are not available in this app. The dotted grey line is last year's price for the same dates, raised for inflation.");
    expect(screen.queryByTestId("no-forecast-line")).toBeNull();
  });

  it("a recent report and an allowed forecast need no notice", () => {
    renderPage(forecast({ latest_recorded: { price: 2100, date: TODAY, age_days: 2, stale: false, age_n: 0, age_unit: "days" } }));
    expect(screen.queryByTestId("chart-notice")).toBeNull();
  });

  it("blocked: both notices, no forecast path, the blocked caption", () => {
    renderPage(blocked());
    const n = screen.getByTestId("chart-notice").textContent;
    expect(n).toContain("Recent mandi prices are not available in this app.");
    expect(screen.getByTestId("no-forecast-line").textContent).toBe("We do not show a price forecast for Tomato at this distance because past tests showed it was not reliable enough.");
    const chart = screen.getByTestId("chart");
    expect(chart.getAttribute("data-forecast")).toBe("false");
    expect(chart.getAttribute("data-path")).toBe("0");
    expect(chart.getAttribute("data-caption")).toBe("Past prices for Tomato at APMC Mumbai, adjusted for inflation. This is not a forecast.");
    expect(document.getElementById("step-chart").closest("section").textContent).not.toContain("The shaded band");
  });

  it("blocked with no past prices at all: the notice only, never a blank chart", () => {
    renderPage(blocked({ reference_after: [], history: [] }));
    expect(screen.queryByTestId("chart")).toBeNull();
    expect(screen.getByTestId("no-forecast-line")).toBeTruthy();
    expect(screen.getByTestId("no-history").textContent).toBe("There are not enough past prices to draw a chart for Tomato at APMC Mumbai.");
  });

  it("falls back to the selected date + 14 days when the API gives no chart end", () => {
    renderPage(forecast({ chart_end_date: null }));
    expect(screen.getByTestId("chart").getAttribute("data-end")).toBe("2026-11-18");
  });
});

describe("language", () => {
  it("uses none of the banned words anywhere on the page", () => {
    renderPage(forecast());
    expect(body()).not.toMatch(/model gate|baseline|validation|\bMAE\b|SHAP|horizon|percentile/i);
    cleanup();
    renderPage(blocked());
    expect(body()).not.toMatch(/model gate|baseline|validation|\bMAE\b|SHAP|horizon|percentile/i);
  });

  it("the numbered steps use the same card and an inner subtitle", () => {
    renderPage(forecast());
    const sell = screen.getByRole("heading", { name: /Smart Selling Recommendation/ }).closest("section");
    expect(within(sell).getByText("Choose a suitable selling date based on predicted prices, storage conditions, and forecast reliability.")).toBeTruthy();
  });
});
