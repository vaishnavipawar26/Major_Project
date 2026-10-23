// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import CropCompare from "./CropCompare";

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
afterEach(cleanup);

const crop = (name, rank, profit, extra = {}) => ({
  crop_name: name, rank, profit_rank: null, feasible: true, eligible: true, recommended: rank === 1, forecast_reliability: "tested", price_policy: "model",
  status: { key: "notTop", tone: "neutral" }, economics: { selling_price: 1500, gross_revenue: profit + 90000, total_cost: 90000, net_profit: profit, roi_pct: 10, status: "fresh" },
  range_fit: { soil: { within: 4, total: 4 }, weather: { within: 3, total: 3 } }, timeline: { status: "fresh" }, ...extra,
});
const response = (over = {}) => ({
  selling_date: "2027-02", area_acres: 1, best_overall: "Potato", highest_profit: "Brinjal",
  results: [crop("Potato", 1, 18816, { price_policy: "context_only", profit_rank: 2 }), crop("Brinjal", 4, 48467, { eligible: false, recommended: false, profit_rank: 1 })],
  ranking_explanation: { best_overall: "Potato", highest_profit: "Brinjal", same_crop: false, profit_gap: 29651,
    reasons: [{ code: "fit", points: 22.9, params: { best_in: 7, top_in: 3, total: 7 } }] },
  ...over,
});

describe("profit chart section", () => {
  it("has a legend entry for rough estimates only when a crop has no reliable price forecast, and one for the bold outline", () => {
    render(<CropCompare response={response()} selected="Potato" onSelect={() => {}} />);
    expect(screen.getByTestId("rough-legend").textContent).toBe("≈ rough estimate — no reliable price forecast for this crop");
    expect(document.body.textContent).toContain("Bold outline: the crop shown below");
    cleanup();
    const r = response(); r.results[0].price_policy = "model";
    render(<CropCompare response={r} selected="Potato" onSelect={() => {}} />);
    expect(screen.queryByTestId("rough-legend")).toBeNull();
  });
});
