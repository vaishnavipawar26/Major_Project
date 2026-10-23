import { describe, expect, it } from "vitest";
import { translate } from "../i18n/LanguageContext";
import { buildExplanation, judge } from "./farmerExplanation";

const t = (k, v) => translate("en", k, v);
const f = (feature, value, low, high, unit = "") => ({ feature, value: `${value}${unit ? ` ${unit}` : ""}`, typical_low: low, typical_high: high, unit, shap_value: 0.1, share_pct: 5, label: feature });

const brinjal = (over = {}) => ({
  crop_name: "Brinjal", rank: 1, recommended: true, feasible: true, profit_rank: 1, forecast_reliability: "tested",
  timeline: { planting: "2026-11", harvest_start: "2027-02", harvest_end: "2027-04", selling: "2027-03", status: "fresh", months_stored: 0,
    growth_months_min: 3, growth_months_max: 5, planting_in_window: true },
  economics: { selling_price: 2946, gross_revenue: 2253460, total_cost: 896902, net_profit: 1356559, effective_yield_q: 800 },
  important_factors: [f("N", 80, 77, 120), f("P", 45, 38, 74), f("K", 85, 36, 83), f("ph", 6.8, 5.81, 7.36),
    f("temperature", 23.26, 21.15, 34.17, "°C"), f("humidity", 70, 50, 90, "%"), f("rainfall", 2.98, 13.42, 181.21, "mm")],
  ...over,
});
const inputs = { nitrogen: 80, phosphorus: 45, potassium: 85, ph: 6.8, temperature: 23.26, humidity: 70, rainfall: 2.98 };
const response = (results, over = {}) => ({
  city: "Nashik", state: "Maharashtra", area_acres: 10, selling_date: "2027-03", best_overall: "Brinjal", results, ...over,
});
const others = Array.from({ length: 6 }, (_, i) => ({ crop_name: `C${i}`, profit_rank: i + 2, feasible: true, economics: { net_profit: 1000 * (i + 1) } }));

describe("buildExplanation", () => {
  const out = buildExplanation(brinjal(), response([brinjal(), ...others]), inputs, t);

  it("section 1: location uses the farmer's city and state", () => {
    expect(out.location.headline).toBe("Nashik");
    expect(out.location.text).toBe("Brinjal was evaluated for your selected farming location, Nashik, Maharashtra. SmartCrop AI uses patterns learned from its training data to estimate how suitable Brinjal may be for your farming conditions.");
  });
  it("section 2: planting time is computed from the timeline", () => {
    expect(out.planning.headline).toBe("November 2026");
    expect(out.planning.text).toBe("Brinjal generally takes around 3–5 months to grow. For your selected planting month, harvesting is estimated between February and April 2027. This period matches your planned selling month of March 2027.");
    expect(out.planning.matches).toBe(true);
  });
  it("section 3: soil rows are easy to compare and the potassium heading needs attention", () => {
    expect(out.soil.rows.map((r) => [r.label, r.value, r.range, r.status])).toEqual([
      ["Nitrogen (N)", "80", "Usual range: 77–120", "Within usual range"],
      ["Phosphorus (P)", "45", "Usual range: 38–74", "Within usual range"],
      ["Potassium (K)", "85", "Usual range: 36–83", "Slightly above usual range"],
      ["Soil pH", "6.8", "Usual range: 5.81–7.36", "Within usual range"],
    ]);
    expect(out.soil.headline).toBe("Potassium needs attention");
    expect(out.soil.text).toBe("Most of your soil values are within the reference ranges used for Brinjal. Potassium is slightly above its usual range. Check your soil test before making any fertilizer changes.");
    const k = out.soil.rows[2];
    expect(k.tone).toBe("warn");
    expect(k.bar.marker).toBeGreaterThan(k.bar.to);
  });
  it("section 4: temperature", () => {
    expect(out.temperature.headline).toBe("Within the usual range");
    expect(out.temperature.text).toBe("Your temperature is approximately 23.3°C, which falls within Brinjal's reference range of 21.15–34.17°C. This is a favourable sign according to that range, although temperature alone cannot guarantee healthy crop growth.");
  });
  it("section 5: rainfall is an average per month, not a live reading or a seasonal total", () => {
    expect(out.rainfall.headline).toBe("Water availability needs attention");
    expect(out.rainfall.tone).toBe("warn");
    expect(out.rainfall.text).toBe("The estimated average rainfall is approximately 3 mm per month during the crop's growing period, below Brinjal's reference range of 13.42–181.21 mm. Make sure sufficient irrigation water is available, especially when the crop needs it.");
    expect(out.rainfall.note).toBe("Average per month during the crop's growing period.");
  });
  it("section 6: profit uses the API's figures in Indian format", () => {
    expect(out.profit.headline).toBe("Highest of the crops that can be sold");
    expect(out.profit.amount).toBe("₹13,56,559");
    expect(out.profit.label).toBe("Estimated net profit for 10 acres");
    expect(out.profit.metrics.map((m) => m.value)).toEqual(["₹22,53,460", "₹8,96,902", "₹2,946"]);
    expect(out.profit.metrics[2].sub).toBe("per quintal in March 2027");
    expect(out.profit.text).toBe("7 of the 7 crops can be sold in Mar 2027; Brinjal earns the most of these. Actual earnings can differ because yield, market prices, weather and farming costs can change.");
  });
  it("final explanation is built from the results and makes no claim about the model", () => {
    expect(out.final).toBe("SmartCrop AI ranks Brinjal first because it has the highest estimated profit of the crops that can be sold and your planting schedule matches its expected growing period. Your temperature is within the reference range, while potassium and rainfall need attention. Check your soil condition and ensure water is available before making your final decision.");
  });
});

describe("buildExplanation for other situations", () => {
  it("reports the real profit rank when the crop is not the most profitable or recommended", () => {
    const r = brinjal({ profit_rank: 3, rank: 2, recommended: false });
    const out = buildExplanation(r, response([r, ...others], { best_overall: "C0" }), inputs, t);
    expect(out.profit.headline).toBe("Ranked 3 of the 7 crops that can be sold");
    expect(out.profit.text).toContain("7 of the 7 crops can be sold in Mar 2027;");
    expect(out.final).toContain("Brinjal is ranked 2 of 7 crops for your plan.");
  });
  it("says a loss is a loss", () => {
    const r = brinjal({ economics: { ...brinjal().economics, net_profit: -5000 } });
    const p = buildExplanation(r, response([r]), inputs, t).profit;
    expect(p.loss).toBe(true);
    expect(p.label).toBe("Estimated net loss for 10 acres");
    expect(p.headline).toBe("A loss is expected");
  });
  it("omits comparisons when no range is available", () => {
    const r = brinjal({ important_factors: brinjal().important_factors.map((x) => (x.feature === "temperature" ? { ...x, typical_low: null, typical_high: null } : x)) });
    const w = buildExplanation(r, response([r]), inputs, t).temperature;
    expect(w.headline).toBe("Not available");
    expect(w.bar).toBeNull();
  });
  it("handles missing economics, city and timeline without inventing values", () => {
    const r = brinjal({ economics: null, timeline: {} });
    const out = buildExplanation(r, response([r], { city: "" }), inputs, t);
    expect(out.profit).toBeNull();
    expect(out.planning).toBeNull();
    expect(out.location).toBeNull();
  });
  it("explains a crop that is not ready by the selling month", () => {
    const r = brinjal({ timeline: { ...brinjal().timeline, status: "not_ready" } });
    const p = buildExplanation(r, response([r]), inputs, t).planning;
    expect(p.text).toContain("would not be ready in time");
    expect(p.tone).toBe("bad");
  });
  it("a different crop gets its own values and ranges", () => {
    const r = brinjal({ crop_name: "Wheat", important_factors: brinjal().important_factors.map((x) => (x.feature === "K" ? { ...x, typical_low: 60, typical_high: 120 } : x)) });
    const out = buildExplanation(r, response([r], { best_overall: "Wheat" }), inputs, t);
    expect(out.soil.text).toBe("All your soil values are within the reference ranges used for Wheat.");
  });
});

describe("judge", () => {
  const row = (state, num, low, high, feature = "K") => ({ state, num, low, high, feature });
  it("slightly / clearly / far outside", () => {
    expect(judge(row("high", 85, 36, 83)).size).toBe("slight");
    expect(judge(row("low", 3, 13.42, 181.21)).size).toBe("clear");
    expect(judge(row("high", 400, 36, 83)).size).toBe("far");
    expect(judge(row("high", 7.7, 6.4, 7.5, "ph")).size).toBe("slight");
  });
});
