import { describe, expect, it } from "vitest";
import { AREA_MAX, AREA_MIN, TABLE, areaError, bump, fmtNum, fromAcres, otherUnit, toAcres } from "./fieldSize";
import { roundNice } from "./budgetPlan";
import { compactRupees } from "./format";

const t = (k, v = {}) => ({
  "crop.form.validLabel.area_acres": "Field size", "valid.required": "{label} is required.", "valid.number": "{label} must be a number.",
  "crop.form.areaRange": "Enter a field size between {min} and {max} {unit}.", "crop.form.acresWord": "acres", "crop.form.gunthaWord": "guntha",
}[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => v[n]);

describe("acre / guntha conversion (1 acre = 40 guntha)", () => {
  it("converts typed text to the acres that are sent", () => {
    expect(toAcres("20", "guntha")).toBe("0.5");
    expect(toAcres("0.5", "guntha")).toBe("0.0125");
    expect(toAcres("1", "guntha")).toBe("0.025");
    expect(toAcres("7", "guntha")).toBe("0.175");
    expect(toAcres("2.5", "acre")).toBe("2.5");
    expect(toAcres("", "guntha")).toBe("");
    expect(toAcres("abc", "guntha")).toBe("abc");        // passed on, so validation can name it
  });

  it("shows acres in either unit without float noise", () => {
    expect(fromAcres("0.5", "guntha")).toBe("20");
    expect(fromAcres("0.0125", "guntha")).toBe("0.5");
    expect(fromAcres("0.175", "guntha")).toBe("7");
    expect(fromAcres("1", "acre")).toBe("1");
    expect(fmtNum(0.1 + 0.2)).toBe("0.3");
  });

  it("gives the line under the input in the other unit, only for a usable number", () => {
    expect(otherUnit("0.5", "acre")).toEqual({ value: "20", unit: "guntha" });
    expect(otherUnit("20", "guntha")).toEqual({ value: "0.5", unit: "acre" });
    expect(otherUnit("0.5", "guntha")).toEqual({ value: "0.0125", unit: "acre" });
    expect(otherUnit("", "acre")).toBeNull();
    expect(otherUnit("0", "acre")).toBeNull();
    expect(otherUnit("x", "guntha")).toBeNull();
  });

  it("has the five rows of the table", () => {
    expect(TABLE.map(([g, a]) => `${g}=${a}`)).toEqual(["0.5=0.0125", "1=0.025", "10=0.25", "20=0.5", "40=1"]);
  });
});

describe("stepping", () => {
  it("is 0.5 in acres and 1 in guntha, inside the limits", () => {
    expect(bump("1", "acre", 1)).toBe("1.5");
    expect(bump("1", "acre", -1)).toBe("0.5");
    expect(bump("0.5", "acre", -1)).toBe(String(AREA_MIN));
    expect(bump("10", "guntha", 1)).toBe("11");
    expect(bump("0.5", "guntha", -1)).toBe("0.5");
    expect(bump("1000", "acre", 1)).toBe(String(AREA_MAX));
    expect(bump("40000", "guntha", 1)).toBe("40000");
    expect(bump("", "acre", 1)).toBe("0.5");
  });
});

describe("limits", () => {
  it("accepts 1/2 guntha up to 1,000 acres and words the error in the chosen unit", () => {
    expect(areaError("0.0125", "acre", t)).toBeNull();
    expect(areaError("1000", "guntha", t)).toBeNull();
    expect(areaError("0", "acre", t)).toBe("Enter a field size between 0.0125 and 1,000 acres.");
    expect(areaError("0.01", "guntha", t)).toBe("Enter a field size between 0.5 and 40,000 guntha.");
    expect(areaError("", "acre", t)).toBe("Field size is required.");
    expect(areaError("x", "acre", t)).toBe("Field size must be a number.");
  });
});

describe("very small fields never round to nothing", () => {
  it("rounds the helper text finer for small costs", () => {
    expect(roundNice(61740)).toBe(62000);
    expect(roundNice(5436)).toBe(5400);
    expect(roundNice(385)).toBe(390);
    expect(roundNice(3)).toBe(10);
  });
  it("shows small rupee amounts in thousands with a decimal, not rounded to the nearest thousand", () => {
    expect(compactRupees(1400)).toBe("₹1.4K");
    expect(compactRupees(3000)).toBe("₹3K");
    expect(compactRupees(19000)).toBe("₹19K");
    expect(compactRupees(385)).toBe("₹385");
  });
});
