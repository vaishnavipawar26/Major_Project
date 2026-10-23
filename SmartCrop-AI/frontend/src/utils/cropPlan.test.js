import { describe, expect, it } from "vitest";
import { compareRows, defaultCrop, indicatorRows, mainConcern, rankingCompare, reliabilityOf } from "./cropPlan";

// t echoes the key and its numbers so the tests can see what was asked for
const t = (key, p = {}) => `${key}${Object.keys(p).length ? ` ${JSON.stringify(p)}` : ""}`;

const crop = (name, rank, profit, profitRank, status, extra = {}) => ({
  crop_name: name, rank, profit_rank: profitRank, status, feasible: true, recommended: rank === 1, forecast_reliability: "tested",
  economics: { selling_price: 2000, gross_revenue: profit + 50000, total_cost: 50000, net_profit: profit, roi_pct: 10 },
  range_fit: { soil: { within: 4, total: 4 }, weather: { within: 3, total: 3 } }, timeline: { status: "fresh" }, ...extra,
});
const response = (ex) => ({
  best_overall: "Cauliflower", highest_profit: "Brinjal",
  results: [
    crop("Cauliflower", 1, 32529, 3, { key: "best", tone: "good" }),
    crop("Brinjal", 2, 34646, 1, { key: "recommended", tone: "good" }),
    crop("Potato", 3, 34515, 2, { key: "notTop", tone: "neutral" }, { forecast_reliability: "limited" }),
  ],
  ranking_explanation: ex,
});

describe("compareRows", () => {
  it("uses the API's ranking, labels and money values unchanged", () => {
    const r = response({});
    const rows = compareRows(r.results, r, t);
    expect(rows.map((x) => [x.crop, x.rank, x.profitRank, x.profit, x.status.key])).toEqual([
      ["Cauliflower", 1, 3, 32529, "best"], ["Brinjal", 2, 1, 34646, "recommended"], ["Potato", 3, 2, 34515, "notTop"]]);
    expect(rows.filter((x) => x.isBest).map((x) => x.crop)).toEqual(["Cauliflower"]);
    expect(rows.filter((x) => x.isTop).map((x) => x.crop)).toEqual(["Brinjal"]);
    expect(rows[2].reliability).toBe("limited");
    expect(reliabilityOf(r.results[0])).toBe("tested");
  });
});

describe("rankingCompare", () => {
  const withEcon = (r, cost, profit, roi) => ({ ...r, economics: { ...r.economics, total_cost: cost, net_profit: profit, roi_pct: roi }, eligible: true, low_agronomic_suitability: false });
  const differ = () => {
    const r = response({ best_overall: "Cauliflower", highest_profit: "Brinjal", same_crop: false, profit_gap: 2117,
      reasons: [{ code: "returns", points: 2, params: {} }, { code: "fit", points: 4, params: { best_in: 7, top_in: 6, total: 7 } }] });
    r.weights = { agronomic: 0.4, timing: 0.2, profit: 0.4 };
    r.results[0] = withEcon(r.results[0], 69000, 32529, 54.2);
    r.results[1] = withEcon(r.results[1], 81000, 34646, 47.6);
    return r;
  };

  it("when another crop ranks first: separate profit and ROI comparisons from the API figures", () => {
    const c = rankingCompare(differ());
    expect(c.best.crop_name).toBe("Cauliflower");
    expect(c.top.crop_name).toBe("Brinjal");
    expect(c.gap).toBe(2117);
    expect(c.roi).toEqual({ best: 47, top: 43 }); // profit / costs x 100: 32529/69000, 34646/81000
    expect(c.roiDiff).toBe(4);
    expect(c.cheaper).toBe(true);
    expect(c.canChoose).toBe(true);
    expect(c.reasons.map((x) => x.code)).toEqual(["fit"]); // "returns" is shown by the ROI panel
  });

  it("omits the ROI comparison and the advice when ROI is invalid or not higher", () => {
    const bad = differ(); bad.results[0].economics.total_cost = 0;
    expect(rankingCompare(bad).roiShown).toBe(false);
    expect(rankingCompare(bad).canChoose).toBe(false);
    const lower = differ(); lower.results[0].economics.net_profit = 20000;
    expect(rankingCompare(lower).roiShown).toBe(false);
  });

  it("gives no advice to choose a profit leader that is a poor soil fit", () => {
    const r = differ(); r.results[1].low_agronomic_suitability = true;
    expect(rankingCompare(r).canChoose).toBe(false);
  });

  it("returns null when the same crop is overall #1 and profit #1", () => {
    const r = differ();
    r.results[0].profit_rank = 1; r.results[1].profit_rank = 2;
    expect(rankingCompare(r)).toBeNull();
  });

  it("treats a missing or unknown profit rank as no comparison, not as proof of anything", () => {
    const r = differ();
    r.results.forEach((x) => { x.profit_rank = null; });
    expect(rankingCompare(r)).toBeNull();
    const bad = differ(); bad.results[1].economics.net_profit = NaN;
    expect(rankingCompare(bad)).toBeNull();
  });

  it("compares crop ids from the ranked results, not the response's name fields", () => {
    const r = differ(); r.best_overall = "Brinjal"; r.highest_profit = "Brinjal"; // stale fields
    r.ranking_explanation = { ...r.ranking_explanation, best_overall: "Brinjal", highest_profit: "Brinjal", same_crop: true };
    const c = rankingCompare(r);
    expect(c.best.crop_name).toBe("Cauliflower");
    expect(c.top.crop_name).toBe("Brinjal");
    expect(c.reasons).toEqual([]); // reasons only if the API explanation is about the same two crops
  });

  it("returns null when no crop is recommended", () => {
    const r = differ();
    r.best_overall = null;
    r.results.forEach((x) => { x.recommended = false; });
    expect(rankingCompare(r)).toBeNull();
  });
});

// the Potato example: Potato is the only eligible crop, Brinjal earns more but fits the soil and weather poorly
const potatoCase = () => ({
  best_overall: "Potato", highest_profit: "Brinjal", weights: { agronomic: 0.4, timing: 0.2, profit: 0.4 },
  results: [
    crop("Potato", 1, 18816, 2, { key: "best", tone: "good" }, { price_policy: "context_only", forecast_reliability: "limited" }),
    crop("Cauliflower", 2, -7968, null, { key: "loss", tone: "bad" }, { price_policy: "model" }),
    crop("Brinjal", 4, 48467, 1, { key: "poorFit", tone: "warn" }, { price_policy: "model", recommended: false }),
  ],
  ranking_explanation: { best_overall: "Potato", highest_profit: "Brinjal", same_crop: false, profit_gap: 29651,
    reasons: [{ code: "fit", points: 22.9, params: { best_in: 7, top_in: 3, total: 7 } }] },
});

describe("default selection (the bold bar outline)", () => {
  it("is the recommended #1 crop, found by name, not the most profitable one or the first bar of the profit-sorted chart", () => {
    const r = potatoCase();
    expect(defaultCrop(r.results, r, null).crop_name).toBe("Potato");
    expect(defaultCrop(r.results, r, "Brinjal").crop_name).toBe("Brinjal");           // a click wins
    expect(defaultCrop([...r.results].reverse(), r, null).crop_name).toBe("Potato");  // any order of the results
    expect(defaultCrop(r.results, { ...r, best_overall: null }, null).crop_name).toBe("Brinjal"); // no recommendation: the profit leader
  });
});

describe("compareRows rough estimates", () => {
  it("flags the crops with no reliable price forecast and flags the recommended one", () => {
    const r = potatoCase();
    const rows = compareRows(r.results, r, t);
    expect(rows.map((x) => [x.crop, x.rough, x.isBest])).toEqual([["Potato", true, true], ["Cauliflower", false, false], ["Brinjal", false, false]]);
    expect(rows.map((x) => x.profit)).toEqual([18816, -7968, 48467]);                  // the profit maths is untouched
  });
});


describe("sellableSummary", () => {
  const tt = (k, v = {}) => ({
    "cr.sell.many": "{n} of the {total} crops can be sold in {month}; {crop} earns the most of these.", "cr.sell.one": "1 of the {total} crops can be sold in {month}: {crop}.",
    "cr.sell.noProfit": "{n} of the {total} crops can be sold in {month}; none of them is expected to make a profit.", "cr.sell.none": "None of the crops can be sold in {month}.",
  }[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => v[n]);
  const c = (name, feasible, profit) => ({ crop_name: name, feasible, economics: profit == null ? null : { net_profit: profit } });
  const resp = (results) => ({ selling_date: "2027-01", results });
  it("counts the crops that can be sold and names the one that earns the most of them", async () => {
    const { sellableSummary } = await import("./cropPlan");
    const r = resp([c("Brinjal", true, 96931), c("Cabbage", true, 6469), c("Cauliflower", true, 8349), c("Tomato", true, 3069), c("Potato", true, 15471), c("Onion", false, 27255), c("Wheat", false, 9261)]);
    const s = sellableSummary(r, tt);
    expect(s.text).toBe("5 of the 7 crops can be sold in Jan 2027; Brinjal earns the most of these.");   // Onion earns more but cannot be sold: it is not counted
    expect([s.n, s.total]).toEqual([5, 7]);
  });
  it("handles one crop, none, and no profit", async () => {
    const { sellableSummary } = await import("./cropPlan");
    expect(sellableSummary(resp([c("Wheat", true, 100), c("Onion", false, 9)]), tt).text).toBe("1 of the 2 crops can be sold in Jan 2027: Wheat.");
    expect(sellableSummary(resp([c("Wheat", false, 100)]), tt).text).toBe("None of the crops can be sold in Jan 2027.");
    expect(sellableSummary(resp([c("Wheat", true, -5), c("Onion", true, -9)]), tt).text).toBe("2 of the 2 crops can be sold in Jan 2027; none of them is expected to make a profit.");
  });
});

describe("indicatorRows: the edge of a usual range", () => {
  const tt = (k) => k;
  const result = (low, high) => ({ important_factors: [{ feature: "temperature", typical_low: low, typical_high: high, unit: "°C", value: "x" }, { feature: "rainfall", typical_low: 13.42, typical_high: 181.21, unit: "mm", value: "y" }] });
  const row = (v, low = 21.15, high = 34.17) => indicatorRows(result(low, high), ["temperature"], { temperature: v }, tt)[0];

  it("calls a value within 2% of the range width outside the range 'edge', else low or high", async () => {
    expect(row(21.0)).toMatchObject({ state: "edge", edgeSide: "low", ok: false });
    expect(row(34.4)).toMatchObject({ state: "edge", edgeSide: "high" });
    expect(row(20.8).state).toBe("low");
    expect(row(34.5).state).toBe("high");
    expect(row(21.15).state).toBe("ok");
    expect(row(30).state).toBe("ok");
    expect(row("").state).toBe("unknown");
  });

  it("prints the value with the same decimals as the range", () => {
    expect(row(21.0).shown).toBe("21.00");
    expect(row(23.26).shown).toBe("23.26");
    expect(row(30, 20, 35).shown).toBe("30");               // whole-number range: no decimals added
    expect(row(30.5, 20, 35).shown).toBe("30.5");
  });

  it("an edge value is not a main concern", () => {
    const fac = (feature, low, high) => ({ feature, typical_low: low, typical_high: high, unit: "", value: "1" });
    const r = { important_factors: [fac("N", 80, 120), fac("P", 40, 80), fac("K", 80, 120), fac("ph", 6, 7.5), fac("temperature", 21.15, 34.17), fac("humidity", 50, 80), fac("rainfall", 13.42, 181.21)] };
    const ok = { nitrogen: 100, phosphorus: 60, potassium: 100, ph: 6.5, temperature: 21.0, humidity: 60, rainfall: 100 };
    expect(mainConcern(r, ok, tt)).toBeNull();                                           // 21.0 is at the edge of 21.15-34.17
    expect(mainConcern(r, { ...ok, temperature: 20.5 }, tt)).toMatchObject({ feature: "temperature", low: true });
  });
});
