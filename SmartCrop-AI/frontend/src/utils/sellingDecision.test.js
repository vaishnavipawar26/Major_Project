import { describe, expect, it } from "vitest";
import { candidateDates, decideSelling, makePriceAt } from "./sellingDecision";
import { selectedPrice, typicalMiss } from "./selectedPrice";

const prices = (m) => (d) => m[d] ?? null;

describe("decideSelling", () => {
  const wheat = { today: "2026-10-27", plannedDate: "2026-11-12", shelfDays: 60, plannedPrice: 2000, typicalMiss: 150 };

  it("(A) a gain within the typical miss: no clear advantage, the planned date is recommended", () => {
    const d = decideSelling({ ...wheat, priceAt: prices({ "2026-11-19": 2100, "2026-11-26": 2120 }) });
    expect(d.code).toBe("A");
    expect(d.chip).toBe("none");
    expect(d.recommended).toBe("planned");
    expect(d.best).toMatchObject({ date: "2026-11-26", price: 2120, diff: 120, gainSmall: true, days: 14 });
  });

  it("(B) a better date inside the shelf life: waiting may pay off, the best date is recommended", () => {
    const d = decideSelling({ ...wheat, priceAt: prices({ "2026-11-19": 2050, "2026-12-03": 2300 }) });
    expect(d.code).toBe("B");
    expect(d.chip).toBe("wait");
    expect(d.recommended).toBe("best");
    expect(d.best).toMatchObject({ date: "2026-12-03", price: 2300, diff: 300, days: 21, gainSmall: false });
    expect(d.best.pct).toBeCloseTo(15);
  });

  it("a date beyond the shelf life is never a candidate", () => {
    const d = decideSelling({ ...wheat, shelfDays: 30, priceAt: prices({ "2026-11-19": 2010, "2026-12-03": 3000 }) });   // 3 Dec is 37 days away
    expect(d.code).toBe("A");
    expect(d.best.date).toBe("2026-11-19");
  });

  it("a gain exactly equal to the typical miss is not better", () => {
    expect(decideSelling({ ...wheat, priceAt: prices({ "2026-11-19": 2150 }) }).code).toBe("A");
    expect(decideSelling({ ...wheat, priceAt: prices({ "2026-11-19": 2151 }) }).code).toBe("B");
  });

  it("every later date cheaper than the planned one: planned date is recommended and no gain is claimed", () => {
    const d = decideSelling({ ...wheat, priceAt: prices({ "2026-11-19": 1900 }) });
    expect(d.code).toBe("A");
    expect(d.best.diff).toBe(-100);
  });

  it("(C) no price for any date: no reliable comparison, no best date", () => {
    const d = decideSelling({ ...wheat, priceAt: () => null });
    expect(d).toMatchObject({ code: "C", chip: "none", recommended: "planned", best: null });
    expect(decideSelling({ ...wheat, plannedPrice: null, priceAt: prices({ "2026-11-19": 2500 }) }).code).toBe("C");
  });

  it("(D) planned date beyond the shelf life: sell soon, never store; best date inside the shelf life", () => {
    const d = decideSelling({ today: "2026-10-27", plannedDate: "2026-11-12", shelfDays: 7, plannedPrice: 1600, typicalMiss: 100,
      priceAt: prices({ "2026-10-29": 1500 }) });
    expect(d).toMatchObject({ code: "D", chip: "sell_soon", plannedBeyond: true, sellBy: "2026-11-03", recommended: "best" });
    expect(d.best).toMatchObject({ date: "2026-10-29", price: 1500, days: -14 });
  });

  it("(D) with no price for the earlier dates nothing is recommended, only the sell-by date", () => {
    const d = decideSelling({ today: "2026-10-27", plannedDate: "2026-11-12", shelfDays: 7, plannedPrice: 1600, priceAt: () => null });
    expect(d).toMatchObject({ code: "D", recommended: null, best: null, sellBy: "2026-11-03" });
  });

  it("(E) Potato: planned 4 Nov ₹1,550, 22 Nov ₹1,581, +₹31 (+2.0%), 18 days, typical miss bigger than 31 -> outcome A", () => {
    const d = decideSelling({ today: "2026-11-02", plannedDate: "2026-11-04", shelfDays: 21, plannedPrice: 1550, typicalMiss: 120,
      dates: ["2026-11-22"], priceAt: prices({ "2026-11-22": 1581 }) });
    expect(d.code).toBe("A");
    expect(d.recommended).toBe("planned");
    expect(d.best).toMatchObject({ date: "2026-11-22", price: 1581, diff: 31, days: 18, gainSmall: true });
    expect(d.best.pct).toBeCloseTo(2.0, 1);
  });

  it("candidate dates: every 7 days inside the shelf life; going back from a too-late planned date, from tomorrow", () => {
    expect(candidateDates("2026-11-04", "2026-11-02", 21)).toEqual(["2026-11-11", "2026-11-18"]);
    expect(candidateDates("2026-11-30", "2026-11-02", 10)).toEqual(["2026-11-09"]);
    expect(candidateDates("2026-11-04", "2026-11-02", 1)).toEqual([]);
  });
});

describe("blocked crop: earlier-year pattern", () => {
  const year = (y, weekly) => ({ year: y, date: `${y}-11-12`, price: weekly["0"], raw_price: 0, n: 9, weekly });
  const f = (earlier) => ({ policy: { mode: "context_only" }, target_date: "2026-11-12", history: [{ date: "2026-11-10", price: 2000 }],
    history_is_reference: true, reference_after: [{ date: "2026-11-12", price: 2000 }], actual_after_origin: [], earlier_years: earlier,
    target: { predicted_price: 9999 }, path: [], range_info: { typical_miss_inr: 100 } });

  it("fewer than 3 earlier years: no estimate, so no best date and no higher price", () => {
    const g = f([year(2025, { 0: 2000, 7: 2200 }), year(2024, { 0: 2000, 7: 2200 })]);
    expect(makePriceAt(g)("2026-11-19")).toBeNull();
    expect(decideSelling({ today: "2026-10-27", plannedDate: "2026-11-12", shelfDays: 60, plannedPrice: selectedPrice(g).price, priceAt: makePriceAt(g) }).code).toBe("C");
  });

  it("years that disagree on the direction: no estimate", () => {
    const g = f([year(2025, { 0: 2000, 7: 2200 }), year(2024, { 0: 2000, 7: 1800 }), year(2023, { 0: 2000, 7: 2000 })]);
    expect(makePriceAt(g)("2026-11-19")).toBeNull();
  });

  it("3 years, most moving the same way: planned price times their typical change", () => {
    const g = f([year(2025, { 0: 2000, 7: 2200 }), year(2024, { 0: 1000, 7: 1050 }), year(2023, { 0: 2000, 7: 1900 })]);
    expect(makePriceAt(g)("2026-11-19")).toBeCloseTo(2000 * 1.05);     // ratios 1.10, 1.05, 0.95 -> median 1.05
    expect(makePriceAt(g)("2026-11-20")).toBeNull();                   // only 7-day steps are known
  });

  it("the blocked path never uses the forecast price", () => {
    expect(selectedPrice(f([])).source).toBe("reference");
    expect(selectedPrice(f([])).price).toBe(2000);
    expect(selectedPrice(f([])).low).toBeNull();
  });
});

describe("shared selected-date price", () => {
  it("forecast allowed: the model's estimate and range; the daily path gives the same number", () => {
    const f = { policy: { mode: "model" }, target_date: "2026-11-12", target: { predicted_price: 2490, lower: 2300, upper: 2700, model_mae: 180 },
      chart_path: [{ date: "2026-11-12", predicted_price: 2490 }, { date: "2026-11-19", predicted_price: 2600 }] };
    expect(selectedPrice(f)).toMatchObject({ price: 2490, low: 2300, high: 2700, source: "forecast" });
    expect(makePriceAt(f)("2026-11-12")).toBe(selectedPrice(f).price);
    expect(typicalMiss(f)).toBe(180);
    expect(typicalMiss({ range_info: { typical_miss_inr: 277 }, target: { model_mae: 180 } })).toBe(277);
  });
});
