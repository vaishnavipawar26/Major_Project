// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/priceService", () => ({ priceService: { trend: vi.fn(), explain: vi.fn(), weatherContext: vi.fn(), soilContext: vi.fn() } }));
vi.mock("../services/historyService", () => ({ historyService: { priceItem: vi.fn() } }));
vi.mock("../services/api", () => ({ errorMessage: (e) => e.message }));
// jsdom has no layout: give recharts' container a fixed size
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal();
  const { cloneElement } = await import("react");
  return { ...actual, ResponsiveContainer: ({ children }) => <div>{cloneElement(children, { width: 900, height: 400 })}</div> };
});

import { priceService } from "../services/priceService";
import PriceResult from "./PriceResult";

const day = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const run = (n) => Array.from({ length: n }, (_, i) => i);
const TODAY = "2026-10-23", PLANNED = "2026-11-04";
const nb = (s) => s.replace(/ /g, " ");

// the API's 30-day window, built the way the backend builds it
const entriesOf = (price, ok = () => true) => run(30).map((i) => {
  const date = day(TODAY, i + 1), p = price(date, i + 1);
  return { date, day: i + 1, status: p == null ? "unavailable" : ok(i + 1) ? "validated" : "not_validated", predicted_price: p, lower: p && p - 400, upper: p && p + 400 };
});
function makeWindow({ price = (d) => (d === PLANNED ? 2520 : 2400), ok, comparison, planned } = {}) {
  const es = entriesOf(price, ok);
  const pe = es.find((e) => e.date === PLANNED);
  const valid = es.filter((e) => e.status === "validated");
  const high = valid.reduce((b, e) => (!b || e.predicted_price > b.predicted_price ? e : b), null);
  return {
    days: 30, hold_days: 60, start_date: TODAY, end_date: day(TODAY, 30), reference_price: 2100, reference_date: TODAY, entries: es,
    planned: planned || { date: PLANNED, status: pe.status, price: pe.predicted_price, lower: 2100, upper: 2900, in_window: true },
    highest: high && { date: high.date, price: high.predicted_price },
    change: valid.length ? { to_date: valid.at(-1).date, pct: 14.3, is_window_end: valid.at(-1).day === 30 } : null,
    comparison: comparison || (high && high.date !== PLANNED && high.predicted_price > 2520
      ? { code: "alternative", reason: null, date: high.date, price: high.predicted_price, diff: high.predicted_price - 2520,
        diff_pct: ((high.predicted_price - 2520) / 2520) * 100, wait_days: 7, beyond_storage: null }
      : valid.length ? { code: "planned_is_best", reason: null, date: PLANNED, price: 2520, diff: 0, diff_pct: 0, wait_days: 0, beyond_storage: null }
        : { code: "unavailable", reason: "planned_not_validated", date: null, price: null, diff: null, diff_pct: null, wait_days: null }),
    validated_days: valid.length, unvalidated_days: es.filter((e) => e.status === "not_validated").length,
    unavailable_days: es.filter((e) => e.status === "unavailable").length,
  };
}
const explanation = () => ({ explanations: [{ date: PLANNED, weather: { status: "not_used", used: false }, technical: { reconstruction_ok: true }, charts: { local: {
  start_price: 2100, baseline_inr: 50, baseline_price: 2150, end_price: 2520, forecast_price: 2520, matches_forecast: true,
  steps: [
    { group: "price_level", title: "Current price level", help: "The current price itself.", log_contribution: 0.1, inr: 260 },
    { group: "season", title: "Seasonal pattern", help: "The time of year.", log_contribution: -0.03, inr: -80 },
    { group: "arrivals", title: "Market arrivals (supply)", help: "Produce reaching the market.", log_contribution: 0.04, inr: 90 },
  ] } } }] });

const storage = { crop: "Tomato", category: "Storable", max_hold_days: 60, farm_hold_days: 60, note: "Ripe tomatoes keep about a week." };
const forecast = (over = {}) => ({
  series: { state: "Maharashtra", market: "APMC Mumbai", commodity: "Tomato", variety: "Other" },
  input_date: TODAY, forecast_origin_date: TODAY, target_date: PLANNED, target_horizon_days: 12, current_price: 2100, arrivals_used: 50,
  target: { horizon_days: 12, date: PLANNED, predicted_price: 2520, lower: 2100, upper: 2900, change_pct: 20, stable_band_pct: 10, direction: "Increasing",
    actual_price: null, beats_baseline: true, model_mae: 300, baseline_mae: 350 },
  path: [], chart_path: [], last_validated_days: 12, validated_days: 12, max_horizon_days: 60,
  advice: { code: "SELL_ON_TARGET", label: "x", target_date: PLANNED, storage },
  history: [], history_is_reference: true, reference_after: [], actual_after_origin: [], earlier_years: [], observed: [],
  model: { version: "v", algorithm: "XGBoost", approach: "a", data_end: "2025-12-31" },
  source: { kind: "market", method: "trained_model", fallback: false },
  window: makeWindow(), disclaimer: "d", policy: { mode: "model", band: "8-14", reasons: ["ok"] },
  range_info: { coverage_pct: 82.4, n: 4200, scope: "projection", min_coverage_to_show_pct: 40, shown: true, typical_miss_inr: 300 },
  latest_recorded: { price: 1950, date: "2025-12-31", age_days: 296, stale: true, age_n: 10, age_unit: "months" }, ...over,
});
const req = { state: "Maharashtra", market: "APMC Mumbai", commodity: "Tomato", target_date: PLANNED, as_of: TODAY };
const renderPage = (f) => render(
  <MemoryRouter initialEntries={[{ pathname: "/price-prediction/result", state: { req, prediction: f } }]}>
    <Routes><Route path="/price-prediction/result" element={<PriceResult />} /></Routes>
  </MemoryRouter>);
const body = () => nb(document.body.textContent);
const text = (id) => nb(screen.getByTestId(id).textContent);

beforeEach(() => {
  priceService.explain.mockReset(); priceService.explain.mockResolvedValue(null);
  priceService.weatherContext.mockReset(); priceService.weatherContext.mockResolvedValue({ status: "unavailable", market: "APMC Mumbai", date: PLANNED });
  priceService.soilContext.mockReset(); priceService.soilContext.mockResolvedValue({ status: "unavailable", market: "APMC Mumbai", ph: null, soil_type: null });
});
afterEach(cleanup);

describe("Your estimated price card", () => {
  it("shows only the date, the price and the likely range", () => {
    renderPage(forecast());
    expect(screen.getByTestId("price-label").textContent).toBe("Estimated price on 4 Nov 2026");
    expect(text("hero-price")).toBe("₹2,520 per quintal");
    expect(text("range-line")).toBe("Likely range: ₹2,100 to ₹2,900");
  });
  it("leaves out the range when past tests showed it is not reliable", () => {
    renderPage(forecast({ range_info: { coverage_pct: 3, n: 900, scope: "projection", min_coverage_to_show_pct: 40, shown: false, typical_miss_inr: 300 } }));
    expect(screen.queryByTestId("range-line")).toBeNull();
  });
});

describe("30-day price forecast", () => {
  it("summarises the starting price, the planned-date price, the highest price and the change", () => {
    renderPage(forecast({ window: makeWindow({ price: (d) => (d === PLANNED ? 2520 : d === "2026-11-11" ? 2700 : 2400) }) }));
    expect(text("pf-start")).toContain("₹2,100");
    expect(text("pf-planned")).toContain("₹2,520");
    expect(text("pf-high")).toContain("₹2,700");
    expect(text("pf-high")).toContain("11 Nov 2026");
    expect(text("pf-change")).toContain("+14.3%");
    expect(text("pf-legend")).toMatch(/Predicted price.*Your planned date.*Highest predicted price/);
  });
  it("says how many days have no validated prediction", () => {
    renderPage(forecast({ window: makeWindow({ ok: (n) => n !== 3, price: (d, n) => (n === 5 ? null : d === PLANNED ? 2520 : 2400) }) }));
    expect(text("pf-missing")).toContain("2 days are left out");
  });
  it("notes that old actual prices are not drawn instead of joining them to the forecast", () => {
    renderPage(forecast({ observed: [{ date: "2025-12-30", price: 1900 }, { date: "2025-12-31", price: 1950 }] }));
    expect(text("pf-stale")).toContain("₹1,950 on 31 Dec 2025");
  });
  it("shows a message, not a line, when no day has a validated prediction", () => {
    renderPage(forecast({ window: makeWindow({ ok: () => false }) }));
    expect(screen.getByTestId("pf-none")).toBeTruthy();
  });
  it("asks for a new prediction when the response has no window", () => {
    renderPage(forecast({ window: undefined }));
    expect(screen.getByTestId("pf-unavailable")).toBeTruthy();
  });
});

describe("factor card", () => {
  it("is no longer on the result page (it lives on the explanation page)", async () => {
    priceService.explain.mockResolvedValue(explanation());
    renderPage(forecast());
    await screen.findByTestId("why-button");
    expect(body()).not.toMatch(/What Influences Your Predicted Price|Highest target weight|Target importance/);
    expect(document.querySelectorAll("[data-testid=factor-influence]").length).toBe(0);
    expect(document.getElementById("step-sell")).toBeTruthy();
  });
});

describe("Smart Selling Recommendation", () => {
  it("shows the planned date's daily price and the best other date with exact differences", () => {
    renderPage(forecast({ window: makeWindow({ price: (d) => (d === PLANNED ? 2520 : d === "2026-11-11" ? 2772 : 2400) }) }));
    expect(text("sw-planned")).toContain("4 Nov 2026");
    expect(text("sw-planned")).toContain("₹2,520");
    expect(text("sw-alt")).toContain("11 Nov 2026");
    expect(text("sw-alt")).toContain("₹2,772");
    expect(text("sw-diff")).toContain("+₹252");
    expect(text("sw-diff")).toContain("+10.0%");
    expect(text("sw-wait")).toContain("7 days");
    expect(text("sell-why")).toBe("The model predicts a higher price on 11 November 2026 than on your planned date. The estimated difference is ₹252 per quintal (10.0%).");
  });
  it("says so when the planned date already has the highest predicted price", () => {
    renderPage(forecast());
    expect(screen.getByTestId("sell-card").getAttribute("data-outcome")).toBe("planned_is_best");
    expect(text("sell-why")).toBe("Your planned date already has the highest predicted price in this forecast window.");
  });
  it("shows 'Alternative date unavailable' when nothing can be compared", () => {
    renderPage(forecast({ window: makeWindow({ ok: () => false }) }));
    expect(text("sw-alt")).toContain("Alternative date unavailable");
    expect(text("sw-planned")).toContain("no price is shown");
  });
  it("does not substitute another date when the planned date is outside the window", () => {
    const w = makeWindow();
    w.planned = { ...w.planned, in_window: false };
    w.comparison = { code: "outside_window", reason: "planned_outside_window", date: null, price: null, diff: null, diff_pct: null, wait_days: null };
    renderPage(forecast({ window: w }));
    expect(text("sell-why")).toContain("outside the 30-day forecast window");
  });
  it("keeps storage advice and the profit caution", () => {
    renderPage(forecast());
    expect(text("sell-store")).toContain("Ripe tomatoes keep about a week.");
    expect(text("sw-caution")).toContain("not always the highest profit");
  });
});

describe("crops without a validated forecast", () => {
  const blockedWindow = () => {
    const w = makeWindow({ ok: () => false });
    w.validation = { mode: "context_only", band: "8-14", reasons: ["Real-origin backtest (origins 2025-H2, n=7,389): model -17.2% vs no-change."], validated_up_to_days: 0 };
    return w;
  };
  const blocked = (over = {}) => forecast({
    policy: { mode: "context_only", band: "8-14", reasons: ["no"] }, window: blockedWindow(),
    observed: [{ date: "2025-12-29", price: 1900 }, { date: "2025-12-30", price: 1950 }, { date: "2025-12-31", price: 1980 }],
    history_is_reference: true, dates: { years_shifted: 1 }, projection: { years_ahead: 1, inflation_annual_pct: 5 },
    reference_after: run(30).map((i) => ({ date: day(TODAY, i + 1), price: 2000 + i })), ...over,
  });

  it("labels a moved-forward earlier price as a historical reference with its real source date", () => {
    renderPage(blocked());
    expect(text("price-label")).toBe("Historical reference price (around 4 Nov 2025)");
    expect(text("ref-note")).toContain("Prices reported around 4 Nov 2025");
    expect(text("ref-note")).toContain("5% a year of inflation");
    expect(text("ref-note")).toContain("not a forecast for 4 Nov 2026");
    expect(text("latest-actual")).toContain("Latest actual market price");      // the latest real price is a separate line
  });

  it("shows the market's real price history and the specific test result instead of an empty graph", () => {
    renderPage(blocked());
    expect(text("pf-none")).toContain("No daily price forecast");
    expect(text("pf-none-reason")).toContain("model -17.2% vs no-change");
    expect(text("hist-note")).toContain("latest was ₹1,980");
    expect(document.querySelector("[data-testid=hist-chart] .recharts-wrapper")).toBeTruthy();
  });

  it("keeps experimental estimates hidden until asked, and labels them when shown", () => {
    renderPage(blocked());
    expect(screen.queryByTestId("pf-exp-warn")).toBeNull();
    fireEvent.click(screen.getByTestId("pf-exp-toggle").querySelector("input"));
    expect(text("pf-exp-warn")).toContain("not forecasts to plan with");
    expect(text("pf-legend")).toContain("Experimental estimate (not validated)");
  });

  it("gives the real reason instead of 'No comparison available' and recommends no date", () => {
    renderPage(blocked());
    expect(text("sell-why")).toContain("did not pass its accuracy tests");
    expect(text("sell-why")).toContain("model -17.2% vs no-change");
    expect(text("sw-alt")).toContain("Alternative date unavailable");
  });

  it("labels a comparison built only on experimental estimates as experimental, never as a recommendation", () => {
    const w = blockedWindow();
    w.experimental = { validated: false, planned: { date: PLANNED, status: "validated", price: 2400 },
      comparison: { code: "alternative", reason: null, date: "2026-11-11", price: 2640, diff: 240, diff_pct: 10, wait_days: 7, beyond_storage: null } };
    renderPage(blocked({ window: w }));
    expect(screen.getByTestId("sell-card").getAttribute("data-experimental")).toBe("true");
    expect(text("sell-chip")).toContain("Experimental");
    expect(text("sw-alt")).toContain("₹2,640");
    expect(text("sw-alt")).toContain("Experimental");
    expect(text("sw-alt")).not.toContain("Recommended");
    expect(text("sell-why")).toContain("Experimental estimate, not a validated recommendation.");
    expect(text("sw-exp-note")).toContain("not a recommendation to plan with");
  });

  it("a validated comparison is never replaced by an experimental one", () => {
    const w = makeWindow({ price: (d) => (d === PLANNED ? 2520 : d === "2026-11-11" ? 2772 : 2400) });
    w.experimental = { validated: false, planned: { date: PLANNED, status: "validated", price: 1 }, comparison: { code: "alternative", date: "2026-11-30", price: 9999, diff: 9998, diff_pct: 9, wait_days: 26 } };
    renderPage(forecast({ window: w }));
    expect(screen.getByTestId("sell-card").getAttribute("data-experimental")).toBeNull();
    expect(text("sw-alt")).toContain("₹2,772");
  });
});
