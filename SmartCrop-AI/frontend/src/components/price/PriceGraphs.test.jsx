// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { cloneElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, ResponsiveContainer: ({ children }) => <div>{cloneElement(children, { width: 900, height: 400 })}</div> };
});

import FactorBars, { axisTicks, orderRows } from "./FactorBars";
import SimplePriceChart, { SHOW_DAYS, chartRows, makeScale, priceAxis } from "./SimplePriceChart";
import FieldConditions from "./FieldConditionsOverview";
import UnderstandPrediction from "./UnderstandPrediction";
import { aboutPct, barRows, calculation, explanationOk, scalePct, splitSteps } from "./factorModel";

afterEach(cleanup);

// ---- synthetic fixtures (clearly not real market data or real model output)
const DAY = 86400000;
const observed = [{ date: "2025-12-20", price: 1000 }, { date: "2025-12-22", price: 1020 }, { date: "2025-12-31", price: 1100 }];
const path = [1, 2, 3].map((i) => ({ date: `2026-11-0${i}`, predicted_price: 1200 + i, beats_baseline: true }));
const base = { observed, chart_path: path, chart_end_date: "2026-11-03", target_date: "2026-11-02", input_date: "2026-10-30" };
const selected = { price: 1201, source: "forecast" };

describe("time axis", () => {
  it("collapses a long stretch without records into one narrow band, and leaves short gaps alone", () => {
    const last = Date.parse("2025-12-31T00:00:00Z"), next = Date.parse("2026-11-01T00:00:00Z");
    const { scale, gap } = makeScale(last, next);
    expect(gap).not.toBeNull();
    expect(scale(last)).toBe(last);
    expect(scale(next) - scale(last)).toBeLessThan(15 * DAY);        // ten months drawn as about 12 days
    expect(scale(next + 2 * DAY) - scale(next)).toBe(2 * DAY);       // real spacing resumes after the gap
    expect(makeScale(last, last + 10 * DAY).gap).toBeNull();
    expect(makeScale(null, next).gap).toBeNull();
  });
});

describe("chartRows", () => {
  it("breaks the line across a long gap instead of joining real reports", () => {
    const rows = chartRows({ observed: [{ date: "2025-10-15", price: 1 }, { date: "2025-12-01", price: 2 }] });   // 47 days apart, inside the window
    expect(rows.some((r) => r.hist === null)).toBe(true);
  });
  it("marks only the last real report as the latest actual price", () => {
    const rows = chartRows({ observed });
    expect(rows.filter((r) => r.last != null)).toHaveLength(1);
    expect(rows.find((r) => r.last != null).real).toBe(Date.parse("2025-12-31T00:00:00Z"));
  });
  it("keeps historical, expected and selected values in separate series and in date order", () => {
    const rows = chartRows({ observed, expected: [{ date: "2026-11-02", price: 1201 }], selected: 1201, targetDate: "2026-11-02" });
    expect(rows.filter((r) => r.hist != null)).toHaveLength(3);
    expect(rows.filter((r) => r.exp != null)).toHaveLength(1);
    expect(rows.filter((r) => r.sel != null)).toHaveLength(1);
    expect(rows.every((r) => r.hist == null || r.exp == null)).toBe(true);
    expect(rows.map((r) => r.x)).toEqual([...rows.map((r) => r.x)].sort((a, b) => a - b));
    expect(rows.map((r) => r.real).filter((v) => v)).toEqual([...rows.map((r) => r.real)].sort((a, b) => a - b));
  });
});

describe("SimplePriceChart", () => {
  it("allowed forecast: one short sentence, the highlighted expected price, no legend or axis captions, and one note saying the latest price is not today's", () => {
    render(<SimplePriceChart forecast={base} ctxOnly={false} selected={selected} crop="Cabbage" market="APMC X" />);
    expect(screen.getByTestId("g1-intro").textContent).toBe("Past prices show what this crop sold for. The highlighted point shows the expected price.");
    expect(screen.getByTestId("expected-point-label").textContent.replace(/\u00a0/g, " ")).toBe("Expected ₹1,201");   // the API's value for the date
    expect(screen.queryByTestId("chart-legend")).toBeNull();                         // no legend: the sentence says what is what
    expect(screen.queryByText("Price (₹/quintal)")).toBeNull();                      // and no axis captions
    expect(screen.queryByText("Date")).toBeNull();
    const note = screen.getByTestId("latest-note").textContent;
    expect(note).toContain("₹1,100 per quintal on 31 Dec 2025");
    expect(note).toContain("not today's price");
    expect(screen.getByTestId("chart-notes").querySelectorAll("p")).toHaveLength(1);   // no extra notes cluttering the chart
  });
  it("does not call a price today's when the latest record is from today", () => {
    render(<SimplePriceChart forecast={{ ...base, input_date: "2025-12-31" }} ctxOnly={false} selected={selected} crop="Cabbage" market="APMC X" />);
    expect(screen.getByTestId("latest-note").textContent).not.toContain("not today's price");
  });
  it("history-only crop: no expected price, series or point, and the reason is stated", () => {
    render(<SimplePriceChart forecast={base} ctxOnly selected={{ price: 990, source: "reference" }} crop="Onion" market="APMC X" />);
    expect(screen.getByTestId("g1-intro").textContent).toBe("Past prices show what this crop sold for. There is no expected price for Onion on this date.");
    expect(screen.getByTestId("simple-chart").textContent).not.toContain("990");        // a past/reference price is never called expected
    expect(screen.queryByTestId("expected-point-label")).toBeNull();
    expect(document.querySelector("[data-testid=simple-chart] svg").textContent).toContain("Selling date");
    expect(screen.getByTestId("no-forecast-line").textContent).toContain("No forecast is shown for Onion");
    expect(document.querySelector(".alert")).toBeNull();
  });
  it("only forecast points that beat the baseline are drawn", () => {
    const f = { ...base, chart_path: path.map((p) => ({ ...p, beats_baseline: false })) };
    render(<SimplePriceChart forecast={f} ctxOnly={false} selected={selected} crop="Cabbage" market="APMC X" />);
    expect(document.querySelectorAll("[data-testid=simple-chart] .recharts-line").length).toBeGreaterThan(0);
  });
  it("no historical prices and no forecast: a short message, no chart", () => {
    render(<SimplePriceChart forecast={{ ...base, observed: [] }} ctxOnly selected={null} crop="Onion" market="APMC X" />);
    expect(screen.getByTestId("no-history")).toBeTruthy();
    expect(screen.queryByTestId("simple-chart")).toBeNull();
    expect(screen.getByTestId("g1-intro").textContent).toContain("There is no expected price for Onion");
  });
  it("past and expected prices are separate series, and only the selling-date point is marked and labelled", () => {
    const rows = chartRows({ observed, expected: path.map((p) => ({ date: p.date, price: p.predicted_price })), selected: 1201, targetDate: "2026-11-02" });
    expect(rows.filter((r) => r.sel != null).map((r) => r.sel)).toEqual([1201]);
    expect(rows.filter((r) => r.hist != null).every((r) => r.exp == null && r.sel == null)).toBe(true);
    render(<SimplePriceChart forecast={base} ctxOnly={false} selected={selected} crop="Cabbage" market="APMC X" />);
    const labels = screen.getAllByTestId("expected-point-label");
    expect(labels).toHaveLength(1);
    expect(labels[0].textContent.replace(/\u00a0/g, " ")).toBe("Expected ₹1,201");
  });
  it("draws only the last 60 days of real history, so the expected part is not squeezed to the edge", () => {
    expect(SHOW_DAYS).toBe(60);
    const long = Array.from({ length: 200 }, (_, i) => ({ date: new Date(Date.UTC(2025, 5, 1) + i * DAY).toISOString().slice(0, 10), price: 1000 + i }));
    const hist = chartRows({ observed: long }).filter((r) => r.hist != null);
    expect(hist.at(-1).real - hist[0].real).toBeLessThan(SHOW_DAYS * DAY);
    expect(hist.at(-1).hist).toBe(1199);                               // real values, unchanged
  });
});

// synthetic explanation: base 0.01, contributions in log units, output = base + sum
const local = (over = {}) => ({
  start_price: 1000, baseline_inr: 10, baseline_price: 1010, end_price: 1040.8, forecast_price: 1040.8, matches_forecast: true,
  steps: [
    { group: "season", title: "Seasonal pattern", help: "h", inr: -20, log_contribution: -0.02, direction: "down" },
    { group: "price_level", title: "Current price level", help: "h", inr: 45, log_contribution: 0.04, direction: "up" },
    { group: "arrivals", title: "Market arrivals (supply)", help: "h", inr: 5, log_contribution: 0.005, direction: "up" },
  ], ...over,
});
const exp = (over = {}) => ({ base_value: 0.01, date: "2026-11-02", technical: { reconstruction_ok: true, model_output_log: 0.035 }, charts: { local: local() }, ...over });

describe("factorModel (model units, not rupees)", () => {
  it("scalePct: a guidance value's place on its own scale, never invented for a category or without a min/max", () => {
    expect(scalePct("humidity", 61)).toBe(61);
    expect(scalePct("ph", 6.8)).toBe(49);
    expect(scalePct("temperature", 25, { temperature_min_c: 15, temperature_max_c: 35 })).toBe(50);
    expect(scalePct("temperature", 40, { temperature_min_c: 15, temperature_max_c: 35 })).toBe(100);   // clamped
    expect(scalePct("temperature", 10, { temperature_min_c: 15, temperature_max_c: 35 })).toBe(0);
    expect(scalePct("temperature", 25, {})).toBeNull();                                             // no min/max: the plain value
    expect(scalePct("temperature", 25, { temperature_min_c: null, temperature_max_c: 35 })).toBeNull();
    expect(scalePct("temperature", 25, { temperature_min_c: 30, temperature_max_c: 30 })).toBeNull();
    expect(scalePct("soil", "Vertisols")).toBeNull();
    expect(scalePct("location", "Nashik")).toBeNull();
    expect(scalePct("ph", null)).toBeNull();
  });
  it("orders bars by SHAP size, folds the small ones into one and keeps every value", () => {
    const many = local({ steps: Array.from({ length: 10 }, (_, i) => ({ group: `g${i}`, title: `G${i}`, help: "", log_contribution: (i + 1) / 100 })) });
    const rows = barRows(many, 6);
    expect(rows).toHaveLength(7);
    expect(rows[0].value).toBeCloseTo(0.1);
    expect(rows.at(-1).key).toBe("other");
    expect(rows.at(-1).value).toBeCloseTo(0.01 + 0.02 + 0.03 + 0.04);
  });
  it("splits real rises and falls", () => {
    const { up, down } = splitSteps(local());
    expect(up.map((s) => s.group)).toEqual(["price_level", "arrivals"]);
    expect(down.map((s) => s.group)).toEqual(["season"]);
  });
  it("the calculation adds up to the model output, and a mismatch is caught", () => {
    const c = calculation(exp());
    expect(c.sum).toBeCloseTo(0.025);
    expect(c.ok).toBe(true);
    expect(c.price).toBeCloseTo(1000 * Math.exp(0.035), 6);
    expect(calculation(exp({ technical: { model_output_log: 0.2 } })).ok).toBe(false);
  });
  it("a log value means about that percent on the price", () => {
    expect(aboutPct(0.05)).toBeCloseTo(5.127, 2);
  });
  it("trusts an explanation only for an allowed crop that adds up", () => {
    expect(explanationOk(exp(), false)).toBe(true);
    expect(explanationOk(exp(), true)).toBe(false);
    expect(explanationOk(exp({ technical: { reconstruction_ok: false } }), false)).toBe(false);
    expect(explanationOk(exp({ charts: { local: local({ matches_forecast: false }) } }), false)).toBe(false);
    expect(explanationOk(exp({ v3: { context_only: true } }), false)).toBe(false);
    expect(explanationOk(null, false)).toBe(false);
  });
});

describe("FactorBars (What Affects Your Crop Price?)", () => {
  it("puts the factors that push the price higher first, tallest first, then the ones pushing it lower, 'Other' last", () => {
    const rows = orderRows([{ key: "a", value: -0.03 }, { key: "other", value: 0.001 }, { key: "b", value: 0.05 }, { key: "c", value: 0.01 }, { key: "d", value: -0.01 }]);
    expect(rows.map((r) => r.key)).toEqual(["b", "c", "d", "a", "other"]);
  });
  it("axis ticks are evenly spaced and always include zero", () => {
    const t = axisTicks(-0.0446, 0.0742);
    expect(t).toContain(0);
    expect(t[1] - t[0]).toBeCloseTo(t[2] - t[1], 9);
    expect(Math.min(...t)).toBeGreaterThanOrEqual(-0.0446);
    expect(Math.max(...t)).toBeLessThanOrEqual(0.0742);
  });
  it("draws the chart with its legend and no extra explanation text below it, and no plus signs or percentages beside the bars", () => {
    render(<FactorBars exp={exp()} ctxOnly={false} crop="Cabbage" />);
    const root = screen.getByTestId("factor-bars");
    expect(screen.getByTestId("fb-legend").textContent).toBe("Pushes the price upPushes the price down");
    expect(screen.queryByTestId("fb-explain")).toBeNull();                         // the long explanation under the graph is gone
    expect(root.querySelectorAll("p")).toHaveLength(0);
    const chartText = Array.from(root.querySelectorAll("svg text")).map((n) => n.textContent).join(" ");
    expect(chartText).not.toMatch(/[+%]/);
    expect(root.querySelector("h3")).toBeNull();
  });
  it("draws green bars for positive contributions and red bars for negative ones", () => {
    render(<FactorBars exp={exp()} ctxOnly={false} crop="Cabbage" />);
    const fills = Array.from(document.querySelectorAll("[data-testid=factor-bars] rect, [data-testid=factor-bars] path")).map((n) => n.getAttribute("fill"));
    expect(fills.filter((f) => f === "#1f7a45")).toHaveLength(2);   // price level and arrivals
    expect(fills.filter((f) => f === "#c43f2f")).toHaveLength(1);   // season
  });
  it("a history-only crop, a missing explanation or a bad one shows a short message, never bars", () => {
    render(<FactorBars exp={exp()} ctxOnly crop="Onion" />);
    expect(screen.getByTestId("fb-unavailable").textContent).toContain("No expected price is shown for Onion");
    cleanup();
    render(<FactorBars exp={null} ctxOnly={false} crop="Cabbage" />);
    expect(screen.getByTestId("fb-unavailable")).toBeTruthy();
    cleanup();
    render(<FactorBars exp={exp({ technical: { reconstruction_ok: false } })} ctxOnly={false} crop="Cabbage" />);
    expect(screen.queryByTestId("factor-bars")).toBeNull();
  });
  it("never shows weather or soil as a factor", () => {
    render(<FactorBars exp={exp()} ctxOnly={false} crop="Cabbage" />);
    expect(screen.getByTestId("factor-bars").textContent).not.toMatch(/temperature|rainfall|humidity|nitrogen|potassium|phosphorus|soil/i);
  });
});

describe("UnderstandPrediction (short farmer version)", () => {
  const view = (e = exp()) => render(<UnderstandPrediction exp={e} crop="Cabbage" targetDate="2026-11-02" />);

  it("shows only the predicted price section, with the slot below it for the influence card", () => {
    render(<UnderstandPrediction exp={exp()} crop="Cabbage" targetDate="2026-11-02" afterA={<section data-testid="slot">card</section>} />);
    expect(screen.getByTestId("u-price").textContent).toContain("₹1,041");
    const t = screen.getByTestId("understand");
    expect(Array.from(t.children).map((c) => c.getAttribute("data-testid") || c.querySelector("h2")?.id)).toEqual(["u-a", "slot"]);
    expect(t.textContent).not.toMatch(/Pushing the Price|What This Means|push \(/i);
  });
});

describe("Field Conditions: one combined chart (FieldConditionsOverview)", () => {
  const wx = { state: "ok", data: { status: "forecast", date: "2026-11-02", temperature_c: 24, rainfall_mm: 6.2, humidity_pct: 80, place: "Pune (town centre)" } };
  const soil = { state: "ok", data: { status: "estimate", ph: null, soil_type: "Vertisols" } };
  const val = (id) => screen.getByTestId(`fc-${id}-value`).textContent;
  const row = (id) => screen.getByTestId(`fc-${id}`);
  const root = () => screen.getByTestId("field-conditions");

  it("is ONE chart with one row per condition and the retrieved values beside the bars (24 °C, 80%, 6.2 mm, pH unavailable, Vertisols, location unavailable)", () => {
    render(<FieldConditions weather={wx} soil={soil} />);
    expect(root().querySelectorAll(".recharts-wrapper")).toHaveLength(1);          // a single chart, not six boxes
    expect(root().querySelectorAll("li[data-status]")).toHaveLength(0);             // the old six-box layout is gone
    expect(Array.from(root().querySelectorAll("[data-testid^=fc-][data-status]")).map((g) => g.getAttribute("data-testid")))
      .toEqual(["fc-temperature", "fc-humidity", "fc-rainfall", "fc-ph", "fc-soil", "fc-location"]);
    expect(val("temperature")).toBe("24 °C");
    expect(val("humidity")).toBe("80%");
    expect(val("rainfall")).toBe("6.2 mm that day");                 // a forecast: the amount for that single day
    expect(val("ph")).toBe("Unavailable");
    expect(val("soil")).toBe("Vertisols");
    expect(val("location")).toBe("Not provided");
  });
  it("each number is drawn on its own scale (printed under its label); a bar's length is that value's place in its own range", () => {
    render(<FieldConditions weather={wx} soil={soil} />);
    const text = root().textContent;
    expect(text).toContain("0–50 °C");
    expect(text).toContain("0–100 %");
    expect(text).toContain("0–50 mm");
    expect(text).toContain("0–14");
    expect(screen.getByTestId("fc-scale-note").textContent).toContain("own scale");
    const filled = (id) => Number(row(id).querySelectorAll("rect")[1].getAttribute("width")) / Number(row(id).querySelectorAll("rect")[0].getAttribute("width"));
    expect(filled("temperature")).toBeCloseTo(24 / 50, 1);
    expect(filled("humidity")).toBeCloseTo(0.8, 1);
    expect(filled("rainfall")).toBeCloseTo(6.2 / 50, 1);
  });
  it("soil type is a category pill with no bar, and unavailable rows are a dashed empty track, never a bar", () => {
    render(<FieldConditions weather={wx} soil={soil} />);
    expect(row("soil").querySelectorAll("rect")).toHaveLength(1);                  // just the pill
    expect(row("soil").querySelector("rect").getAttribute("rx")).toBe("12");
    for (const id of ["ph", "location"]) {
      expect(row(id).getAttribute("data-status")).toBe("unavailable");
      expect(row(id).querySelectorAll("rect")).toHaveLength(1);                    // an empty outline only
      expect(row(id).querySelector("rect").getAttribute("stroke-dasharray")).toBe("4 3");
      expect(row(id).querySelector("rect").getAttribute("fill")).toBe("none");
    }
  });
  it("explains why each condition matters, in plain words and without naming any data provider", () => {
    const wxLive = { state: "ok", data: { ...wx.data, source: "Open-Meteo weather forecast", served_from: "live", retrieved_at: "2026-10-28T06:00:00+00:00" } };
    render(<FieldConditions weather={wxLive} soil={{ state: "ok", data: { status: "estimate", ph: 6.8, soil_type: "Vertisols", ph_scope: "town_centre", served_from: "live", source: "SoilGrids (ISRIC), regional soil map" } }} />);
    const why = (id) => screen.getByTestId(`fc-why-${id}`).textContent;
    expect(why("temperature")).toBe("Temperature: Helps you understand whether the weather is suitable for crop growth.");
    expect(why("humidity")).toBe("Humidity: High humidity can increase the risk of crop diseases.");
    expect(why("rainfall")).toBe("Rainfall: Helps you understand how much rain the crop may receive.");
    expect(why("ph")).toBe("Soil pH: Helps you understand whether the soil acidity is suitable for your crop.");
    expect(why("soil")).toBe("Soil Type: Helps you understand the kind of soil your crop is growing in.");
    expect(screen.getByTestId("fc-note-weather").textContent).toBe("Temperature, humidity and rainfall are the forecast for 2 Nov 2026.");
    expect(screen.getByTestId("fc-note-soil").textContent).toBe("Soil pH and soil type are regional estimates (at the market town), not measurements from your farm.");   // an older result: no growing location
    expect(screen.getByTestId("fc-note-location").textContent).toContain("not given for this prediction");
    expect(screen.getByTestId("fc-note").textContent).toBe("Conditions at your growing location around your selling date, to help you plan your harvest and storage.");
    expect(root().textContent).not.toMatch(/Open-Meteo|SoilGrids|GeoNames|ISRIC|geocoding|API|Source:/);                                  // no provider or technical names anywhere
    expect(screen.queryByTestId("fc-sources")).toBeNull();
    expect(root().textContent).not.toMatch(/shap|score|correlat|null|undefined|NaN/i);
    expect(val("ph")).toBe("6.8");
  });
  it("recorded weather is called recorded, and soil pH read around the place is said to come from the surrounding farmland", () => {
    const wxCached = { state: "ok", data: { ...wx.data, status: "observed", date: "2025-10-29", source: "Open-Meteo historical archive", served_from: "cache", retrieved_at: "2026-10-27T10:15:00+00:00" } };
    render(<FieldConditions weather={wxCached} soil={{ state: "ok", data: { status: "estimate", ph: 7.1, soil_type: "Vertisols", ph_scope: "surrounding_area", ph_area_km: 2, served_from: "cache", retrieved_at: "2026-10-26T09:00:00+00:00" } }} />);
    expect(screen.getByTestId("fc-note-weather").textContent).toBe("Temperature, humidity and rainfall were recorded on 29 Oct 2025.");
    expect(screen.getByTestId("fc-note-soil").textContent).toContain("pH from farmland about 2 km around the market town");
    expect(root().textContent).not.toMatch(/Open-Meteo|SoilGrids|GeoNames|ISRIC|geocoding|API|Source:/);
  });
  it("explains why something is unavailable in plain words, never as a raw error, and keeps the warning", () => {
    render(<FieldConditions weather={{ state: "ok", data: { status: "unavailable", reason: "no_coordinates", temperature_c: null } }}
      soil={{ state: "ok", data: { status: "unavailable", reason: "service_unreachable", ph: null, soil_type: null } }} />);
    expect(screen.getByTestId("fc-note-weather").textContent).toBe("Temperature, humidity and rainfall are unavailable. No location is configured for this market yet.");
    expect(screen.getByTestId("fc-note-soil").textContent).toBe("Soil pH and soil type are unavailable. Soil information could not be loaded just now. Please try again later.");
    cleanup();
    render(<FieldConditions weather={{ state: "error", data: null }} soil={{ state: "ok", data: { status: "unavailable", reason: "ambiguous_location", ph: null, soil_type: null } }} />);
    expect(screen.getByTestId("fc-note-weather").textContent).toContain("could not be reached");
    expect(screen.getByTestId("fc-note-soil").textContent).toContain("matches more than one town");
    cleanup();
    render(<FieldConditions weather={{ state: "ok", data: { status: "unavailable", reason: "beyond_forecast_range", temperature_c: null } }} soil={soil} />);
    expect(screen.getByTestId("fc-note-weather").textContent).toContain("beyond the 14-day weather forecast");
    expect(screen.getByTestId("fc-note-soil").textContent).toContain("The soil map has no pH value for this area.");
  });
  it("missing weather and soil read Unavailable on dashed rows, never 0 and never a bar", () => {
    render(<FieldConditions weather={{ state: "ok", data: { status: "unavailable", temperature_c: null } }} soil={{ state: "ok", data: { status: "unavailable", ph: null, soil_type: null } }} />);
    for (const id of ["temperature", "humidity", "rainfall", "ph", "soil"]) {
      expect(val(id)).toBe("Unavailable");
      expect(row(id).getAttribute("data-status")).toBe("unavailable");
      expect(row(id).querySelectorAll("rect")).toHaveLength(1);
    }
    const values = Array.from(root().querySelectorAll("[data-testid$=-value]")).map((n) => n.textContent);
    expect(values.filter((v) => /\d/.test(v))).toEqual([]);                           // no number is shown for any missing value
    expect(screen.getByTestId("fc-note-weather").textContent).toContain("unavailable");
  });
  it("failed lookups, a partial soil answer and loading all render safely", () => {
    render(<FieldConditions weather={{ state: "error", data: null }} soil={{ state: "error", data: null }} />);
    expect(val("temperature")).toBe("Unavailable");
    expect(val("ph")).toBe("Unavailable");
    cleanup();
    render(<FieldConditions weather={wx} soil={{ state: "ok", data: { status: "estimate", ph: null, soil_type: "Cambisols" } }} />);
    expect(val("ph")).toBe("Unavailable");
    expect(val("soil")).toBe("Cambisols");
    cleanup();
    render(<FieldConditions weather={{ state: "loading", data: null }} soil={{ state: "loading", data: null }} />);
    expect(val("temperature")).toBe("…");
    expect(row("temperature").getAttribute("data-status")).toBe("loading");
  });
  it("a typical-weather answer is labelled as not a forecast, and an out-of-range value fills its bar but still shows its true number", () => {
    render(<FieldConditions weather={{ state: "ok", data: { ...wx.data, status: "typical", rainfall_mm: 120, reason: "service_unreachable", served_from: "stored_history", source: "Stored market weather, same time of year, 2015-2025" } }} soil={soil} />);
    const w = screen.getByTestId("fc-note-weather").textContent;
    expect(w).toContain("typical for this time of year (averages of earlier years), an estimate and not a forecast for 2 Nov 2026");
    expect(w).toContain("Rainfall is the average per day.");
    expect(w).toContain("The live forecast could not be reached.");
    expect(w).not.toMatch(/stored|project|Open-Meteo/);
    expect(val("rainfall")).toBe("120 mm a day (typical)");          // typical: an average per day, never a single day's amount
    const r = row("rainfall").querySelectorAll("rect");
    expect(Number(r[1].getAttribute("width"))).toBeCloseTo(Number(r[0].getAttribute("width")), 0);
  });
  it("is separate from the SHAP chart and never lists these fields as model factors", () => {
    render(<><FactorBars exp={exp()} ctxOnly={false} crop="Cabbage" /><FieldConditions weather={wx} soil={soil} /></>);
    expect(screen.getByTestId("factor-bars").textContent).not.toMatch(/temperature|humidity|rainfall|soil|growing/i);
    expect(screen.getByTestId("field-conditions").closest("[data-testid=factor-bars]")).toBeNull();
  });
});

describe("Field Conditions for the farmer's growing location", () => {
  // the shape the backend returns for a crop grown in Nashik and sold at APMC Pune (values are synthetic test data)
  const NASHIK = "Nashik, Maharashtra, India";
  const wx = { state: "ok", data: { status: "forecast", date: "2026-11-02", temperature_c: 22.5, rainfall_mm: 12, humidity_pct: 89, place: NASHIK,
    place_kind: "growing_location", latitude: 19.9973, longitude: 73.791, source: "Open-Meteo weather forecast", served_from: "live" } };
  const soil = { state: "ok", data: { status: "estimate", ph: 7.8, soil_type: "Vertisols", ph_scope: "surrounding_area", ph_area_km: 2,
    place: NASHIK, place_kind: "growing_location", served_from: "cache", retrieved_at: "2026-10-26T09:00:00+00:00" } };
  const growing = { value: NASHIK, available: true, latitude: 19.9973, longitude: 73.791, source: "Open-Meteo geocoding (GeoNames)" };
  const val = (id) => screen.getByTestId(`fc-${id}-value`).textContent;

  it("shows the returned values and the growing location, with a plain explanation for each", () => {
    render(<FieldConditions weather={wx} soil={soil} growing={growing} />);
    expect([val("temperature"), val("humidity"), val("rainfall"), val("ph"), val("soil"), val("location")])
      .toEqual(["22.5 °C", "89%", "12 mm that day", "7.8", "Vertisols", "Nashik"]);
    expect(screen.getByTestId("fc-location").getAttribute("data-status")).toBe("ok");
    expect(screen.getByTestId("fc-note-location").textContent).toBe("Growing location: Nashik, Maharashtra, India.");
    expect(screen.getByTestId("fc-note-weather").textContent).toBe("Temperature, humidity and rainfall are the forecast for 2 Nov 2026.");
    expect(screen.getByTestId("fc-note-soil").textContent).toContain("pH from farmland about 2 km around the growing location");
    expect(screen.getByTestId("fc-why-ph")).toBeTruthy();
    expect(screen.getByTestId("field-conditions").textContent).not.toMatch(/Open-Meteo|SoilGrids|GeoNames|ISRIC|geocoding|API|Source:/);
    expect(screen.getByTestId("field-conditions").textContent).not.toMatch(/market town|null|undefined|NaN/);
  });

  it("takes the growing location from the weather answer when no factor block is given (explanation page)", () => {
    render(<FieldConditions weather={wx} soil={soil} />);
    expect(val("location")).toBe("Nashik");
    expect(screen.getByTestId("fc-note-location").textContent).toBe("Growing location: Nashik, Maharashtra, India.");
  });

  it("a growing location that could not be found is unavailable with the reason, and so are weather and soil", () => {
    const down = { state: "ok", data: { status: "unavailable", reason: "location_not_found", temperature_c: null } };
    render(<FieldConditions weather={down} soil={{ state: "ok", data: { status: "unavailable", reason: "location_not_found", ph: null, soil_type: null } }}
      growing={{ value: null, available: false, reason: "location_not_found", entered: "Nowhereville" }} />);
    for (const id of ["temperature", "humidity", "rainfall", "ph", "soil", "location"]) {
      expect(screen.getByTestId(`fc-${id}`).getAttribute("data-status")).toBe("unavailable");
    }
    expect(screen.getByTestId("fc-note-location").textContent).toBe("Growing location: \"Nowhereville\" could not be used. No place with this name was found.");
    expect(screen.getByTestId("fc-note-weather").textContent).toContain("No place with this name was found.");
  });

  it("a soil-service outage shows Unavailable for soil while the weather values stay", () => {
    render(<FieldConditions weather={wx} soil={{ state: "ok", data: { status: "unavailable", reason: "service_unreachable", ph: null, soil_type: null, place_kind: "growing_location" } }}
      growing={growing} />);
    expect(val("temperature")).toBe("22.5 °C");
    expect(val("ph")).toBe("Unavailable");
    expect(val("soil")).toBe("Unavailable");
    expect(screen.getByTestId("fc-note-soil").textContent).toContain("Soil information could not be loaded just now");   // a short, clear explanation
  });
});

describe("Graph 1 price axis", () => {
  it("uses evenly spaced round ticks that just enclose the prices", () => {
    const { domain, ticks } = priceAxis(812, 2290);
    expect(domain[0]).toBeLessThanOrEqual(812);
    expect(domain[1]).toBeGreaterThanOrEqual(2290);
    const gaps = ticks.slice(1).map((v, i) => v - ticks[i]);
    expect(new Set(gaps).size).toBe(1);                          // one spacing
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.length).toBeLessThanOrEqual(5);
    expect(domain[1] - domain[0]).toBeLessThan((2290 - 812) * 1.7);   // no wide empty band
    expect(priceAxis(1000, 1000).domain[1]).toBeGreaterThan(1000);    // a flat line still gets a range
  });
});
