import { describe, expect, it } from "vitest";
import { compareRows, rankingCompare, reliabilityOf } from "./cropPlan";

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
