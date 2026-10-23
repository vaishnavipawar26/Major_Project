import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CROP_EXAMPLES, DEFAULT_EXAMPLE, exampleLabel, exampleToForm } from "./cropExamples";
import en from "../i18n/en";
import hi from "../i18n/hi";
import mr from "../i18n/mr";

// the model's own metadata: supported cities and each crop's usual (5th-95th percentile) ranges
const meta = JSON.parse(readFileSync(new URL("../../../backend/trained_models/crop_recommendation/metadata.json", import.meta.url), "utf8"));
const FEATURE = { nitrogen: "N", phosphorus: "P", potassium: "K", ph: "ph", temperature: "temperature", humidity: "humidity", rainfall: "rainfall" };
const SOILS = ["sandy_loam", "loam", "clay_loam", "alluvial", "unknown"];
const FORM_KEYS = ["nitrogen", "phosphorus", "potassium", "ph", "temperature", "humidity", "rainfall", "city", "soil_type", "area_acres", "planting_month", "selling_month"];

/** A minimal t(): the dictionary entry with {vars} filled in, or the key itself when there is none. */
const translator = (dict) => (k, v = {}) => (dict[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => v[n]);

describe("recommendation form examples", () => {
  it("are the four requested ones, in order", () => {
    expect(CROP_EXAMPLES.map((e) => `${e.crop}/${e.city}`)).toEqual(["Wheat/Nagpur", "Onion/Nashik", "Cabbage/Pune", "Potato/Ahilyanagar"]);
  });

  it("button labels are '<City> · <planting month> → <selling month>', read from each example's own values", () => {
    const t = translator(en);
    expect(CROP_EXAMPLES.map((e) => exampleLabel(e, t))).toEqual(["Nagpur · Nov → Mar", "Nashik · Nov → Mar", "Pune · Oct → Jan", "Ahilyanagar · Oct → Feb"]);
    expect(new Set(CROP_EXAMPLES.map((e) => exampleLabel(e, t))).size).toBe(CROP_EXAMPLES.length);
  });

  it("no example label, in any language, contains a crop name", () => {
    const crops = ["Wheat", "Onion", "Cabbage", "Potato", "Tomato", "Brinjal", "Cauliflower"];
    for (const [lang, dict] of Object.entries({ en, hi, mr })) {
      const t = translator(dict);
      const labels = CROP_EXAMPLES.map((e) => exampleLabel(e, t));
      const names = crops.flatMap((c) => [c, dict[`name.crop.${c}`]]).filter(Boolean);
      for (const l of labels) for (const n of names) expect([lang, l, n, l.includes(n)]).toEqual([lang, l, n, false]);
    }
    for (const dict of [en, hi, mr]) expect(Object.keys(dict).filter((k) => /^crop\.form\.example\.\d/.test(k))).toEqual([]);
  });

  for (const ex of CROP_EXAMPLES) {
    it(`${ex.crop} fills every field with supported, crop-appropriate values`, () => {
      const form = exampleToForm(ex);
      expect(Object.keys(form).sort()).toEqual([...FORM_KEYS].sort());
      expect(meta.cities).toContain(ex.city);
      expect(SOILS).toContain(ex.soil_type);
      expect(ex.planting_month).not.toBe(ex.selling_month);
      expect(ex.area_acres).toBeGreaterThan(0);
      const ranges = meta.feature_ranges_by_crop[ex.crop];
      for (const [key, feat] of Object.entries(FEATURE)) {
        expect(ex[key], `${ex.crop} ${key}`).toBeGreaterThanOrEqual(ranges[feat].p05);
        expect(ex[key], `${ex.crop} ${key}`).toBeLessThanOrEqual(ranges[feat].p95);
      }
    });
  }

  it("the sample link uses the onion example, and form values are strings", () => {
    expect(DEFAULT_EXAMPLE.crop).toBe("Onion");
    expect(exampleToForm(DEFAULT_EXAMPLE).nitrogen).toBe("80");
    expect(exampleToForm(DEFAULT_EXAMPLE).crop).toBeUndefined();
  });
});
