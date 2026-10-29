import { describe, expect, it } from "vitest";
import en from "./en";
import hi from "./hi";
import mr from "./mr";

// the explanation cards (wf.), the field conditions (fc.) and the influence chart (fi.)
const scoped = (d) => Object.entries(d).filter(([k]) => /^(wf|fc|fi)\./.test(k));
const placeholders = (s) => (String(s).match(/\{\w+\}/g) || []).sort();
const DISCLAIMER = /not used to calculate|does not change the predicted price|not inputs to the current price|not an input to|context only|संदर्भ के लिए|फक्त संदर्भ/i;

describe("explanation text in English, Hindi and Marathi", () => {
  it.each([["hi", hi], ["mr", mr]])("every %s key exists in English with exactly the same placeholders", (_, d) => {
    const own = scoped(d);
    expect(own.length).toBeGreaterThanOrEqual(24);
    for (const [k, v] of own) {
      expect(en[k], k).toBeTypeOf("string");
      expect(placeholders(v), k).toEqual(placeholders(en[k]));
    }
  });

  it("every explanation-card key has a Hindi and a Marathi version", () => {
    const cards = Object.keys(en).filter((k) => k.startsWith("wf."));
    for (const k of cards) {
      expect(hi[k], `hi ${k}`).toBeTypeOf("string");
      expect(mr[k], `mr ${k}`).toBeTypeOf("string");
    }
  });

  it("English, Hindi and Marathi have exactly the same factor-card keys", () => {
    const wf = (d) => Object.keys(d).filter((k) => k.startsWith("wf.")).sort();
    expect(wf(hi)).toEqual(wf(en));
    expect(wf(mr)).toEqual(wf(en));
  });

  it.each([["en", en], ["hi", hi], ["mr", mr]])("%s: every card line is one short line of 12 words or fewer", (_, d) => {
    const lines = Object.entries(d).filter(([k]) => k.startsWith("wf.line."));
    expect(lines).toHaveLength(7);
    for (const [k, v] of lines) expect(v.trim().split(/\s+/).length, k).toBeLessThanOrEqual(12);
  });

  it.each([["en", en], ["hi", hi], ["mr", mr]])("%s: no rainfall text is left in the explanation cards or the influence chart", (_, d) => {
    expect(Object.keys(d).filter((k) => /^(wf|fi)\..*rain/.test(k))).toEqual([]);
    expect(Object.entries(d).filter(([k, v]) => /^(wf|fi)\./.test(k) && /rainfall|\brain\b|बारिश|पाऊस/i.test(v)).map(([k]) => k)).toEqual([]);
  });

  it.each([["en", en], ["hi", hi], ["mr", mr]])("%s: the season and crop/market explanation has all four variants with the right placeholders", (_, d) => {
    for (const dir of ["up", "down"]) {
      expect(placeholders(d[`wf.why.season.${dir}`]), `season ${dir}`).toEqual(["{crop}"]);
      expect(placeholders(d[`wf.why.market.${dir}`]), `market ${dir}`).toEqual(["{crop}", "{market}"]);
    }
    for (const k of ["wf.why.adds", "wf.why.subtracts"]) {
      expect(placeholders(d[k]), k).toEqual(["{n}"]);
      expect(d[k], k).toContain("₹{n}");
    }
    // only past price patterns are named, never a cause
    const why = Object.entries(d).filter(([k]) => k.startsWith("wf.why.")).map(([, v]) => v).join(" ");
    expect(why).not.toMatch(/supply|demand|weather|rain/i);
  });

  it.each([["en", en], ["hi", hi], ["mr", mr]])("%s: the own-scale text of the farm-guidance columns has the right placeholders", (_, d) => {
    for (const k of ["fi.scale.temperature", "fi.scale.ph"]) expect(placeholders(d[k]), k).toEqual(["{pct}", "{value}"]);
    for (const k of ["fi.scale.note", "fi.tip.scale"]) {
      expect(d[k], k).toBeTypeOf("string");
      expect(placeholders(d[k]), k).toEqual([]);
    }
  });

  it.each([["en", en], ["hi", hi], ["mr", mr]])("%s has none of the repeated 'not used to calculate the price' disclaimers", (_, d) => {
    // the one exception is the influence chart's tooltip on a farm-guidance column (plain, or on its own scale: a column shows one of the
    // two), which says this exactly once, by request
    const tips = ["fi.tip.guidance", "fi.tip.scale"];
    expect(scoped(d).filter(([k, v]) => !tips.includes(k) && DISCLAIMER.test(v)).map(([k]) => k)).toEqual([]);
  });
});
