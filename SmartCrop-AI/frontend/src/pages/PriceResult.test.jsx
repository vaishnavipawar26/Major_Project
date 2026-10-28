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
    // with no storage block the highest date is also the recommended one, so one marker carries both names
    expect(text("pf-legend")).toMatch(/Predicted price.*Your planned date.*Recommended selling date/);
  });
  it("says how many days have no validated prediction", () => {
    renderPage(forecast({ window: makeWindow({ ok: (n) => n !== 3, price: (d, n) => (n === 5 ? null : d === PLANNED ? 2520 : 2400) }) }));
    expect(screen.queryByTestId("pf-notes")).toBeNull();                      // the note lines under the chart were removed
    expect(screen.queryByTestId("pf-missing")).toBeNull();
  });
  it("notes that old actual prices are not drawn instead of joining them to the forecast", () => {
    renderPage(forecast({ observed: [{ date: "2025-12-30", price: 1900 }, { date: "2025-12-31", price: 1950 }] }));
    expect(screen.queryByTestId("pf-stale")).toBeNull();
    expect(screen.queryByTestId("pf-notes")).toBeNull();
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
    expect(text("sw-rec")).toContain("11 Nov 2026");
    expect(text("sw-rec")).toContain("7 days after your planned date");
    expect(text("sw-rec")).toContain("₹2,772");
    expect(screen.queryByTestId("sw-high")).toBeNull();                       // the highest-price / survival / time-left cells were removed
    expect(text("sw-diff")).toContain("+₹252");
    expect(text("sw-diff")).toContain("+10.0%");
    expect(text("sw-wait")).toContain("7 days");
    expect(text("sell-why")).toBe("The predicted price on 11 Nov is ₹252/quintal (10.0%) higher than your planned date.");
  });
  it("says so when the planned date already has the highest predicted price", () => {
    renderPage(forecast());
    expect(screen.getByTestId("sell-card").getAttribute("data-outcome")).toBe("planned_is_best");
    expect(text("sell-why")).toBe("No other date in the forecast window has a higher predicted price.");
    // the planned date is the recommendation: stated plainly, with a zero difference and no waiting, never "None needed" or dashes
    expect(text("sw-rec")).toContain("Your planned date");
    expect(text("sw-rec")).toContain("₹2,520");
    expect(text("sw-diff")).toContain("₹0/quintal compared with your planned date");
    expect(text("sw-wait")).toContain("0 days");
    expect(screen.getByTestId("sell-card").textContent).not.toMatch(/None needed/);
  });
  it("recommends no date when nothing can be compared", () => {
    renderPage(forecast({ window: makeWindow({ ok: () => false }) }));
    expect(text("sw-rec")).toContain("Unavailable");
    // none of the price / difference / time-left cells (they would only be dashes) and no reliability wording
    for (const id of ["sw-high", "sw-left"]) expect(screen.queryByTestId(id)).toBeNull();
    for (const id of ["sw-diff", "sw-wait"]) expect(text(id)).toContain("Unavailable");   // never a made-up number
    expect(screen.getByTestId("sell-card").textContent).not.toMatch(/reliable enough|accuracy tests|Past tests/i);
  });
  it("does not substitute another date when the planned date is outside the window", () => {
    const w = makeWindow();
    w.planned = { ...w.planned, in_window: false };
    w.comparison = { code: "outside_window", reason: "planned_outside_window", date: null, price: null, diff: null, diff_pct: null, wait_days: null };
    renderPage(forecast({ window: w }));
    expect(text("sell-why")).toContain("outside the 30-day forecast window");
  });
  it("has no storage picker or storage detail block, and does not show the profit disclaimer", () => {
    renderPage(forecast());
    expect(screen.queryByTestId("sell-store")).toBeNull();
    expect(screen.queryByTestId("ss-picker")).toBeNull();
    expect(screen.queryByTestId("sw-caution")).toBeNull();
    expect(screen.getByTestId("sell-card").textContent).not.toContain("not always the highest profit");
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

  it("a validated estimate is dated on the planned date even when the forecast was projected from an earlier year", () => {
    renderPage(forecast({ history_is_reference: true, dates: { years_shifted: 1 }, projection: { years_ahead: 1, inflation_annual_pct: 5 } }));
    expect(text("price-label")).toBe("Estimated price on 4 Nov 2026");
  });
  it("with no report near that day of the year, shows the latest actual price under its own date, never as an estimate", () => {
    renderPage(blocked({ history: [], reference_after: [], observed: [], latest_recorded: { price: 2650, date: "2025-12-31", age_days: 301, stale: true } }));
    expect(text("price-label")).toBe("Latest actual market price (reported 31 Dec 2025)");
    expect(text("hero-price")).toContain("₹2,650");
    expect(text("no-forecast-note")).toContain("no validated forecast");
    expect(screen.queryByTestId("no-price")).toBeNull();
    expect(screen.queryByTestId("latest-actual")).toBeNull();                 // not repeated under the headline
  });
  it("graph summary cards say Unavailable with a reason instead of a dash when nothing is validated", () => {
    renderPage(blocked());
    for (const id of ["pf-planned", "pf-high", "pf-change"]) {
      expect(text(id)).toContain("Unavailable");
      expect(text(id)).not.toMatch(/—/);
    }
    expect(text("pf-high")).toContain("No validated forecast");
    expect(text("pf-start")).not.toContain("Unavailable");
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
    expect(screen.queryByTestId("pf-none-reason")).toBeNull();               // the backtest sentence is not shown
    expect(document.body.textContent).not.toMatch(/backtest|vs no-change/i);
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

  it("recommends no date, without accuracy-test or backtest wording, and leaves no empty explanation box", () => {
    renderPage(blocked());
    const card = screen.getByTestId("sell-card");
    expect(card.textContent).not.toMatch(/accuracy tests|backtest|vs no-change|raw estimates/i);
    expect(text("sell-why")).toBe("No reliable forecast is available to compare selling dates.");              // Case D: explained, never an empty box and never an invented date
    expect(text("sw-rec")).toContain("Unavailable");
  });

  it("with only experimental estimates the recommendation is labelled provisional, never validated", () => {
    const w = blockedWindow();
    w.experimental = { validated: false, planned: { date: PLANNED, status: "validated", price: 2400 },
      comparison: { code: "alternative", reason: null, date: "2026-11-11", price: 2640, diff: 240, diff_pct: 10, wait_days: 7, beyond_storage: null } };
    renderPage(blocked({ window: w }));
    const card = screen.getByTestId("sell-card");
    expect(card.getAttribute("data-outcome")).toBe("provisional");
    expect(text("sell-chip")).toBe("Provisional: based on unvalidated estimates");
    expect(text("sw-planned")).toContain("₹2,400");
    expect(text("sw-planned")).toContain("Experimental estimate, not validated");
    expect(text("sw-rec")).toContain("₹2,640");
    expect(text("sw-rec")).toContain("Provisional");
    expect(text("sw-rec")).not.toContain("Recommended");
    expect(card.className).not.toContain("is-rec");
    expect(text("sell-why")).toMatch(/^Provisional, from unvalidated estimates: /);
    expect(text("sw-diff")).toContain("+₹240");
    expect(text("sa-line2")).toContain("Waiting 7 days is within the estimated limit");
  });
  it("an earlier better date never says the farmer must wait", () => {
    const w = blockedWindow();
    w.experimental = { validated: false, planned: { date: PLANNED, status: "validated", price: 2400 },
      comparison: { code: "alternative", reason: null, date: "2026-10-30", price: 2600, diff: 200, diff_pct: 8.3, wait_days: -5, beyond_storage: null } };
    renderPage(blocked({ window: w }));
    expect(text("sa-line2")).toContain("Selling earlier than planned needs no extra storage time.");
    expect(text("sa-line2")).not.toContain("Waiting");
  });
  it("without any experimental estimate nothing is invented", () => {
    renderPage(blocked({ window: blockedWindow() }));
    expect(screen.getByTestId("sell-card").getAttribute("data-outcome")).toBe("unavailable");
    expect(text("sw-rec")).toContain("Unavailable");
    expect(text("sell-chip")).toBe("No validated forecast to compare");
  });

  it("a validated comparison is never replaced by an experimental one", () => {
    const w = makeWindow({ price: (d) => (d === PLANNED ? 2520 : d === "2026-11-11" ? 2772 : 2400) });
    w.experimental = { validated: false, planned: { date: PLANNED, status: "validated", price: 1 }, comparison: { code: "alternative", date: "2026-11-30", price: 9999, diff: 9998, diff_pct: 9, wait_days: 26 } };
    renderPage(forecast({ window: w }));
    expect(screen.getByTestId("sell-card").getAttribute("data-experimental")).toBeNull();
    expect(text("sw-rec")).toContain("₹2,772");
  });
});

// ------------------------------------------------------------------------------------------------ storage-aware recommendation
// Plans shaped like the API's window.storage (backend/app/ml/price_prediction/crop_storage.py; the backend tests check how they are computed).
describe("Smart Selling with the farmer's storage", () => {
  const FAR = "2026-11-23";          // 19 days after the planned date 2026-11-04
  const NEAR = "2026-11-17";         // 13 days after
  const src = (id, publisher) => ({ id, publisher, title: publisher, url: `https://example.org/${id}` });
  const plan = (o) => ({
    crop: "Brinjal", supported: true, profile: "fresh", profile_label: "Fresh brinjal", facility: "ordinary", facility_used: "ordinary",
    facility_label: "In shade under ordinary conditions", fallback: false, hold_days: 2, range: "1 to 2 days in summer, 3 to 4 days in winter",
    basis: "NHB", approximate: true, confidence: "moderate", category: "Fresh vegetable", perishability: "Highly perishable",
    conditions: "Cold storage at 7-10 °C.", risks: "Shrivelling and rot within days.", advice: ["Keep brinjal in shade and handle gently."],
    sources: [src("nhb_brinjal", "National Horticulture Board, India")], uncertainty: "This is an approximate estimate.", deadline: "2026-11-06",
    experimental: null, comparison: null, ...o });
  const planned = (o = {}) => ({ code: "planned_is_best", reason: null, date: PLANNED, price: 2520, diff: 0, diff_pct: 0, wait_days: 0,
    beyond_storage: { date: FAR, price: 2900 }, deadline: "2026-11-06", days_left: 2, highest: { date: FAR, price: 2900, within_storage: false }, ...o });
  const later = (o = {}) => ({ code: "alternative", reason: null, date: NEAR, price: 2750, diff: 230, diff_pct: 9.13, wait_days: 13, beyond_storage: { date: FAR, price: 2900 },
    deadline: "2026-11-17", days_left: 0, highest: { date: FAR, price: 2900, within_storage: false }, ...o });
  const withStorage = (plans, profiles = [], def = "ordinary:fresh") => {
    const w = makeWindow({ price: (d) => (d === PLANNED ? 2520 : d === NEAR ? 2750 : d === FAR ? 2900 : 2400) });
    w.storage = { crop: "Brinjal", supported: true, default: def, profiles,
      facilities: [{ key: "ordinary", label: "Ordinary farm storage" }, { key: "improved", label: "Improved low-cost storage" }, { key: "cold", label: "Cold storage or cold room" }],
      plans };
    w.comparison = plans[w.storage.default].comparison;
    w.highest = { date: FAR, price: 2900 };
    return w;
  };
  const brinjal = () => withStorage({
    "ordinary:fresh": plan({ comparison: planned() }),
    "improved:fresh": plan({ facility: "improved", facility_used: "improved", facility_label: "Evaporative cool chamber", hold_days: 9, deadline: "2026-11-13",
      range: "about 9 to 15 days", comparison: planned({ deadline: "2026-11-13", days_left: 9 }) }),
    "cold:fresh": plan({ facility: "cold", facility_used: "cold", facility_label: "Cold room at 7-10 °C", hold_days: 7, deadline: "2026-11-11",
      comparison: planned({ deadline: "2026-11-11", days_left: 7 }) }),
  });

  it("example A: a higher price 19 days later is shown as the highest price but not recommended under ordinary storage", () => {
    renderPage(forecast({ window: brinjal(), series: { state: "Maharashtra", market: "APMC Mumbai", commodity: "Brinjal", variety: "Other" } }));
    expect(text("sw-rec")).toContain("Your planned date");
    expect(text("sw-rec")).toContain("₹2,520");
    expect(text("sw-diff")).toContain("₹0/quintal compared with your planned date");
    expect(text("sw-wait")).toContain("0 days");
    expect(screen.queryByTestId("sw-survival")).toBeNull();
    expect(screen.queryByTestId("sw-left")).toBeNull();
    expect(text("sell-why")).toContain("not worth the risk");
    expect(screen.queryByTestId("sell-store")).toBeNull();                      // the storage picker and detail block were removed
  });

  it("the card and the chart read the same prices, and the chart names the storage limit", () => {
    renderPage(forecast({ window: brinjal() }));
    expect(text("pf-high")).toContain("₹2,900");
    expect(text("pf-high")).toContain("23 Nov 2026");
    expect(text("pf-planned")).toContain("₹2,520");
    expect(text("sw-planned")).toContain("₹2,520");
    expect(screen.queryByTestId("pf-beyond")).toBeNull();
    expect(text("pf-legend")).toMatch(/Your planned date.*Highest predicted price.*Estimated storage limit/);
  });

  it("does not show the profit disclaimer and never claims waiting raises profit", () => {
    renderPage(forecast({ window: withStorage({ "ordinary:fresh": plan({ comparison: later({ highest: { date: NEAR, price: 2750, within_storage: true } }) }) }) }));
    expect(screen.queryByTestId("sw-caution")).toBeNull();
    expect(screen.getByTestId("sell-card").textContent).not.toContain("not always the highest profit");
    expect(screen.getByTestId("sell-card").textContent).not.toMatch(/more profit|will earn|guarantee/i);
  });

  it("an older response without a storage block still shows the card from its own comparison", () => {
    renderPage(forecast());
    expect(screen.queryByTestId("ss-picker")).toBeNull();
    expect(screen.queryByTestId("sw-survival")).toBeNull();
  });
});

// ---- Smart Selling layout for every crop: four cards, "Why this date?", green Storage advice panel ----
describe("Smart Selling layout for all seven crops", () => {
  const CROPS = ["Brinjal", "Cabbage", "Cauliflower", "Onion", "Potato", "Tomato", "Wheat"];
  const NEAR_D = day(PLANNED, 11), FAR_D = day(TODAY, 30);
  const price = (d) => (d === PLANNED ? 2520 : d === NEAR_D ? 2650 : d === FAR_D ? 2900 : 2400);
  const planFor = (crop, hold, comparison) => ({
    crop, supported: true, profile: "fresh", profile_label: `Storage profile for ${crop}`, facility: "ordinary", facility_used: "ordinary",
    facility_label: "Ordinary farm storage", fallback: false, hold_days: hold, range: `about ${hold} days for ${crop}`, basis: "guidance",
    approximate: true, confidence: "moderate", conditions: `Keep ${crop} cool and dry.`, risks: "Spoilage.", advice: [`Check ${crop} daily.`],
    sources: [], uncertainty: `Approximate for ${crop}.`, deadline: day(PLANNED, hold), experimental: null, comparison });
  const alt = (crop) => ({ code: "alternative", reason: null, date: NEAR_D, price: 2650, diff: 130, diff_pct: 5.16, wait_days: 11, beyond_storage: null, deadline: day(PLANNED, 14),
    days_left: 3, highest: { date: NEAR_D, price: 2650, within_storage: true } });
  const beyond = () => ({ code: "planned_is_best", reason: null, date: PLANNED, price: 2520, diff: 0, diff_pct: 0, wait_days: 0, beyond_storage: { date: FAR_D, price: 2900 },
    deadline: day(PLANNED, 5), days_left: 5, highest: { date: FAR_D, price: 2900, within_storage: false } });
  const noPlan = () => ({ code: "planned_is_best", reason: null, date: PLANNED, price: 2520, diff: 0, diff_pct: 0, wait_days: 0, beyond_storage: null,
    deadline: day(PLANNED, 14), days_left: 14, highest: { date: PLANNED, price: 2520, within_storage: true } });
  const build = (crop, kind) => {
    const w = makeWindow({ price });
    const cmp = kind === "alt" ? alt(crop) : kind === "beyond" ? beyond() : noPlan();
    const hold = kind === "beyond" ? 5 : 14;
    const p = planFor(crop, hold, cmp);
    w.storage = { crop, supported: true, default: "ordinary:fresh", profiles: [], facilities: [{ key: "ordinary", label: "Ordinary farm storage" }], plans: { "ordinary:fresh": p } };
    w.comparison = cmp;
    return forecast({ series: { state: "Maharashtra", market: "APMC Mumbai", commodity: crop, variety: "Other" }, window: w });
  };
  const blockedFor = (crop) => {
    const w = makeWindow({ ok: () => false });
    w.validation = { mode: "context_only", band: "8-14", reasons: ["no"], validated_up_to_days: 0 };
    w.storage = { crop, supported: true, default: "ordinary:fresh", profiles: [], facilities: [{ key: "ordinary", label: "Ordinary farm storage" }],
      plans: { "ordinary:fresh": planFor(crop, 14, w.comparison) } };
    return forecast({ series: { state: "Maharashtra", market: "APMC Mumbai", commodity: crop, variety: "Other" }, window: w, policy: { mode: "context_only", band: "8-14", reasons: ["no"] } });
  };

  it.each(CROPS)("%s: four cards, Why this date and the Storage advice panel, with a valid later date recommended", (crop) => {
    renderPage(build(crop, "alt"));
    for (const id of ["sw-planned", "sw-rec", "sw-diff", "sw-wait"]) expect(screen.getByTestId(id)).toBeTruthy();
    expect(text("sell-chip")).toBe("A later date has a higher predicted price");
    expect(text("sw-planned")).toContain("₹2,520");
    expect(text("sw-rec")).toContain("Recommended");
    expect(text("sw-rec")).toContain("15 Nov 2026");
    expect(text("sw-rec")).toContain("₹2,650");
    expect(text("sw-diff")).toContain("+₹130");
    expect(text("sw-diff")).toContain("5.2%");
    expect(text("sw-diff")).toContain("before costs");
    expect(text("sw-wait")).toContain("11 days");
    expect(text("sell-why")).toBe("The predicted price on 15 Nov is ₹130/quintal (5.2%) higher than your planned date.");
    const panel = text("storage-advice");
    expect(panel).toContain("Storage advice");
    expect(text("sa-line1")).toBe(`${crop}: About 14 days for ${crop} under ordinary farm storage. Ordinary farm storage is assumed. The estimate is approximate.`);   // this crop's own plan
    expect(panel).toContain("Ordinary farm storage");
    expect(text("sa-line2")).toBe(`Waiting 11 days is within the estimated limit. Check ${crop} daily.`);
  });

  it.each(CROPS)("%s: a higher price after the storage deadline is not recommended and the banner says so", (crop) => {
    renderPage(build(crop, "beyond"));
    expect(text("sell-chip")).toBe("The higher-price date exceeds the safe storage period");
    expect(text("sw-rec")).toContain("4 Nov 2026");       // the planned date stays the recommendation
    expect(text("sw-diff")).toContain("₹0/quintal");
    expect(text("sw-wait")).toContain("0 days");
    expect(text("sell-why")).toContain("not worth the risk");
    expect(text("sa-line2")).toContain("waiting is not recommended");
  });

  it.each(CROPS)("%s: no better alternative keeps the planned date as the best option", (crop) => {
    renderPage(build(crop, "none"));
    expect(text("sell-chip")).toBe("Your planned date is the best available option");
    expect(text("sa-line2")).toContain("No waiting is recommended");
  });

  it.each(CROPS)("%s: without a validated forecast all four cards stay, nothing is invented, and the panel still shows", (crop) => {
    renderPage(blockedFor(crop));
    for (const id of ["sw-planned", "sw-rec", "sw-diff", "sw-wait"]) expect(screen.getByTestId(id)).toBeTruthy();
    expect(text("sell-chip")).toBe("No validated forecast to compare");
    expect(text("sw-planned")).toContain("4 Nov 2026");
    expect(text("sw-planned")).toContain("Unavailable");
    expect(text("sw-rec")).not.toContain("Recommended");
    for (const id of ["sw-rec", "sw-diff", "sw-wait"]) expect(text(id)).toContain("Unavailable");
    expect(text("sw-diff")).not.toMatch(/₹\d/);
    expect(text("sell-why")).toBe("No reliable forecast is available to compare selling dates.");
    expect(text("sa-line1")).toContain(`${crop}: About 14 days for ${crop}`);
    expect(text("sa-line2")).toContain("No dates are compared");
  });

  it.each(CROPS)("%s: Why this date is one short sentence and Storage advice is a heading plus exactly two lines", (crop) => {
    for (const f of [build(crop, "alt"), build(crop, "beyond"), build(crop, "none"), blockedFor(crop)]) {
      const { unmount } = renderPage(f);
      const why = text("sell-why");
      expect(why.length).toBeLessThan(110);
      expect(why.match(/[.!?](\s|$)/g)).toHaveLength(1);
      const panel = screen.getByTestId("storage-advice");
      expect([...panel.children].map((e) => e.tagName)).toEqual(["H3", "P", "P"]);
      expect(text("sa-line1")).toContain(crop);
      unmount();
    }
  });
  it("without any storage plan the panel still has two lines and says the figure is approximate", () => {
    const f = build("Cabbage", "alt");
    f.window.storage = null;
    f.window.comparison = alt("Cabbage");
    renderPage(f);
    expect([...screen.getByTestId("storage-advice").children]).toHaveLength(3);
    expect(text("sa-line1")).toContain("approximate");
  });

  it("the cards sit in one grid that is four columns wide, two on medium and one on small screens", () => {
    renderPage(build("Cabbage", "alt"));
    const grid = screen.getByTestId("sell-four");
    expect(grid.className).toContain("sell-summary");
    expect(grid.children).toHaveLength(4);
    const css = require("node:fs").readFileSync("src/index.css", "utf8");
    expect(css).toMatch(/\.sell-summary \{[^}]*repeat\(4, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/max-width: 960px\) \{\s*\.sell-summary \{ grid-template-columns: repeat\(2/);
    expect(css).toMatch(/max-width: 640px\) \{\s*\.sell-summary[^}]*minmax\(0, 1fr\)/);
  });
});
