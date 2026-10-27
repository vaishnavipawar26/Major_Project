// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { cloneElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// recharts needs a measured container; give it a fixed size so the SVG (lines, band, labels) is rendered in jsdom
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, ResponsiveContainer: ({ children }) => <div>{cloneElement(children, { width: 900, height: 400 })}</div> };
});

import PriceTrendChart, { TrendTooltip } from "./PriceTrendChart";

const day = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const run = (n) => Array.from({ length: n }, (_, i) => i);
const ORIGIN = "2026-10-23", TARGET = "2026-11-12", END = "2026-11-26";
const lastYear = run(35).map((i) => ({ date: day(ORIGIN, i + 1), price: 2000 + i * 8 }));
const path = run(35).map((i) => ({ horizon_days: i + 1, date: day(ORIGIN, i + 1), predicted_price: 2100 + i * 10, lower: 1900 + i * 10, upper: 2300 + i * 14,
  beats_baseline: i < 25 }));
const base = {
  historyIsReference: true, referenceRows: lastYear, chartPath: path, originDate: ORIGIN, inputDate: ORIGIN, currentPrice: 2100,
  targetDate: TARGET, chartEnd: END, forecast: true, selected: { price: 2400, source: "forecast" }, latest: { date: ORIGIN, age_days: 0 },
  caption: "Expected prices are estimates. Actual market prices may differ.",
};
const lines = () => Array.from(document.querySelectorAll("path.recharts-line-curve"));
const strokes = () => lines().map((p) => p.getAttribute("stroke"));
const dashes = () => lines().map((p) => p.getAttribute("stroke-dasharray"));

beforeAll(() => { globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; });
afterEach(cleanup);

describe("forecast allowed", () => {
  it("draws the grey last-year line, the orange dashed forecast, a lighter dashed line for less reliable days and the range band", () => {
    render(<PriceTrendChart {...base} />);
    expect(strokes()).toContain("var(--series-reference)");
    expect(strokes()).toContain("var(--series-forecast)");
    expect(strokes()).toContain("var(--series-weak)");               // days 26+ are marked less reliable by the API
    expect(dashes()).toContain("6 4");                                // orange dashed
    expect(dashes()).toContain("2 4");                                // lighter style
    expect(document.querySelector(".recharts-area")).toBeTruthy();    // likely range
    const legend = screen.getByTestId("chart-legend").textContent;
    for (const item of ["Last year's price for the same dates (+ inflation)", "Expected price (prediction)", "Expected price (less reliable)", "Likely range", "Your selected date"]) {
      expect(legend).toContain(item);
    }
  });

  it("marks your date with a green line and a dot labelled with the shared price", () => {
    render(<PriceTrendChart {...base} />);
    const svg = document.querySelector("svg").textContent;
    expect(svg).toContain("Your date");
    expect(svg).toContain("₹2,400");
    expect(document.querySelectorAll(".recharts-reference-dot").length).toBeGreaterThanOrEqual(2);   // the start dot and your date
    expect(screen.getByTestId("chart-caption").textContent).toBe("Expected prices are estimates. Actual market prices may differ.");
  });

  it("lists only the legend items that are drawn: no less-reliable item when every day is reliable", () => {
    render(<PriceTrendChart {...base} chartPath={path.map((p) => ({ ...p, beats_baseline: true }))} />);
    expect(screen.getByTestId("chart-legend").textContent).not.toContain("less reliable");
    expect(strokes()).not.toContain("var(--series-weak)");
  });

  it("the tooltip shows the date, days ahead, the expected price and the API's range", () => {
    const p = { dateIso: "2026-10-27", forecast: 1530, band: [1163, 1777], t: 0 };
    render(<TrendTooltip active payload={[{ payload: p }]} originDate={ORIGIN} pastLabel="Last year" />);
    const text = document.body.textContent.replace(/ /g, " ");
    expect(text).toContain("27 Oct 2026");
    expect(text).toContain("4 days ahead");
    expect(text).toContain("Expected price (prediction): ₹1,530");
    expect(text).toContain("Likely range: ₹1,163 – ₹1,777 per quintal");
  });

  it("the tooltip shows last year's price on a date with no forecast", () => {
    render(<TrendTooltip active payload={[{ payload: { dateIso: "2026-12-30", past: 2222, t: 0 } }]} originDate={ORIGIN} pastLabel="Last year's price" />);
    expect(document.body.textContent.replace(/ /g, " ")).toContain("Last year's price: ₹2,222");
    expect(document.body.textContent).not.toContain("Likely range");
  });

  it("the less-reliable tooltip uses the lighter label", () => {
    render(<TrendTooltip active payload={[{ payload: { dateIso: "2026-11-30", forecastWeak: 2400, band: [2000, 2800], t: 0 } }]} originDate={ORIGIN} pastLabel="x" />);
    expect(document.body.textContent.replace(/ /g, " ")).toContain("Expected price (less reliable): ₹2,400");
  });
});

describe("forecast blocked", () => {
  const blocked = { ...base, forecast: false, chartPath: [], selected: { price: 2152, source: "reference" },
    caption: "Past prices for Wheat at APMC Pune, adjusted for inflation. This is not a forecast." };

  it("draws no orange line, band or expected price, only the grey last-year line", () => {
    render(<PriceTrendChart {...blocked} />);
    expect(strokes()).toEqual(["var(--series-reference)"]);
    expect(document.querySelector(".recharts-area")).toBeNull();
    const legend = screen.getByTestId("chart-legend").textContent;
    expect(legend).not.toMatch(/Expected price|Likely range/);
    expect(legend).toContain("Last year's price for the same dates (+ inflation)");
    expect(screen.queryByRole("button", { name: /table/i })).toBeNull();
  });

  it("puts a dot on your date labelled with last year's price on that date", () => {
    render(<PriceTrendChart {...blocked} />);
    const svg = document.querySelector("svg").textContent;
    expect(svg).toContain("12 Nov 2026: about ₹2,152 last year, same date");
    expect(svg).toContain("Your date");
    expect(svg).not.toMatch(/xpected/);
    expect(screen.getByTestId("chart-caption").textContent).toBe("Past prices for Wheat at APMC Pune, adjusted for inflation. This is not a forecast.");
  });

  it("carries the last price over a day without a report instead of leaving a hole", () => {
    render(<PriceTrendChart {...blocked} referenceRows={lastYear.filter((r) => r.date !== "2026-11-05")} />);
    const d = lines()[0].getAttribute("d");
    expect(d.match(/M/g)).toHaveLength(1);                            // one unbroken path
  });
});

describe("latest report", () => {
  it("an old report is called 'Latest report', never 'Today'", () => {
    render(<PriceTrendChart {...base} forecast={false} chartPath={[]} latest={{ date: "2025-12-31", age_days: 296 }} />);
    const svg = document.querySelector("svg").textContent;
    expect(svg).toContain("Latest report: ₹2,100 · 31 Dec 2025");     // the start dot says which report it is
    expect(svg.match(/Today/g)).toHaveLength(1);                       // the dotted line is today's date, not the report's
    expect(svg).not.toMatch(/Today.{0,20}31 Dec 2025/);
  });

  it("a report inside the chart gets its own labelled line", () => {
    render(<PriceTrendChart {...base} inputDate={day(ORIGIN, 5)} latest={{ date: day(ORIGIN, 2), age_days: 3 }} />);
    const svg = document.querySelector("svg").textContent;
    expect(svg).toContain("Latest report: 25 Oct 2026");
    expect(svg).toContain("Today");
  });

  it("a report from today adds no extra date to the start label", () => {
    render(<PriceTrendChart {...base} />);
    const svg = document.querySelector("svg").textContent;
    expect(svg).toContain("Latest report: ₹2,100");
    expect(svg).not.toContain("Latest report: 23 Oct");
  });
});
