// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/priceService", () => ({ priceService: { explain: vi.fn() } }));
vi.mock("../services/historyService", () => ({ historyService: { priceItem: vi.fn() } }));
vi.mock("../services/api", () => ({ errorMessage: (e) => e.message }));

import { priceService } from "../services/priceService";
import PriceExplanation from "./PriceExplanation";

const group = (g, over = {}) => ({ group: g, available: true, reading: null, plain: "", detail: "", missing: null, used: true,
  inr_effect: 0, inr_effect_rounded: 0, agreement: null, ...over });
const GROUPS = () => ({
  seasonal: group("seasonal", { reading: "down", plain: "prices usually fell about 12% in earlier years", detail: "Over the same 18 days (17 Oct to 4 Nov) the price changed −15% in 2024 and −9% in 2023.",
    inr_effect: 20, inr_effect_rounded: 20, agreement: "disagree" }),
  trend: group("trend", { reading: "up", plain: "price up 33% in 30 days", detail: "Over the 30 days to 23 Oct 2025 the price moved +33%, and +40% over 90 days.", inr_effect: 80, inr_effect_rounded: 80, agreement: "agree" }),
  last_year: group("last_year", { used: false, inr_effect: null, inr_effect_rounded: null, plain: "26% lower than a year ago", detail: "On 23 Oct 2025 the price was 26% lower than on 23 Oct 2024, a year earlier." }),
  market: group("market", { reading: null, plain: "28% above the Maharashtra median", detail: "APMC Pune's price averaged 28% above the Maharashtra median for Tomato over 27 Jul–23 Oct 2025 (₹2,096 vs ₹1,637, 71 reporting days).",
    inr_effect: -410, inr_effect_rounded: -410 }),
  supply: group("supply", { reading: "down", plain: "35% more arrivals than usual", detail: "Reported arrivals at APMC Pune, 24 Sep–23 Oct 2025: 412 a day (as reported), 35% above the October average of 2023 and 2024 (305 a day).",
    inr_effect: -3, inr_effect_rounded: -3 }),
});
const card = (g, inr) => ({ group: g, title: g, inr_effect: inr, inr_effect_rounded: inr });
const v3 = (over = {}) => ({
  schema_version: 3,
  banner: { text: "No 2026 market data yet", detail: "d", reference_date: "2025-10-23" },
  headline: { code: "about_the_same", text: "x", predicted_price: 2450, start_price: 2400, change_inr: 50, change_pct: 2.08, typical_miss_inr: 790,
    range: [2100, 2900], range_hidden: false, range_coverage_pct: 73.4, target_date: "2026-11-04", horizon_days: 18, band: "15-30",
    horizon: { days_from_today: 12, counted_from: "2025-10-17", covers_days: 18, differs: true } },
  display: { groups: GROUPS() },
  cards: [card("market", -410), card("trend", 80), card("seasonal", 20), card("supply", -3)],
  other_factors: { inr_total: -30, inr_total_rounded: -30, text: "o", parts: [{ label: "Current price level", inr: -41.4, meaning: null }, { label: "This crop's usual behaviour in past data", inr: -79, meaning: null }], swing_evidence: null, note: "n" },
  evidence_not_used_by_model: [],
  market_breakdown: { applicable: true, text: "At the median Maharashtra market: ₹2,110. APMC Pune premium: +₹410 (forecasts for 4 Nov 2026).", evidence: "APMC Pune traded 28% above the Maharashtra median." },
  trust: { available: true, n: 3100, baseline: "starting price", mae: 790, wape_pct: 36, direction_acc_pct: 71, n_meaningful_moves: 2800, range_coverage_pct: 73.4, level: "medium", skill_pct: 21.9,
    lines: ["l"], warnings: ["The range was too narrow in past tests."] },
  checks: { inr_sum: 50, predicted_change_inr: 50, reconstruction_error: 1e-7 },
  ...over,
});
const ctxGroups = () => Object.fromEntries(Object.entries(GROUPS()).map(([k, g]) => [k, { ...g, used: false, inr_effect: null, inr_effect_rounded: null, agreement: null }]));
const ctxV3 = () => v3({
  context_only: true, other_factors: null, cards: [], display: { groups: ctxGroups() },
  headline: { code: "no_clear_direction", text: "x", predicted_price: null, start_price: 1890, change_inr: null, change_pct: null, typical_miss_inr: 935, range: null,
    range_hidden: false, range_coverage_pct: null, target_date: "2026-11-04", horizon_days: 18, band: "15-30",
    latest_recorded: { price: 4250, date: "2025-12-31", age_days: 296, stale: true, age_n: 10, age_unit: "months" },
    horizon: { days_from_today: 12, counted_from: "2025-10-17", covers_days: 18, differs: true } },
  trust: { available: true, n: 7874, baseline: "starting price", mae: 935, wape_pct: 44, direction_acc_pct: 58, n_meaningful_moves: 7000, range_coverage_pct: null, level: "low", skill_pct: 1.2, lines: [], warnings: [] },
});
const exp = (over = {}) => ({
  horizon_days: 12, date: "2026-11-04", method: "SHAP", output_space: "log", base_value: 0, base_change_pct: 0, prediction_change_pct: 5, all_small: false,
  summary: { reference_price: 2400, predicted_price: 2450, change_abs: 50, change_pct: 2, direction: "about the same", horizon_days: 12, within_typical_error: true, typical_error_pct: null, headline: "h" },
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
/** The page text without the collapsed technical details (the single-number rule is about what the farmer reads). */
const mainText = () => {
  const root = screen.getByTestId("v3-verdict").closest(".crop-result").cloneNode(true);
  root.querySelector("[data-testid=v3-technical]")?.remove();
  return root.textContent;
};
const count = (text, needle) => text.split(needle).length - 1;
const stepItems = () => Array.from(screen.getByTestId("steps").children);
const stepTitle = (li) => li.querySelector("h3").textContent;
const stepByName = (name) => stepItems().find((li) => stepTitle(li).startsWith(name));

beforeEach(() => priceService.explain.mockReset());
afterEach(cleanup);

describe("summary card", () => {
  it("shows crop · market, the verdict headline, a trust badge and three tiles", () => {
    renderPage();
    const box = screen.getByTestId("v3-verdict");
    expect(box.textContent).toContain("Tomato · APMC Pune");
    expect(screen.getByTestId("v3-headline").textContent).toBe("Price likely to stay about the same: around ₹2,400 per quintal");
    expect(screen.getByTestId("trust-badge").textContent).toContain("Medium");
    expect(screen.getByTestId("tile-sell").textContent).toContain("4 Nov 2026");
    expect(screen.getByTestId("tile-days").textContent).toContain("12 days");
    expect(screen.getByTestId("tile-miss").textContent).toContain("₹790");
  });

  it("says rise or fall only for a rise or fall verdict, with the model estimate in the headline", () => {
    const h = { ...v3().headline, code: "rise", predicted_price: 3000, change_inr: 600, change_pct: 25 };
    renderPage(response(exp({ v3: v3({ headline: h }) })));
    expect(screen.getByTestId("v3-headline").textContent).toBe("Price likely to rise: around ₹3,000 per quintal");
    expect(screen.getByTestId("v3-sub").textContent).toContain("From a starting price of ₹2,400, up ₹600 (25.0%)");
  });

  it("puts the 2025-data notice in one short grey line, not a banner", () => {
    renderPage();
    const n = screen.getByTestId("v3-notice");
    expect(n.textContent).toContain("replays the same season of 2025 records");
    expect(n.className).toContain("xp-sub");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows no notice when the forecast starts from current records", () => {
    renderPage(response(exp({ v3: v3({ banner: null }) })));
    expect(screen.queryByTestId("v3-notice")).toBeNull();
  });
});

describe("why this price: numbered steps", () => {
  it("has five steps; the first four are ordered by the size of the model's rupee effect, then 'How far to trust this'", () => {
    renderPage();
    expect(stepItems().map((li) => stepTitle(li).split("—")[0])).toEqual(["Your market", "Recent prices", "Season", "Supply", "How far to trust this"]);
    expect(stepItems().map((li) => li.querySelector(".xp-num").textContent)).toEqual(["1", "2", "3", "4", "5"]);
    expect(stepTitle(stepItems()[1])).toContain("price up 33% in 30 days");
  });

  it("gives each step a status chip taken from the records, not from the model", () => {
    renderPage();
    const chip = (name) => within(stepByName(name)).getByTestId("step-chip").textContent;
    expect(chip("Supply")).toBe("Points lower");
    expect(chip("Recent prices")).toBe("Points higher");
    expect(chip("Season")).toBe("Points lower");
    expect(chip("Your market")).toBe("Little effect");
  });

  it("shows the model's push in rupees, and 'against this record' only where records and model disagree", () => {
    renderPage();
    const push = (name) => within(stepByName(name)).getByTestId("step-push").textContent;
    expect(push("Season")).toContain("The model pushed the forecast up by about ₹20.");
    expect(push("Season")).toContain("against this record");
    expect(push("Recent prices")).not.toContain("against this record");
    expect(push("Supply")).toBe("The model gave this almost no weight.");
  });

  it("has no 'Records vs model' or 'For information' boxes", () => {
    renderPage();
    expect(mainText()).not.toMatch(/Records vs model|For information|Agree|Disagree/);
  });

  it("says in one line when a step has no data, and keeps its number", () => {
    const groups = GROUPS();
    groups.supply = group("supply", { available: false, missing: "No arrivals were reported in the 30 days before the start date.", used: true });
    renderPage(response(exp({ v3: v3({ display: { groups } }) })));
    const supply = stepByName("Supply");
    expect(supply.textContent).toContain("No data");
    expect(supply.textContent).toContain("No arrivals were reported in the 30 days before the start date.");
    expect(within(supply).queryByTestId("step-chip")).toBeNull();
  });
});

describe("single-number rule and plain words", () => {
  it("shows the starting price, model estimate, change, range, days ahead and typical miss once each on the main page", () => {
    renderPage();
    const text = mainText();
    for (const n of ["₹2,400", "₹2,450", "₹50", "₹2,100 – ₹2,900", "12 days", "₹790"]) expect([n, count(text, n)]).toEqual([n, 1]);
  });

  it("uses no jargon on the main page", () => {
    renderPage();
    expect(mainText()).not.toMatch(/SHAP|baseline|backtest|model ratio|reference year|reference-year/i);
  });
});

describe("AI's final explanation", () => {
  it("is one templated paragraph: verdict, signals, disagreement, typical miss logic and the mandi-price advice", () => {
    renderPage();
    const box = screen.getByTestId("final-explanation");
    expect(within(box).getByRole("heading", { name: "AI's final explanation" })).toBeTruthy();
    const p = box.querySelector("p").textContent;
    expect(p).toContain("Tomato is expected to stay about the same as the starting price.");
    expect(p).toContain("The records lean higher on recent prices and lower on the season and supply.");
    expect(p).toContain("The model pushed against the season");
    expect(p).toContain("typical miss is bigger than this difference");
    expect(p).toContain("check the current mandi price before selling");
    expect(p.split(/(?<=\.)\s/).length).toBeLessThanOrEqual(4);
  });
});

describe("technical details", () => {
  it("is collapsed and holds the rupee table with other factors, the market vs Maharashtra, test counts and the trust rule", () => {
    renderPage();
    const d = screen.getByTestId("v3-technical");
    expect(d.tagName).toBe("DETAILS");
    expect(d.hasAttribute("open")).toBe(false);
    expect(d.textContent).toContain("Current price level");
    expect(d.textContent).toContain("This crop's usual behaviour in past data");
    expect(screen.getByTestId("v3-market").textContent).toContain("APMC Pune premium: +₹410");
    expect(d.textContent).toContain("3,100 past test forecasts");
    expect(d.textContent).toContain("starting price");
    expect(d.textContent).toContain("Trust rule: High");
    expect(screen.getByTestId("v3-horizon").textContent).toContain("so the estimate covers 18 days");
  });
});

describe("range", () => {
  it("shows the range once, without a coverage figure, and says so when it was hidden", () => {
    renderPage();
    expect(screen.getByTestId("v3-sub").textContent).toContain("Range ₹2,100 – ₹2,900.");
    cleanup();
    renderPage(response(exp({ v3: v3({ headline: { ...v3().headline, range: null, range_hidden: true } }) })));
    expect(screen.getByTestId("v3-sub").textContent).toContain("Range not shown");
  });
});

describe("context-only crops", () => {
  it("keeps the layout with the 'no forecast' headline, the latest recorded price and no badge", () => {
    renderPage(response(exp({ v3: ctxV3() })));
    expect(screen.getByTestId("v3-headline").textContent).toBe("No forecast for this crop — here is what the records show");
    expect(screen.getByTestId("v3-sub").textContent).toBe("Latest recorded price: ₹4,250 (31 Dec 2025, 10 months ago). No forecast for this crop.");
    expect(screen.queryByTestId("trust-badge")).toBeNull();
    expect(screen.getByRole("heading", { name: "What the records show" })).toBeTruthy();
    expect(stepItems().length).toBe(5);
  });

  it("shows the records with status chips but no rupee model lines", () => {
    renderPage(response(exp({ v3: ctxV3() })));
    expect(screen.getAllByTestId("step-chip").length).toBe(4);
    expect(screen.queryAllByTestId("step-push").length).toBe(0);
    expect(mainText()).not.toMatch(/pushed the forecast|against this record/);
    expect(screen.queryByText("Current price level")).toBeNull();
  });

  it("explains in one sentence why there is no forecast, and the final explanation says the same in plain words", () => {
    renderPage(response(exp({ v3: ctxV3() })));
    expect(stepByName("How far to trust this").textContent).toContain("not reliably more accurate than a simple guess (keeping the latest price) for Tomato this far ahead, so no forecast is given.");
    const p = screen.getByTestId("final-explanation").querySelector("p").textContent;
    expect(p).toContain("No forecast is given for Tomato this far ahead");
    expect(p).toContain("Check the current mandi price before selling.");
    expect(mainText()).not.toMatch(/SHAP|baseline|backtest|model ratio|reference year/i);
  });

  it("does not show the estimated starting price anywhere on the main page", () => {
    renderPage(response(exp({ v3: ctxV3() })));
    expect(mainText()).not.toContain("₹1,890");
  });
});
