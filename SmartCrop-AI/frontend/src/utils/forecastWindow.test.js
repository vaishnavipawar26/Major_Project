import { describe, expect, it } from "vitest";
import { chartModel } from "./forecastWindow";

const entry = (day, status, price) => ({ date: new Date(Date.UTC(2026, 10, 1 + day)).toISOString().slice(0, 10), day, status, predicted_price: price });
const win = (entries) => ({ start_date: "2026-11-01", end_date: "2026-12-31", reference_price: 1000, entries });

describe("chartModel", () => {
  it("covers all 60 days on the axis", () => {
    const m = chartModel(win(Array.from({ length: 60 }, (_, i) => entry(i + 1, "validated", 1000 + i))));
    expect(m.domain[1]).toBe(Date.UTC(2026, 11, 31));
    expect(m.rows.filter((r) => r.predicted != null && r.kind === "forecast")).toHaveLength(60);
  });
  it("never joins old actual prices to a forecast a year later: they are not drawn", () => {
    const m = chartModel(win([entry(1, "validated", 1000)]), [{ date: "2025-12-30", price: 1900 }, { date: "2025-12-31", price: 1950 }]);
    expect(m.showActual).toBe(false);
    expect(m.rows.some((r) => r.actual != null)).toBe(false);
    expect(m.latestActual.price).toBe(1950);
  });
  it("leaves unavailable days empty and keeps experimental estimates out unless asked", () => {
    const entries = [entry(1, "validated", 1000), entry(2, "unavailable", null), entry(3, "not_validated", 1500)];
    const off = chartModel(win(entries));
    expect(off.rows.find((r) => r.date === "2026-11-04")).toBeUndefined();
    expect(off.rows.find((r) => r.date === "2026-11-03")).toBeUndefined();
    const on = chartModel(win(entries), [], { showExperimental: true });
    expect(on.rows.find((r) => r.date === "2026-11-04").experimental).toBe(1500);
    expect(on.rows.find((r) => r.date === "2026-11-04").predicted).toBeUndefined();
  });
  it("draws every one of the 60 days in its own series: validated, experimental, historical estimate; a day with nothing stays a gap", () => {
    // days 1-20 validated, 21-40 experimental, 41-55 past the model's reach with a historical estimate, 56-60 with nothing at all
    const entries = Array.from({ length: 60 }, (_, i) => {
      const d = i + 1;
      if (d <= 20) return entry(d, "validated", 1000 + d);
      if (d <= 40) return entry(d, "not_validated", 1100 + d);
      return { ...entry(d, "unavailable", null), estimate: d <= 55 ? { price: 1200 + d, method: "historical_baseline", validated: false } : null };
    });
    const m = chartModel(win(entries), [], { showExperimental: true, showEstimates: true });
    const of = (k) => m.rows.filter((r) => r[k] != null && r.kind !== "start" && r.kind !== "gap").map((r) => r.date);
    const days = (a, b) => entries.slice(a - 1, b).map((e) => e.date);
    expect(of("predicted")).toEqual(days(1, 20));
    expect(of("experimental")).toEqual(days(21, 40));
    expect(of("estimate")).toEqual(days(41, 55));
    const drawn = new Set([...of("predicted"), ...of("experimental"), ...of("estimate")]);
    expect(drawn.size).toBe(55);                                            // no date drawn twice, and the last 5 days are left empty
    expect(days(56, 60).some((d) => drawn.has(d))).toBe(false);
    expect(m.rows.find((r) => r.date === days(45, 45)[0]).predicted).toBeUndefined();    // an estimate is never a model price
    expect(chartModel(win(entries), [], { showExperimental: true }).rows.some((r) => r.estimate != null)).toBe(false);
  });
  it("breaks the line instead of joining the start price to a first validated day weeks later", () => {
    const entries = Array.from({ length: 60 }, (_, i) => entry(i + 1, i + 1 >= 31 ? "validated" : "not_validated", 1000 + i));
    const m = chartModel(win(entries));
    const startRow = m.rows.find((r) => r.kind === "start");
    const after = m.rows.find((r) => r.t > startRow.t);
    expect(startRow.predicted).toBe(1000);
    expect(after.kind).toBe("gap");
    expect(after.predicted).toBeNull();                         // the dashed line stops at the start dot
    const firstForecast = m.rows.find((r) => r.kind === "forecast");
    expect(firstForecast.date).toBe("2026-12-02");
  });
  it("breaks the line inside the series where a day has no validated price", () => {
    const entries = [entry(1, "validated", 1000), entry(2, "validated", 1010), entry(3, "not_validated", 5000), entry(4, "not_validated", 5000), entry(5, "validated", 1020)];
    const m = chartModel(win(entries));
    const gap = m.rows.find((r) => r.kind === "gap" && r.predicted === null);
    expect(gap).toBeTruthy();
    expect(m.rows.every((r) => r.predicted !== 5000)).toBe(true);
  });
  it("copes with an empty forecast series", () => {
    expect(chartModel(win([])).rows.filter((r) => r.kind === "forecast")).toHaveLength(0);
  });
});
