import { describe, expect, it } from "vitest";
import { translate } from "../i18n/LanguageContext";
import { areaBasis, compareRows, recommendedName, whySelected } from "./cropPlan";
import { decisionFactors, planReason } from "./decisionFactors";

const t = (k, v) => translate("en", k, v);
const rf = (n) => ({ within: n, total: n, items: {} });
const crop = (name, profit, cost, o = {}) => ({
  crop_name: name, feasible: true, eligible: true, rank: 1, location_score: 80, location: { growing_area_share_pct: 20 },
  economics: { net_profit: profit, total_cost: cost, gross_revenue: profit + cost, selling_price: 2000 },
  timeline: { planting: "2026-10", harvest_start: "2027-02", harvest_end: "2027-03", planting_in_window: true }, range_fit: { soil: rf(4), weather: rf(3) },
  important_factors: [], ...o,
});
const base = (over = {}) => ({
  area_acres: 2, selling_date: "2027-02", best_overall: "Wheat", highest_profit: "Onion", recommended_crop: "Wheat", recommendation_basis: "score",
  results: [crop("Wheat", 40000, 60000), crop("Onion", 90000, 140000)], personal_plan: null, ...over,
});
const plan = (over = {}) => ({
  inputs: { budget_inr: null, priority: "highest_profit", risk_level: "high", area_acres: 2 }, outcome: "ok", best_for_you: "Onion", excluded: [],
  crops: [{ crop: "Onion", upfront: 140000, profit: 90000 }, { crop: "Wheat", upfront: 60000, profit: 40000 }], partial: null, ...over,
});

describe("the recommended crop is the one the plan chose", () => {
  it("follows recommended_crop (Onion for highest profit), falling back to best_overall", () => {
    expect(recommendedName(base({ recommended_crop: "Onion", recommendation_basis: "plan", personal_plan: plan() }))).toBe("Onion");
    expect(recommendedName({ best_overall: "Wheat" })).toBe("Wheat");
    const rows = compareRows(base().results, base({ recommended_crop: "Onion" }), t);
    expect(rows.find((r) => r.isBest).crop).toBe("Onion");
  });

  it("explains an Onion pick by profit, with the same money as the chart", () => {
    const r = base({ recommended_crop: "Onion", recommendation_basis: "plan", personal_plan: plan() });
    const w = whySelected(r, t);
    expect(w.crop).toBe("Onion");
    expect(w.lines[0]).toBe("Onion suits your soil and weather conditions, so it is a suitable choice for your field.");
    expect(w.lines[1]).toContain("highest estimated profit (₹90,000)");      // Onion is also the profit leader: it may say so
  });

  it("names the real reason the profit leader was not recommended", () => {
    const r = base({ recommended_crop: "Wheat", recommendation_basis: "plan",
      personal_plan: plan({ best_for_you: "Wheat", excluded: [{ crop: "Onion", code: "over_budget", params: { extra: 80000, area: 0.43 } }] }) });
    const w = whySelected(r, t);
    expect(w.lines[1]).toContain("Onion has a higher estimated profit (₹90,000), but it does not fit your plan: needs ₹80,000 more");
    expect(w.lines.join(" ")).not.toContain("highest estimated profit");
  });

  it("falls back to the farmer's priority when the leader passed every check", () => {
    const r = base({ recommended_crop: "Wheat", recommendation_basis: "plan", personal_plan: plan({ best_for_you: "Wheat", inputs: { budget_inr: null, priority: "spend_less", risk_level: "high" } }) });
    expect(whySelected(r, t).lines[1]).toContain('Wheat ranks higher for your choice of "Spend less to start"');
  });
});

describe("one area for every figure", () => {
  const part = { crop: "Onion", area_acres: 0.5, guntha: 20, upfront: 35000, revenue: 60000, profit: 22500 };
  const r = base({ recommended_crop: "Onion", recommendation_basis: "plan", personal_plan: plan({ outcome: "partial", partial: part }) });

  it("uses the whole field normally and the smaller area when the plan is partial", () => {
    expect(areaBasis(base())).toMatchObject({ acres: 2, factor: 1, partial: false });
    expect(areaBasis(r)).toMatchObject({ acres: 0.5, factor: 0.25, partial: true });
  });

  it("scales the chart rows, the 'why' money and the factor cards to that area", () => {
    const onion = compareRows(r.results, r, t).find((x) => x.crop === "Onion");
    expect([onion.profit, onion.cost, onion.revenue]).toEqual([22500, 35000, 57500]);
    expect(whySelected(r, t).lines[1]).toContain("₹22,500");
    const profit = decisionFactors(r.results[1], r, {}, t).find((c) => c.key === "profit");
    expect(profit.big).toBe("₹22,500");
  });
});

describe("decision factors", () => {
  it("marks profit and budget as deciding only when the plan chose the crop", () => {
    const onion = base().results[1];
    const none = decisionFactors(onion, base(), {}, t);
    expect(none.map((c) => c.key)).toEqual(["location", "timing", "soil", "weather", "profit"]);
    expect(none.some((c) => c.decided)).toBe(false);
    const withPlan = base({ recommendation_basis: "plan", recommended_crop: "Onion", personal_plan: plan({ inputs: { budget_inr: 150000, priority: "highest_profit", risk_level: "high" } }) });
    const cards = decisionFactors(onion, withPlan, {}, t);
    expect(cards.filter((c) => c.decided).map((c) => c.key)).toEqual(["profit", "budget"]);
    expect(planReason(onion, withPlan, t).text).toContain("highest estimated profit (₹90,000)");
    expect(planReason(onion, base(), t)).toBeNull();
  });
});

describe("why a higher-profit crop was not chosen", () => {
  const pre = { Brinjal: ["K", "P"] };
  const lead = (o) => crop("Brinjal", 160000, 90000, { eligible: false, rank: 3, ...o });
  const fac = (f, v, lo, hi) => ({ feature: f, value: String(v), typical_low: lo, typical_high: hi, within_typical_range: false, unit: "" });
  const resp = (leadCrop) => base({ best_overall: "Potato", recommended_crop: "Potato", results: [crop("Potato", 6586, 30000), leadCrop], planting_month: 11 });

  it("names the soil values outside the crop's usual range, and does not promise a loss", () => {
    const w = whySelected(resp(lead({ low_agronomic_suitability: true, important_factors: [fac("K", 135, 36, 83), fac("P", 85, 38, 74)] })), t);
    expect(w.lines).toHaveLength(3);
    expect(w.lines[1]).toBe("Brinjal has a higher estimated profit (₹1,60,000), but it did not pass the suitability checks: your field has high potassium and high phosphorus, which is outside what it usually needs.");
    expect(w.lines[2]).toBe("Choosing a crop that suits your field may help reduce growing risks.");
    expect(w.lines.join(" ")).not.toMatch(/loss|lose/);
  });

  it("names the planting season when the planting month is not one of its months", () => {
    expect(whySelected(resp(lead({ planting_suitable: false })), t).lines[1]).toContain("it is not usually planted in November");
  });

  it("gives the crop's own rank reason when it passed every check", () => {
    expect(whySelected(resp(lead({ eligible: true })), t).lines[1]).toContain("Potato ranks higher on your location, planting time and field conditions");
  });
});
