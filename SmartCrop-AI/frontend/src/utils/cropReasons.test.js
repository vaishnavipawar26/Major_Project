import { describe, expect, it } from "vitest";
import { translate } from "../i18n/LanguageContext";
import { modelNotes, whyReasons } from "./cropReasons";

const t = (k, v) => translate("en", k, v);
const fac = (feature, value, low, high, shap, unit = "", share) => ({ feature, label: feature, value: `${value}${unit ? ` ${unit}` : ""}`, typical_low: low, typical_high: high, unit, shap_value: shap, share_pct: share ?? shap * 100 });
const factors = (over = {}) => [
  fac("N", 90, 68, 113, 0.5), fac("P", 45, 31, 60, 0.2), fac("K", 45, 28, 65, 0.1), fac("ph", 7.2, 6.6, 8.3, 0.9),
  fac("temperature", 19, 12.8, 24.6, 0.3, "°C"), fac("humidity", 45, 35.3, 60.5, 0.2, "%"), fac("rainfall", 25, 10, 40.4, 0.1, "mm"),
  { feature: "soil_type", label: "Soil type", value: "Not specified", shap_value: 0.4, share_pct: 9, typical_low: null, typical_high: null, unit: "" },
  { feature: "city_code", label: "City", value: "Nagpur", shap_value: -0.3, share_pct: -6, typical_low: null, typical_high: null, unit: "" },
  ...Object.values(over),
];
const crop = (over = {}) => ({
  crop_name: "Wheat", rank: 1, profit_rank: 1, forecast_reliability: "tested", score_points: { agronomic: 30, timing: 18, profit: 25 },
  important_factors: factors(), economics: { selling_price: 2800, net_profit: 55000, roi_pct: 120, break_even_price: 1900 },
  timeline: { status: "fresh", planting: "2026-11", harvest_start: "2027-03", harvest_end: "2027-04", selling: "2027-03", planting_in_window: true, months_stored: 0 },
  ...over,
});
const response = { best_overall: "Wheat", highest_profit: "Wheat", selling_date: "2027-03", results: [] };
const inputs = { nitrogen: 90, phosphorus: 45, potassium: 45, ph: 7.2, temperature: 19, humidity: 45, rainfall: 25 };

describe("whyReasons", () => {
  it("gives at most three reasons: soil, weather and one more", () => {
    const { reasons } = whyReasons(crop(), response, inputs, t);
    expect(reasons.map((x) => x.key)).toEqual(["soil", "weather", "profit"]);
    expect(reasons[0].text).toContain("Soil pH is 7.2, within Wheat's usual range of 6.6–8.3");
    expect(reasons[2].text).toContain("highest of the crops compared");
  });

  it("changes with the farmer's inputs: a low rainfall becomes an honest attention note", () => {
    const { reasons } = whyReasons(crop({ important_factors: factors() }), response, { ...inputs, rainfall: 3 }, t);
    const w = reasons.find((x) => x.key === "weather");
    expect(w.tone).toBe("warn");
    expect(w.text).toContain("below the usual range of 10–40.4 mm");
    expect(w.text).toContain("Water availability needs attention");
  });

  it("names the soil value with the largest model contribution when several are outside the range", () => {
    const { reasons } = whyReasons(crop(), response, { ...inputs, ph: 5.0, potassium: 200 }, t);
    expect(reasons[0].tone).toBe("warn");
    expect(reasons[0].text).toContain("Soil pH is 7.2, below");   // the value shown is the one the API echoes for pH
    expect(reasons[0].text).toContain("1 more value(s)");
  });

  it("shows an unfavourable timing instead of hiding it", () => {
    const tl = { status: "not_ready", planting: "2026-11", harvest_start: "2027-03", harvest_end: "2027-04", selling: "2027-01", planting_in_window: true, months_stored: 0 };
    const { reasons } = whyReasons(crop({ timeline: tl }), response, inputs, t);
    expect(reasons[2].key).toBe("timing");
    expect(reasons[2].tone).toBe("warn");
    expect(reasons[2].text).toContain("will not be ready");
  });

  it("reports a loss honestly and leaves the profit reason out when there is no forecast", () => {
    const loss = whyReasons(crop({ economics: { selling_price: 1000, net_profit: -5000, roi_pct: -10, break_even_price: 1500 }, profit_rank: 3 }), response, inputs, t);
    expect(loss.reasons[2].text).toContain("may lose ₹5,000");
    const none = whyReasons(crop({ economics: null }), response, inputs, t);
    expect(none.reasons[2].key).toBe("timing");
  });

  it("mentions the profit leader only when the best crop is not it", () => {
    const r = whyReasons(crop({ profit_rank: 2 }), { ...response, highest_profit: "Onion" }, inputs, t);
    expect(r.reasons[2].text).toContain("Onion could earn more");
  });
});

describe("modelNotes (SHAP)", () => {
  it("takes the largest contributions, with direction and the farmer's value; unspecified soil type is skipped", () => {
    const notes = modelNotes(crop(), inputs, t);
    expect(notes.map((n) => n.feature)).toEqual(["ph", "N", "temperature"]);
    expect(notes[0].supports).toBe(true);
    expect(notes[0].text).toContain("positive contribution to Wheat's classification");
    expect(notes[0].text).toContain("within the usual Wheat range of 6.6–8.3");
  });

  it("tells a value outside the usual range apart from its SHAP direction", () => {
    const r = crop({ important_factors: [fac("K", 85, 36, 83, 0.6, "", 30)] });
    const [n] = modelNotes(r, { ...inputs, potassium: 85 }, t);
    expect(n.text).toContain("above the usual Wheat range of 36–83");
    expect(n.text).toContain("positive contribution");   // out of range does not mean the model was pushed away
  });

  it("marks a negative contribution as against, even when the value is inside the usual range", () => {
    const r = crop({ important_factors: [fac("ph", 7.2, 6.6, 8.3, -0.8, "", -40), fac("N", 90, 68, 113, 0.1, "", 3)] });
    const notes = modelNotes(r, inputs, t);
    expect(notes).toHaveLength(1);   // N is below the 5% share cut-off
    expect(notes[0].supports).toBe(false);
    expect(notes[0].text).toContain("negative contribution to Wheat's classification");
    expect(notes[0].text).toContain("within the usual Wheat range");   // inside the range, yet SHAP is negative: both facts shown
  });

  it("gives no range text for non-numeric features", () => {
    const r = crop({ important_factors: [{ feature: "city_code", label: "City", value: "Nagpur", shap_value: -0.3, share_pct: -20, typical_low: null, typical_high: null, unit: "" }] });
    expect(modelNotes(r, inputs, t)[0].text).toBe("City is Nagpur. The model's learned patterns gave this a negative contribution to Wheat's classification.");
  });
});
