// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../charts/ProfitComparisonChart", () => ({ default: () => <div data-testid="chart" /> }));
vi.mock("../CropArt", () => ({ default: () => null, PHOTOS: {} }));

import CropCompare from "./CropCompare";
import RankingCompare from "./RankingCompare";

afterEach(cleanup);

const crop = (name, rank, profit, cost, profitRank, extra = {}) => ({
  crop_name: name, rank, profit_rank: profitRank, feasible: true, eligible: true, profitable: profit > 0,
  low_agronomic_suitability: false, recommended: rank === 1, forecast_reliability: "tested",
  status: { key: rank === 1 ? "best" : "recommended", tone: "good" },
  economics: { selling_price: 2000, gross_revenue: profit + cost, total_cost: cost, net_profit: profit, roi_pct: (profit / cost) * 100 },
  range_fit: { soil: { within: 4, total: 4 }, weather: { within: 3, total: 3 } }, timeline: { status: "fresh" }, ...extra,
});
const base = {
  selling_date: "2027-03", area_acres: 1, weights: { agronomic: 0.4, timing: 0.2, profit: 0.4 },
  results: [crop("Cauliflower", 1, 32529, 68739, 2), crop("Brinjal", 2, 34646, 80907, 1)],
};
const differ = {
  ...base, best_overall: "Cauliflower", highest_profit: "Brinjal",
  ranking_explanation: { best_overall: "Cauliflower", highest_profit: "Brinjal", same_crop: false, profit_gap: 2117,
    reasons: [{ code: "returns", points: 2, params: {} }] },
};
const same = {
  ...base, best_overall: "Brinjal", highest_profit: "Brinjal",
  results: [crop("Brinjal", 1, 34646, 80907, 1), crop("Cauliflower", 2, 32529, 68739, 2)],
  ranking_explanation: { best_overall: "Brinjal", highest_profit: "Brinjal", same_crop: true, profit_gap: null, reasons: [] },
};

describe("RankingCompare", () => {
  it("builds the profit and ROI comparisons from the API figures", () => {
    const { container } = render(<RankingCompare response={differ} />);
    const text = container.textContent;
    expect(text).toContain("Why Cauliflower ranks first");
    expect(text).toContain("Brinjal may earn you ₹2,117 more in total profit");
    expect(text).toContain("costs less to grow");
    expect(text).toContain("₹32,529");
    expect(text).toContain("₹34,646");
    expect(text).toContain("Estimated costs: Cauliflower ₹68,739, Brinjal ₹80,907");
    expect(text).toContain("about ₹47"); // 32529 / 68739 = 47.3 %, 34646 / 80907 = 42.8 %
    expect(text).toContain("Cauliflower gives about ₹4 more profit per ₹100 invested");
    expect(text).toContain("Choose Cauliflower if you want a better return");
  });

  it("does not show a definitions block", () => {
    const { container } = render(<RankingCompare response={differ} />);
    expect(container.querySelector(".why-defs")).toBeNull();
    expect(container.textContent).not.toContain("What these words mean");
  });

  it("renders nothing at all when the same crop is overall #1 and profit #1", () => {
    const { container } = render(<RankingCompare response={same} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when the profit rank is missing", () => {
    const r = structuredClone(differ);
    r.results.forEach((x) => { x.profit_rank = null; });
    expect(render(<RankingCompare response={r} />).container.innerHTML).toBe("");
  });

  it("shows the right names and values for a different pair of crops", () => {
    const r = {
      ...base, best_overall: "Onion", highest_profit: "Tomato",
      results: [crop("Onion", 1, 20000, 50000, 2), crop("Tomato", 2, 25000, 90000, 1)],
      ranking_explanation: { best_overall: "Onion", highest_profit: "Tomato", same_crop: false, profit_gap: 5000, reasons: [] },
    };
    const { container } = render(<RankingCompare response={r} />);
    expect(container.textContent).toContain("Why Onion ranks first");
    expect(container.textContent).toContain("Tomato may earn you ₹5,000 more");
    expect(container.textContent).toContain("Estimated costs: Onion ₹50,000, Tomato ₹90,000");
    expect(container.textContent).toContain("Onion gives about ₹12 more profit per ₹100"); // 40% vs 28%
  });

  it("hides the ROI comparison when the costs are missing", () => {
    const bad = structuredClone(differ);
    bad.results[0].economics.total_cost = 0;
    const { container } = render(<RankingCompare response={bad} />);
    expect(container.querySelectorAll(".why-panel")).toHaveLength(1);
    expect(container.textContent).not.toContain("per ₹100");
    expect(container.textContent).not.toContain("Choose Cauliflower");
  });

  it("renders nothing when no crop is recommended", () => {
    const none = structuredClone(differ);
    none.best_overall = null;
    none.results.forEach((x) => { x.recommended = false; });
    expect(render(<RankingCompare response={none} />).container.innerHTML).toBe("");
  });
});

describe("CropCompare order", () => {
  it("holds only the short why-note, not the long ranking explanation (that lives on the explanation page)", () => {
    const { container } = render(<CropCompare response={differ} selected="Cauliflower" onSelect={() => {}} />);
    expect(container.querySelector(".why-box")).toBeNull();
    expect(container.textContent).not.toContain("Why Cauliflower ranks first");
    expect(container.querySelector("[data-testid=chart-note]").textContent).toContain("Why Cauliflower is recommended");
    const chart = container.querySelector("[data-testid=chart]"), toggle = container.querySelector("button.btn-link");
    expect(container.querySelector("table")).toBeNull();
    expect(!!(chart.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("goes straight from the chart to the cost toggle when one crop wins both", () => {
    const { container } = render(<CropCompare response={same} selected="Brinjal" onSelect={() => {}} />);
    expect(container.querySelector(".why-box")).toBeNull();
    const chart = container.querySelector("[data-testid=chart]"), toggle = container.querySelector("button.btn-link");
    expect(chart.nextElementSibling).toBe(container.querySelector("[data-testid=chart-note]"));      // chart, then why-block, then the toggle
    expect(container.querySelector("[data-testid=chart-note]").nextElementSibling).toBe(toggle);
  });
});
