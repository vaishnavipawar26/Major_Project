import { describe, expect, it } from "vitest";
import { dailyCarried, priceOnDate, rollingMean, smoothIfJagged, yDomain } from "./priceChart";

describe("price on a date", () => {
  const rows = [{ date: "2025-11-08", price: 2000 }, { date: "2025-11-10", price: 2100 }, { date: "2025-11-13", price: 2300 }, { date: "2025-11-30", price: 1500 }];
  it("uses the reported price when the day has a report", () => {
    expect(priceOnDate(rows, "2025-11-10")).toEqual({ price: 2100, averaged: false, n: 1 });
  });
  it("no report that day: the average of reported days within 3 days either side", () => {
    expect(priceOnDate(rows, "2025-11-12")).toEqual({ price: 2200, averaged: true, n: 2 });   // 8 Nov is 4 days away
  });
  it("nothing within 3 days: no price, never a made-up one", () => {
    expect(priceOnDate(rows, "2025-11-20")).toBeNull();
    expect(priceOnDate([], "2025-11-20")).toBeNull();
  });
});

describe("daily series", () => {
  it("carries the last known price over a day with no report", () => {
    const d = dailyCarried([{ date: "2025-10-01", price: 100 }, { date: "2025-10-04", price: 130 }], "2025-10-10");
    expect(d.map((x) => x.price)).toEqual([100, 100, 100, 130]);
  });
  it("never extends past the last real report, stops at the end date, and is empty without data", () => {
    expect(dailyCarried([{ date: "2025-10-01", price: 100 }, { date: "2025-10-02", price: 110 }], "2025-10-20")).toHaveLength(2);
    expect(dailyCarried([{ date: "2025-10-01", price: 1 }, { date: "2025-10-09", price: 2 }], "2025-10-03")).toHaveLength(3);
    expect(dailyCarried([], "2025-10-03")).toEqual([]);
  });
  it("3-day average smooths a jagged line and leaves a calm one alone", () => {
    expect(rollingMean([10, 10, 40])[2]).toBe(20);
    const calm = [100, 101, 100, 101, 100];
    expect(smoothIfJagged(calm)).toBe(calm);
    const jagged = [100, 140, 90, 150, 95];
    expect(smoothIfJagged(jagged)).not.toEqual(jagged);
    expect(smoothIfJagged([100, 200])).toEqual([100, 200]);
  });
});

describe("y-axis", () => {
  it("covers at least +/-15% of the starting price", () => {
    const [lo, hi] = yDomain([2090, 2110], 2100);
    expect(lo).toBeLessThanOrEqual(2100 * 0.85);
    expect(hi).toBeGreaterThanOrEqual(2100 * 1.15);
  });
  it("still fits drawn prices outside that band", () => {
    expect(yDomain([1000, 4000], 2100)).toEqual([1000, 4000]);
  });
});
