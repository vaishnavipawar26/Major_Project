// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { cloneElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// jsdom has no layout: give the chart a size so its bars and labels are drawn
vi.mock("recharts", async (orig) => ({ ...(await orig()), ResponsiveContainer: ({ children }) => cloneElement(children, { width: 900, height: 420 }) }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

import en from "../../i18n/cropResult.en";
import { chartNote } from "../../utils/cropPlan";
import CropCompare from "./CropCompare";

afterEach(cleanup);

const tEn = (k, v = {}) => (en[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => v[n]);
const IN = ["N", "P", "K", "ph", "temperature", "humidity", "rainfall"];
// one factor per soil/weather input: [value, typical_low, typical_high]; inside the range unless the test says otherwise
const RANGES = { N: [100, 80, 120], P: [60, 40, 80], K: [100, 80, 120], ph: [6.5, 6, 7.5], temperature: [24, 20, 30], humidity: [65, 50, 80], rainfall: [100, 50, 200] };
const factors = (out = {}) => IN.map((feature) => {
  const [value, low, high] = out[feature] ?? RANGES[feature];
  return { feature, value: String(value), unit: "", typical_low: low, typical_high: high, within_typical_range: value >= low && value <= high };
});
const range_fit = (outCount = 0) => ({ soil: { within: 4 - Math.min(outCount, 4), total: 4 }, weather: { within: 3 - Math.max(0, outCount - 4), total: 3 } });
const crop = (name, rank, profit, o = {}) => ({
  crop_name: name, rank, feasible: true, eligible: true, recommended: rank === 1, forecast_reliability: "tested", price_policy: "model",
  timing_score: 100, profit_score_used: 60, status: { key: "notTop", tone: "neutral" },
  economics: { selling_price: 1500, gross_revenue: profit + 90000, total_cost: 90000, net_profit: profit, roi_pct: 10, status: "fresh" },
  important_factors: factors(), range_fit: range_fit(0), timeline: { status: "fresh" }, ...o,
});
const response = (results, best = "Potato", over = {}) => ({
  selling_date: "2027-02", area_acres: 1, best_overall: best, highest_profit: [...results].sort((a, b) => b.economics.net_profit - a.economics.net_profit)[0].crop_name,
  results, ranking_explanation: { reasons: [] }, ...over,
});
// the Potato example: Brinjal earns more; its potassium and phosphorus are far too high, temperature a little low
const BRINJAL_OUT = { K: [135, 36, 83], P: [85, 38, 74], temperature: [19, 21.15, 34.17] };

describe("why-note under the profit chart", () => {
  it("1. shows nothing when the recommended crop is also the most profitable", () => {
    const r = response([crop("Potato", 1, 50000), crop("Brinjal", 2, 20000)]);
    expect(chartNote(r, tEn)).toBeNull();
    render(<CropCompare response={r} selected="Potato" onSelect={() => {}} />);
    expect(screen.queryByTestId("chart-note")).toBeNull();
  });

  it("2. names the two largest out-of-range factors, with 'fully' when every value fits the recommended crop", () => {
    const r = response([crop("Potato", 1, 18816), crop("Brinjal", 4, 48467, { eligible: false, recommended: false, important_factors: factors(BRINJAL_OUT), range_fit: range_fit(3) })]);
    const note = chartNote(r, tEn);
    expect(note).toBe("Why Potato? Your soil and weather suit Potato fully. Brinjal could earn about ₹30,000 more, but high potassium and high phosphorus in your field may reduce its yield. So Potato is the safer choice.");
    render(<CropCompare response={r} selected="Potato" onSelect={() => {}} />);
    expect(screen.getByTestId("chart-note").textContent).toBe(note);
  });

  it("3. says 'better' when the recommended crop has a value out of range itself", () => {
    const r = response([crop("Potato", 1, 18816, { range_fit: range_fit(1) }), crop("Brinjal", 4, 48467, { important_factors: factors(BRINJAL_OUT) })]);
    expect(chartNote(r, tEn)).toContain("Your soil and weather suit Potato better.");
  });

  it("4. gives a single factor, without 'and', when only one value is out of range", () => {
    const r = response([crop("Potato", 1, 18816), crop("Brinjal", 4, 48467, { important_factors: factors({ rainfall: [30, 50, 200] }) })]);
    const note = chartNote(r, tEn);
    expect(note).toContain("but low rainfall in your field may reduce its yield.");
    expect(note).not.toMatch(/ and (low|high)/);
  });

  it("5. with nothing out of range, uses the ranking factor that really is lower: the growing period, else returns, else overall", () => {
    const base = () => [crop("Potato", 1, 18816), crop("Brinjal", 4, 48467)];
    const timing = base(); timing[1].timing_score = 50;
    expect(chartNote(response(timing), tEn)).toBe("Why Potato? Your soil and weather suit Potato fully. Brinjal could earn about ₹30,000 more, but its growing period does not match your planting and selling months well. So Potato is the safer choice.");
    const returns = base(); returns[1].profit_score_used = 40;
    expect(chartNote(response(returns), tEn)).toContain("but it returns less on the money spent. So Potato ranks first.");
    expect(chartNote(response(base()), tEn)).toContain("but it scores lower overall. So Potato ranks first.");
  });

  it("6. skips a more profitable crop that cannot be sold in that month and uses the next one", () => {
    const r = response([crop("Potato", 1, 18816), crop("Wheat", 5, 90000, { feasible: false, important_factors: factors({ N: [10, 80, 120] }) }),
      crop("Brinjal", 4, 48467, { important_factors: factors({ K: [135, 36, 83] }) })]);
    const note = chartNote(r, tEn);
    expect(note).toContain("Brinjal could earn about ₹30,000 more");
    expect(note).not.toContain("Wheat");
    expect(note).toContain("high potassium");
  });

  it("7. draws the Recommended badge once, on the recommended crop's bar", () => {
    const r = response([crop("Potato", 1, 18816), crop("Brinjal", 4, 48467), crop("Cabbage", 3, 9000)]);
    const { container } = render(<CropCompare response={r} selected="Potato" onSelect={() => {}} />);
    const badges = container.querySelectorAll("[data-testid=recommended-badge]");
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toContain("Recommended");
    expect(container.textContent).toContain("₹19K");
    expect(screen.getByTestId("recommended-legend").textContent).toBe("★ Recommended crop");
  });
});
