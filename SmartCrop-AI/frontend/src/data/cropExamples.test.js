import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CROP_EXAMPLES, DEFAULT_EXAMPLE, exampleToForm } from "./cropExamples";
import en from "../i18n/en";

// the model's own metadata: supported cities and each crop's usual (5th-95th percentile) ranges
const meta = JSON.parse(readFileSync(new URL("../../../backend/trained_models/crop_recommendation/metadata.json", import.meta.url), "utf8"));
const FEATURE = { nitrogen: "N", phosphorus: "P", potassium: "K", ph: "ph", temperature: "temperature", humidity: "humidity", rainfall: "rainfall" };
const SOILS = ["sandy_loam", "loam", "clay_loam", "alluvial", "unknown"];
const FORM_KEYS = ["nitrogen", "phosphorus", "potassium", "ph", "temperature", "humidity", "rainfall", "city", "soil_type", "area_acres", "planting_month", "selling_month"];

describe("recommendation form examples", () => {
  it("are the four requested ones, in order", () => {
    expect(CROP_EXAMPLES.map((e) => `${e.crop}/${e.city}`)).toEqual(["Wheat/Nagpur", "Onion/Nashik", "Cabbage/Pune", "Potato/Ahilyanagar"]);
  });

  it("button labels name the same crop and city as the values", () => {
    CROP_EXAMPLES.forEach((e, i) => {
      expect(en[`crop.form.example.${i}`]).toBe(`${e.crop} field, ${e.city}`);
    });
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
