// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
// the charts are tested in their own files; here only the props the page passes matter
vi.mock("../components/price/SimplePriceChart", () => ({
  default: (p) => <div data-testid="chart" data-ctx={String(p.ctxOnly)} data-selected={String(p.selected?.price)} data-observed={String((p.forecast.observed || []).length)} />,
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
  it("shows the Historical and Expected Market Price graph, with the forecast allowed", () => {
    renderPage(forecast({ observed: [{ date: "2025-12-30", price: 2000 }] }));
    expect(screen.getByRole("heading", { name: /How Much Might My Crop Sell For?/ })).toBeTruthy();
    const chart = screen.getByTestId("chart");
    expect(chart.getAttribute("data-ctx")).toBe("false");
    expect(chart.getAttribute("data-observed")).toBe("1");
  });

  it("a blocked crop passes the history-only flag, so no expected line can be drawn", () => {
    renderPage(blocked());
    expect(screen.getByTestId("chart").getAttribute("data-ctx")).toBe("true");
  });

  it("never shows the old large blue information box", () => {
    renderPage(blocked());
    expect(document.querySelector(".alert-info")).toBeNull();
    expect(screen.queryByTestId("chart-notice")).toBeNull();
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

describe("first page order and content", () => {
  it("shows the summary, Graph 1, Graph 2, then the button, in that order, with the field conditions inside the Graph 2 card", () => {
    renderPage(forecast());
    const order = ["step-price", "step-chart", "step-factors"].map((id) => document.getElementById(id));
    const btn = screen.getByTestId("why-button");
    const follow = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follow(order[0], order[1])).toBe(true);
    expect(follow(order[1], order[2])).toBe(true);
    expect(follow(order[2], btn)).toBe(true);
    expect(screen.queryByText(/Weather at your market/)).toBeNull();
    expect(screen.getByRole("heading", { name: /What Affects Your Crop Price\?/ })).toBeTruthy();
  });
  it("the button is the last thing on the page: nothing follows it", () => {
    renderPage(forecast());
    const btn = screen.getByTestId("why-button");
    const card = screen.getByTestId("explain-card");
    expect(card.lastElementChild).toBe(btn);                       // the hint sits above the button, never below it
    const main = card.parentElement;
    expect(main.lastElementChild).toBe(card);                       // no card, paragraph or table after it
    expect(document.querySelector(".price-disclaimer")).toBeNull();
  });
  it("the summary names crop, market and date once, and the button has the requested wording", () => {
    renderPage(forecast());
    expect(screen.getByTestId("summary-line").textContent).toContain("APMC Mumbai");
    expect(screen.getByTestId("why-button").textContent).toContain("Explain My Prediction");
    expect(body()).toContain("Discover what the price history shows and which factors influenced your predicted price.");
    expect(document.getElementById("step-market")).toBeNull();
  });
  it("a blocked crop gets no factor bars, and a missing explanation does not break the page", async () => {
    priceService.explain.mockRejectedValue(new Error("x"));
    renderPage(blocked());
    expect(await screen.findByTestId("fb-unavailable")).toBeTruthy();
    expect(screen.queryByTestId("factor-bars")).toBeNull();
  });
});

describe("latest actual price and the explanation button", () => {
  it("shows the latest actual market price with its own date, never as today's price", () => {
    renderPage(forecast());
    const n = screen.getByTestId("latest-actual").textContent;
    expect(n).toContain("Latest actual market price");
    expect(n).toContain("31 Dec 2025");
  });
});

describe("Field Conditions on the result page", () => {
  const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  it("is its own compact card after Graph 2 and before Smart Selling and the button, with automatic weather and soil-map values", async () => {
    priceService.weatherContext.mockResolvedValue({ status: "forecast", market: "APMC Mumbai", date: PLANNED, temperature_c: 30.5, rainfall_mm: 1.2, humidity_pct: 61, place: "Mumbai (town centre)" });
    priceService.soilContext.mockResolvedValue({ status: "estimate", market: "APMC Mumbai", ph: 6.5, soil_type: "Vertisols", place: "Mumbai (town centre)" });
    renderPage(forecast());
    const box = await screen.findByTestId("field-conditions");
    const card = document.getElementById("step-conditions");
    expect(card.closest("section").contains(box)).toBe(true);
    expect(document.getElementById("step-factors").closest("section").contains(box)).toBe(false);    // not inside the SHAP graph's card
    const order = ["step-price", "step-chart", "step-factors", "step-conditions", "step-sell"].map((id) => document.getElementById(id));
    for (let i = 0; i < order.length - 1; i++) expect(follows(order[i], order[i + 1])).toBe(true);
    expect(follows(order.at(-1), screen.getByTestId("why-button"))).toBe(true);
    expect(card.textContent).toContain("Field Conditions");
    await waitFor(() => expect(screen.getByTestId("fc-temperature-value").textContent).toBe("30.5 °C"));
    await waitFor(() => expect(screen.getByTestId("fc-ph-value").textContent).toBe("6.5"));
    expect(screen.getByTestId("fc-soil-value").textContent).toBe("Vertisols");
    expect(priceService.weatherContext).toHaveBeenCalledWith("APMC Mumbai", PLANNED, null);   // an older result: no growing location
    expect(priceService.soilContext).toHaveBeenCalledWith("APMC Mumbai", null);
  });
  it("the long explanations are not on the result page: they live on the Explain My Prediction page", async () => {
    renderPage(forecast());
    await screen.findByTestId("field-conditions");
    expect(screen.queryByTestId("condition-meanings")).toBeNull();
    expect(screen.queryByText(/What Do These Conditions Mean/)).toBeNull();
  });
  it("a failed or empty soil lookup shows Unavailable and the prediction page still works", async () => {
    priceService.soilContext.mockRejectedValue(new Error("down"));
    renderPage(forecast());
    await waitFor(() => expect(screen.getByTestId("fc-ph-value").textContent).toBe("Unavailable"));
    expect(screen.getByTestId("fc-soil-value").textContent).toBe("Unavailable");
    expect(screen.getByTestId("hero-price").textContent).toContain("2,520");
    expect(screen.getByTestId("why-button")).toBeTruthy();
  });
  it("the SHAP graph's card holds no field-condition values", async () => {
    renderPage(forecast());
    await screen.findByTestId("field-conditions");
    expect(document.getElementById("step-factors").closest("section").querySelector("[data-testid=field-conditions]")).toBeNull();
  });
});

describe("environmental factors from the prediction response", () => {
  it("uses the factors that came with the prediction and does not fetch them again", async () => {
    const env = {
      used_by_price_model: false,
      weather: { status: "forecast", market: "APMC Mumbai", date: PLANNED, temperature_c: 27.4, rainfall_mm: 0.4, humidity_pct: 71, place: "Mumbai (town centre)",
        source: "Open-Meteo weather forecast", served_from: "cache", retrieved_at: "2026-10-23T08:00:00+00:00" },
      soil: { status: "estimate", ph: 6.9, soil_type: "Vertisols", ph_scope: "surrounding_area", ph_area_km: 2, served_from: "cache", retrieved_at: "2026-10-22T08:00:00+00:00" },
    };
    renderPage(forecast({ environmental_factors: env }));
    await screen.findByTestId("field-conditions");
    expect(screen.getByTestId("fc-temperature-value").textContent).toBe("27.4 °C");
    expect(screen.getByTestId("fc-ph-value").textContent).toBe("6.9");
    expect(screen.getByTestId("fc-note-weather").textContent).toBe("Temperature, humidity and rainfall are the forecast for 4 Nov 2026.");
    expect(screen.getByTestId("field-conditions").textContent).not.toMatch(/Open-Meteo|SoilGrids|saved 23 Oct/);
    expect(priceService.weatherContext).not.toHaveBeenCalled();
    expect(priceService.soilContext).not.toHaveBeenCalled();
  });
  it("partial factors keep the valid values and mark only the missing ones unavailable", async () => {
    const env = { weather: { status: "unavailable", reason: "service_unreachable", temperature_c: null },
      soil: { status: "estimate", ph: null, soil_type: "Vertisols", ph_reason: "not_in_map", served_from: "live" } };
    renderPage(forecast({ environmental_factors: env }));
    await screen.findByTestId("field-conditions");
    expect(screen.getByTestId("fc-temperature-value").textContent).toBe("Unavailable");
    expect(screen.getByTestId("fc-ph-value").textContent).toBe("Unavailable");
    expect(screen.getByTestId("fc-soil-value").textContent).toBe("Vertisols");
    expect(screen.getByTestId("fc-location-value").textContent).toBe("Not provided");
  });
});
