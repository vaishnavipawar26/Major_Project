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
    expect(text("sw-rec")).toContain("11 Nov 2026");
    expect(text("sw-rec")).toContain("7 days after your planned date");
    expect(text("sw-price")).toContain("₹2,772");
    expect(text("sw-high")).toContain("₹2,772");
    expect(text("sw-high")).toContain("Same as the recommended date");
    expect(text("sw-diff")).toContain("+₹252");
    expect(text("sw-diff")).toContain("+10.0%");
    expect(text("sw-wait")).toContain("7 days");
    expect(text("sell-why")).toBe("The model predicts a higher price on 11 November 2026 than on your planned date. The estimated difference is ₹252 per quintal (10.0%).");
  });
  it("says so when the planned date already has the highest predicted price", () => {
    renderPage(forecast());
    expect(screen.getByTestId("sell-card").getAttribute("data-outcome")).toBe("planned_is_best");
    expect(text("sell-why")).toBe("Your planned date already has the highest predicted price in this forecast window.");
    // the planned date is the recommendation: stated plainly, with a zero difference and no waiting, never "None needed" or dashes
    expect(text("sw-rec")).toContain("Your planned date");
    expect(text("sw-price")).toContain("₹2,520");
    expect(text("sw-diff")).toContain("₹0/quintal compared with your planned date");
    expect(text("sw-wait")).toContain("0 days");
    expect(screen.getByTestId("sell-card").textContent).not.toMatch(/None needed/);
  });
  it("recommends no date when nothing can be compared", () => {
    renderPage(forecast({ window: makeWindow({ ok: () => false }) }));
    expect(text("sw-rec")).toContain("No date can be recommended");
    // none of the price / difference / time-left cells (they would only be dashes) and no reliability wording
    for (const id of ["sw-price", "sw-high", "sw-diff", "sw-wait", "sw-left"]) expect(screen.queryByTestId(id)).toBeNull();
    expect(screen.getByTestId("sell-card").textContent).not.toMatch(/reliable enough|accuracy tests|Past tests/i);
  });
  it("does not substitute another date when the planned date is outside the window", () => {
    const w = makeWindow();
    w.planned = { ...w.planned, in_window: false };
    w.comparison = { code: "outside_window", reason: "planned_outside_window", date: null, price: null, diff: null, diff_pct: null, wait_days: null };
    renderPage(forecast({ window: w }));
    expect(text("sell-why")).toContain("outside the 30-day forecast window");
  });
  it("keeps storage advice and does not show the profit disclaimer", () => {
    renderPage(forecast());
    expect(text("sell-store")).toContain("Ripe tomatoes keep about a week.");
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
    expect(screen.queryByTestId("sell-why")).toBeNull();
    expect(card.querySelector(".sell-why")).toBeNull();                       // the whole "Why this date?" box is left out, not shown empty
    expect(text("sw-rec")).toContain("No date can be recommended");
    expect(text("sell-store")).toContain("Storage advice");                   // storage advice stays
  });

  it("never turns experimental estimates into prices on the selling card", () => {
    const w = blockedWindow();
    w.experimental = { validated: false, planned: { date: PLANNED, status: "validated", price: 2400 },
      comparison: { code: "alternative", reason: null, date: "2026-11-11", price: 2640, diff: 240, diff_pct: 10, wait_days: 7, beyond_storage: null } };
    renderPage(blocked({ window: w }));
    const card = screen.getByTestId("sell-card");
    expect(card.getAttribute("data-experimental")).toBeNull();
    expect(card.textContent).not.toMatch(/Experimental|2,640|raw estimates|accuracy tests/);
    expect(screen.queryByTestId("sw-price")).toBeNull();
    expect(text("sw-rec")).toContain("No date can be recommended");
  });

  it("a validated comparison is never replaced by an experimental one", () => {
    const w = makeWindow({ price: (d) => (d === PLANNED ? 2520 : d === "2026-11-11" ? 2772 : 2400) });
    w.experimental = { validated: false, planned: { date: PLANNED, status: "validated", price: 1 }, comparison: { code: "alternative", date: "2026-11-30", price: 9999, diff: 9998, diff_pct: 9, wait_days: 26 } };
    renderPage(forecast({ window: w }));
    expect(screen.getByTestId("sell-card").getAttribute("data-experimental")).toBeNull();
    expect(text("sw-price")).toContain("₹2,772");
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
    expect(text("sw-price")).toContain("₹2,520");
    expect(text("sw-high")).toContain("₹2,900");
    expect(text("sw-high")).toContain("23 Nov 2026");
    expect(text("sw-high")).toContain("after your storage limit, so not recommended");
    expect(text("sw-diff")).toContain("₹0/quintal compared with your planned date");
    expect(text("sw-wait")).toContain("0 days");
    expect(text("sw-survival")).toContain("About 2 days");
    expect(text("sw-left")).toContain("2 days");
    expect(text("sell-why")).toContain("is on 23 November 2026, 19 days after your planned date");
    expect(text("sell-why")).toContain("about 2 days after your planned date, until 6 November 2026");
    expect(text("sell-why")).toContain("Waiting for it is not recommended");
    expect(text("sw-differs")).toContain("highest price comes after the storage limit");
    expect(text("ss-uncertainty")).toContain("approximate");
    expect(text("ss-advice")).toContain("Keep brinjal in shade");
    expect(screen.getByTestId("ss-sources").querySelector("a").getAttribute("href")).toBe("https://example.org/nhb_brinjal");
  });

  it("the card and the chart read the same prices, and the chart names the storage limit", () => {
    renderPage(forecast({ window: brinjal() }));
    expect(text("pf-high")).toContain("₹2,900");
    expect(text("pf-high")).toContain("23 Nov 2026");
    expect(text("sw-high")).toContain("₹2,900");
    expect(text("pf-planned")).toContain("₹2,520");
    expect(text("sw-planned")).toContain("₹2,520");
    expect(text("pf-beyond")).toContain("after the estimated storage limit for this crop, so it is shown but not recommended");
    expect(text("pf-legend")).toMatch(/Your planned date.*Highest predicted price.*Estimated storage limit/);
  });

  it("choosing storage the farmer really has can change the recommended date", () => {
    const w = withStorage({
      "ordinary:fresh": plan({ crop: "Tomato", hold_days: 7, deadline: "2026-11-11", comparison: planned({ deadline: "2026-11-11", days_left: 7, beyond_storage: { date: NEAR, price: 2750 } }) }),
      "improved:fresh": plan({ crop: "Tomato", facility: "improved", facility_used: "improved", facility_label: "Evaporative cool chamber", hold_days: 14, deadline: "2026-11-18",
        comparison: later({ deadline: "2026-11-18", days_left: 1 }) }),
      "cold:fresh": plan({ crop: "Tomato", facility: "cold", facility_used: "cold", facility_label: "Cold room at about 13 °C", hold_days: 14, deadline: "2026-11-18",
        comparison: later({ deadline: "2026-11-18", days_left: 1 }) }),
    });
    renderPage(forecast({ window: w }));
    expect(text("sw-rec")).toContain("Your planned date");                      // the default assumes nothing beyond ordinary farm storage
    expect(screen.getByTestId("ss-facility-ordinary").getAttribute("aria-checked")).toBe("true");
    expect(text("ss-facility-improved")).toContain("Holds about 14 days");           // each choice shows what it changes
    fireEvent.click(screen.getByTestId("ss-facility-improved"));
    expect(text("sw-rec")).toContain("17 Nov 2026");
    expect(text("sw-price")).toContain("₹2,750");
    expect(text("sw-diff")).toContain("+₹230");
    expect(text("sw-wait")).toContain("13 days");
    expect(text("sw-survival")).toContain("About 14 days");
    expect(text("sw-left")).toContain("1 day");
    expect(text("sell-why")).toContain("within the estimated storage limit for Tomato (Evaporative cool chamber): about 14 days after your planned date");
    expect(text("pf-legend")).toContain("Recommended selling date");              // the chart gets the new marker for the same choice
    fireEvent.click(screen.getByTestId("ss-facility-ordinary"));
    expect(screen.getByTestId("ss-facility-improved").getAttribute("aria-checked")).toBe("false");
    expect(text("sw-rec")).toContain("Your planned date");
  });

  it("asks about the produce condition only for crops where it matters, and treats damp or uncured stock as not storable", () => {
    renderPage(forecast({ window: brinjal() }));
    expect(screen.queryByTestId("ss-profile")).toBeNull();                      // fresh vegetables: no dry/cured question
    cleanup();
    const profiles = [{ key: "cured", label: "Well-cured, dry onion bulbs" }, { key: "uncured", label: "Not cured, wet or freshly harvested onion" }];
    const w = withStorage({
      "ordinary:cured": plan({ crop: "Onion", profile: "cured", profile_label: "Well-cured, dry onion bulbs", hold_days: 120, deadline: "2027-03-04", range: "about 4 months, with heavy weight loss",
        comparison: later({ deadline: "2027-03-04", days_left: 111, highest: { date: FAR, price: 2900, within_storage: true } }) }),
      "ordinary:uncured": plan({ crop: "Onion", profile: "uncured", profile_label: "Not cured, wet or freshly harvested onion", hold_days: 0, deadline: PLANNED,
        basis: "App rule, not a measured storage time.", range: "no safe holding time is known", comparison: planned({ deadline: PLANNED, days_left: 0 }) }),
    }, profiles, "ordinary:cured");
    w.storage.facilities = w.storage.facilities.slice(0, 1);
    w.comparison = w.storage.plans["ordinary:cured"].comparison;
    renderPage(forecast({ window: w }));
    expect(screen.getByTestId("ss-profile-cured").getAttribute("aria-checked")).toBe("true");
    expect(text("sw-survival")).toContain("About 120 days");
    fireEvent.click(screen.getByTestId("ss-profile-uncured"));
    expect(text("sw-rec")).toContain("Your planned date");
    expect(text("sw-survival")).toContain("No safe holding time");
    expect(text("sell-why")).toContain("is not advised to be held");
  });

  it("says when a storage choice has no reliable figure and another facility's figure is used", () => {
    const w = withStorage({
      "ordinary:fresh": plan({ comparison: planned() }),
      "improved:fresh": plan({ facility: "improved", facility_used: "ordinary", fallback: true, comparison: planned() }),
    });
    renderPage(forecast({ window: w }));
    fireEvent.click(screen.getByTestId("ss-facility-improved"));
    expect(text("ss-fallback")).toContain("There is no reliable storage figure for Tomato");
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
    expect(text("sw-survival")).toContain("60 days");
  });
});
