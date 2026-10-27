import { describe, expect, it } from "vitest";
import real from "./fixtures/influence.real.json";
import { buildInfluence, rankingFactors, rivalOf } from "./influence";
import { translate } from "../i18n/LanguageContext";

const t = (k, v) => translate("en", k, v);
const INPUT = (req) => ({ nitrogen: req.nitrogen, phosphorus: req.phosphorus, potassium: req.potassium, temperature: req.temperature,
  humidity: req.humidity, ph: req.ph, rainfall: req.rainfall });
const SCENARIOS = ["nashik", "wheat", "nagpur", "k_high", "pune_kharif"];     // "april" has no eligible crop at all
const run = (name, cropIdx = 0) => {
  const { req, response } = real[name];
  const sel = response.results[cropIdx];
  return { sel, response, inf: buildInfluence(sel, response, INPUT(req), t) };
};

describe("bar values (the revised ranking: location, planting, timing, soil, weather, profit)", () => {
  it.each(SCENARIOS)("%s: the factor points add up to the score gap with the rival", (name) => {
    const { response } = run(name);
    for (const sel of response.results.slice(0, 3)) {
      const ref = rivalOf(sel, response.results);
      const sum = rankingFactors(sel, ref, response.weights).reduce((s, f) => s + f.pts, 0);
      expect(Math.abs(sum - (sel.recommendation_score - ref.recommendation_score))).toBeLessThan(0.3);
    }
  });

  it("every bar is points earned out of a known maximum; together they are the overall score", () => {
    for (const n of SCENARIOS) {
      const { inf, sel } = run(n);
      expect(inf.bars.length).toBe(11);
      expect(inf.bars.map((b) => b.key)).toEqual(expect.arrayContaining(["location", "planting", "timing", "profit", "N", "rainfall"]));
      for (const b of inf.bars) expect(b.earned + b.missed).toBeCloseTo(b.max, 5);
      expect(inf.bars.reduce((s, b) => s + b.earned, 0)).toBeCloseTo(sel.recommendation_score, 0);
      expect(inf.bars.filter((b) => b.earned > 0).length).toBeGreaterThan(6);
    }
  });

  it("the strongest factor is the one with the largest advantage over the rival", () => {
    for (const n of SCENARIOS) {
      const { inf } = run(n);
      const best = Math.max(...inf.bars.map((b) => b.advantage));
      expect(inf.bars.find((b) => b.key === inf.mainCard.key).advantage).toBeCloseTo(best, 5);
    }
  });

  it("location decides when the closest rival is grown elsewhere (Nagpur: Tomato over the more profitable Onion)", () => {
    const { inf, sel, response } = run("nagpur");
    const onion = response.results.find((r) => r.crop_name === "Onion");
    expect(sel.crop_name).toBe("Tomato");
    expect(onion.economics.net_profit).toBeGreaterThan(sel.economics.net_profit);
    expect(inf.mainCard.key).toBe("location");
    expect(inf.mainCard.text).toContain("Nagpur");
    expect(inf.mainCard.text + inf.mainCard.influence).not.toMatch(/Onion|points over| vs /);   // the card never names another crop
    expect(inf.mainCard.influence).toMatch(/^\d+\.\d of \d+\.\d points$/);
    expect(inf.bars.find((b) => b.key === "profit").advantage).toBeLessThan(0);      // profit worked against Tomato
  });

  it("the strongest factor changes with the scenario", () => {
    expect(new Set(SCENARIOS.map((n) => run(n).inf.mainCard.key)).size).toBeGreaterThan(1);
  });

  it("tooltips carry the reference range, units, local climate and a qualitative model note", () => {
    const { inf } = run("k_high");
    const k = inf.bars.find((b) => b.key === "K");
    expect(k.range).toMatch(/\d–\d/);
    expect(k.status).toBe("limits");
    expect(["for", "against", "little"]).toContain(k.model);
    expect(inf.bars.find((b) => b.key === "rainfall").range).toContain("mm/month");
    const loc = inf.bars.find((b) => b.key === "location");
    expect(loc.input).toBe("Nashik");
    expect(loc.extras.map((e) => e[1]).join(" ")).toContain("mm/month");
    expect(inf.bars.find((b) => b.key === "profit").extras.map((e) => e[1]).join(" ")).toContain("₹");
  });

  it("never exposes SHAP or log-odds wording", () => {
    for (const n of SCENARIOS) {
      const { inf } = run(n);
      expect(JSON.stringify([inf.summary, inf.points, inf.mainCard, inf.bars.map((b) => [b.text, b.extras])])).not.toMatch(/shap|log-odds/i);
    }
  });
});

describe("what needs attention", () => {
  it("is never the generic price-forecast warning", () => {
    for (const n of SCENARIOS) expect(run(n).inf.points.attention ?? "").not.toMatch(/forecast|indicative/i);
  });

  it("names the soil value that is out of range, with a soil-test hint", () => {
    const a = run("k_high").inf.points.attention;
    expect(a).toMatch(/potassium/);
    expect(a).toContain("above");
    expect(a).toContain("soil test");
  });

  it("is empty when nothing in the data limits the crop", () => {
    expect(run("wheat").inf.points.attention).toBeNull();
  });

  it("reports an off-season planting month", () => {
    const { response, sel } = run("nashik");
    const off = { ...sel, planting_fit_score: 0, planting_suitable: false, score_points: { ...sel.score_points, planting: 0 } };
    const inf = buildInfluence(off, response, INPUT(real.nashik.req), t);
    expect(inf.points.attention).toContain("outside the recommended growing season");
  });
});

describe("other crops and old data", () => {
  it("explaining a lower-ranked crop compares it with the winner", () => {
    const { inf, response } = run("nashik", 1);
    expect(inf.isBest).toBe(false);
    expect(inf.ref).toBe(response.results[0].crop_name);
    expect(inf.summary).toContain("ranks #2");
  });

  it("returns null for a response without the needed fields", () => {
    const { response, sel } = run("nashik");
    expect(buildInfluence({ ...sel, location: undefined }, response, {}, t)).toBeNull();
  });
});
