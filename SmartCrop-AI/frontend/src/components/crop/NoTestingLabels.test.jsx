// @vitest-environment jsdom
// Testing/diagnostic success labels ("passed testing", "Reliable", "Tested and checked") are not shown
// to farmers; the matching cautions for less reliable forecasts still are.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../i18n/en";
import hi from "../../i18n/hi";
import mr from "../../i18n/mr";

vi.mock("../charts/ProfitComparisonChart", () => ({ default: () => <div data-testid="chart" /> }));
vi.mock("../CropArt", () => ({ default: () => null, PHOTOS: {} }));

import BestCropCard from "./BestCropCard";
import BestTimeHero from "./BestTimeHero";
import CropCompare from "./CropCompare";

afterEach(cleanup);

const TESTING_WORDS = /passed testing|tested and checked|baseline in past tests|^Reliable$/i;

const crop = (name, rank, reliability, extra = {}) => ({
  crop_name: name, rank, profit_rank: rank, feasible: true, eligible: true, profitable: true, recommended: rank === 1,
  low_agronomic_suitability: false, forecast_reliability: reliability, recommendation_score: 80 - rank,
  status: { key: rank === 1 ? "best" : "recommended", tone: "good" },
  economics: { selling_price: 2000, gross_revenue: 90000, total_cost: 50000, net_profit: 40000, roi_pct: 80, effective_yield_q: 45 },
  range_fit: { soil: { within: 4, total: 4 }, weather: { within: 3, total: 3 } },
  timeline: { status: "fresh", planting: "2026-10", harvest_start: "2027-01", harvest_end: "2027-02" },
  selling_options: [{ month: "2027-02", price: 2000, net_profit: 40000, status: "fresh" }],
  ...extra,
});
const response = (bestReliability, otherReliability = "limited") => ({
  selling_date: "2027-02", area_acres: 1, weights: { agronomic: 0.4, timing: 0.2, profit: 0.4 },
  best_overall: "Wheat", highest_profit: "Wheat",
  results: [crop("Wheat", 1, bestReliability), crop("Onion", 2, otherReliability)],
  ranking_explanation: { best_overall: "Wheat", highest_profit: "Wheat", same_crop: true, profit_gap: null, reasons: [] },
});

describe("best crop card", () => {
  it("shows no 'Price forecast: Passed testing' fact when the forecast passed testing", () => {
    const { container } = render(<BestCropCard response={response("tested")} onSelect={() => {}} />);
    expect(container.textContent).not.toMatch(/passed testing/i);
    expect(container.textContent).not.toMatch(/baseline in past tests/i);
    expect(container.textContent).not.toContain("Price forecast");
    expect(container.querySelectorAll(".best-stat")).toHaveLength(4); // profit, price, score, harvest
    expect(container.querySelector(".best-warning")).toBeNull();
  });

  it("still shows the limited-accuracy fact and warning when the forecast is less reliable", () => {
    const { container } = render(<BestCropCard response={response("limited")} onSelect={() => {}} />);
    expect(container.textContent).toContain("Limited accuracy");
    expect(container.querySelector(".best-warning").textContent).toMatch(/limited reliability/);
    expect(container.querySelectorAll(".best-stat")).toHaveLength(5);
  });
});

describe("best time to sell", () => {
  it("has no green 'Reliable' badge for a tested forecast, but keeps the useful 'already the best time' line", () => {
    const r = response("tested");
    const { container } = render(<BestTimeHero result={r.results[0]} response={r} reliable />);
    expect(container.querySelector(".best-hero-badge")).toBeNull();
    expect([...container.querySelectorAll("span")].some((s) => TESTING_WORDS.test(s.textContent.trim()))).toBe(false);
    expect(container.textContent).toContain("Your chosen month is already the best time to sell");
  });

  it("keeps the 'Limited accuracy' caution badge", () => {
    const r = response("limited");
    const { container } = render(<BestTimeHero result={r.results[0]} response={r} reliable={false} />);
    expect(container.querySelector(".best-hero-badge.is-warn").textContent).toBe("Limited accuracy");
  });
});

describe("crop comparison table", () => {
  it("leaves tested rows blank in the forecast column and keeps 'Limited accuracy' for others", () => {
    const { container } = render(<CropCompare response={response("tested", "limited")} selected="Wheat" onSelect={() => {}} />);
    expect(container.textContent).not.toMatch(/passed testing/i);
    const rows = [...container.querySelectorAll("tbody tr")];
    const forecastCell = (tr) => tr.querySelectorAll("td")[tr.querySelectorAll("td").length - 2].textContent;
    expect(forecastCell(rows[0])).toBe("");
    expect(forecastCell(rows[1])).toBe("Limited accuracy");
  });
});

describe("dictionaries", () => {
  const all = { en, mr, hi };
  it.each(Object.keys(all))("%s has no testing-success texts left", (lang) => {
    const values = Object.values(all[lang]).join("\n");
    expect(values).not.toMatch(/passed testing|Passed testing|Tested and checked|चाचणीत पास|जाँच में पास/);
    for (const k of ["price.result.validated", "price.kid.tested", "table.validated", "cr.rel.tested", "cr.rel.testedSub", "cr.hero.reliable"]) {
      expect(all[lang][k]).toBeUndefined();
    }
  });

  it.each(Object.keys(all))("%s still has the cautions, errors and farming warnings", (lang) => {
    for (const k of ["price.result.roughGuide", "price.kid.notTested", "price.form.roughBody", "price.form.roughValidated",
      "cr.rel.limited", "cr.fin.limitedWarning", "cr.hero.limited", "table.lessReliable", "auth.errEmail", "auth.errPassword",
      "timeline.concl.spoiled", "timeline.concl.not_ready"]) {
      expect(typeof (all[lang][k] ?? en[k]), `${lang} ${k}`).toBe("string");
    }
    expect(en["price.form.roughValidated"]).toBe("More reliable forecast lengths for {crop}: {days} days ahead.");
  });
});
