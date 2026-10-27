// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import PersonalPlan from "./PersonalPlan";
import FarmExplanation from "./FarmExplanation";
import { planStep, planView } from "../../utils/personalPlan";
import en from "../../i18n/cropResult.en";
import enMain from "../../i18n/en";

afterEach(cleanup);

const fact = (crop, upfront, profit, low, o = {}) => ({
  crop, eligible: true, unsuitable: null, upfront, upfront_per_acre: upfront, fits_budget: true, affordable_area: null, extra_needed: null,
  profit, downside_profit: low, downside_pct: low / upfront, reliable_forecast: true, risk_level: "low", supply_note: null, ...o,
});
const plan = (over = {}) => ({
  inputs: { budget_inr: 60000, priority: "balanced", risk_level: "medium", area_acres: 1 }, outcome: "ok", best_for_you: "Cabbage",
  alternatives: ["Cauliflower"], matches_standard: false, no_fit_reason: null, fallback: null, cost_basis: { reference_year: 2024, inflation_annual_pct: 5 },
  crops: [fact("Cabbage", 55125, 6469, -21415, { risk_level: "medium" }), fact("Cauliflower", 58000, 8349, -22882, { risk_level: "medium" }),
    fact("Brinjal", 71662, 96931, 20608, { fits_budget: false, extra_needed: 11662, affordable_area: 0.84 }), fact("Wheat", 30870, 9261, -8907, { unsuitable: "poor_fit", risk_level: "medium" }),
    fact("Tomato", 121275, 3069, -53222, { fits_budget: false, extra_needed: 61275, affordable_area: 0.49, risk_level: "high", supply_note: { kind: "low", pct: -46, month: 1, years: "2023–2025", scope: "state" } })],
  excluded: [{ crop: "Brinjal", code: "over_budget", params: { extra: 11662, area: 0.84 } }, { crop: "Tomato", code: "risk", params: { level: "high" } },
    { crop: "Wheat", code: "poor_fit", params: {} }],
  ...over,
});
// the plan card chooses its own wording from the dictionary; the tests use the real English text
const response = (p = plan(), over = {}) => ({ personal_plan: p, area_acres: 1, best_overall: "Brinjal", ...over });
const text = (el) => el.textContent.replace(/\s+/g, " ").trim();

const withMoney = (f, o = {}) => ({ revenue: f.upfront + f.profit, marketing: 0, ...f, ...o });
const vplan = (over = {}) => {
  const p = plan();
  return { ...p, crops: p.crops.map((f) => withMoney(f)), full_field_best: { crop: "Brinjal", upfront: 71662, profit: 96931, revenue: 168593, risk_level: "medium", fits_budget: false, extra_needed: 11662, affordable_area: 0.84 },
    partial: null, partial_options: [], compare: ["Brinjal", "Cabbage", "Cauliflower"], ...over };
};

describe("personalised plan card", () => {
  it("is not rendered at all when the farmer gave no budget, priority or risk level", () => {
    const { container } = render(<PersonalPlan response={response(null)} />);
    expect(container.innerHTML).toBe("");
    expect(planView(response(null), (k) => k)).toBeNull();
  });

  it("starts with the budget, priority and risk the farmer chose, and shows the budget and the farm as big figures", () => {
    render(<PersonalPlan response={response(vplan())} />);
    expect(screen.getByTestId("plan-header").textContent).toBe("Based on your budget ₹60,000 · Priority: Balanced · Risk: Medium");
    const t = text(screen.getByTestId("personal-plan"));
    expect(t).toContain("Your money₹60,000");
    expect(t).toContain("Your farm1 acre · 40 guntha");
  });

  it("leaves the budget out when none was entered", () => {
    render(<PersonalPlan response={response(vplan({ inputs: { budget_inr: null, priority: "spend_less", risk_level: "low", area_acres: 1 } }))} />);
    expect(screen.getByTestId("plan-header").textContent).toBe("Based on your choices · Priority: Spend less to start · Risk: Low");
    expect(text(screen.getByTestId("personal-plan"))).not.toContain("Your money");
    expect(screen.queryByTestId("budget-bar")).toBeNull();
  });

  it("shows the best crop for the whole field with its cost, profit and the money it is short, beside the crop the budget pays for", () => {
    render(<PersonalPlan response={response(vplan())} />);
    const full = text(screen.getByTestId("plan-full"));
    expect(full).toContain("Best crop for your whole field");
    expect(full).toContain("Brinjal");
    expect(full).toContain("Cost to grow₹71,662");
    expect(full).toContain("Profit₹96,931");
    expect(screen.getByTestId("plan-shortfall").textContent).toBe("You are short by ₹11,662 for the whole field");
    const opt = text(screen.getByTestId("plan-option"));
    expect(opt).toContain("Cabbage");
    expect(opt).toContain("Cost to grow₹55,125");
    expect(opt).toContain("Profit₹6,469");
  });

  it("draws the budget bar: available money against the cost of the plan", () => {
    render(<PersonalPlan response={response(vplan())} />);
    const bar = screen.getByTestId("budget-bar");
    expect(text(bar)).toContain("Available money");
    expect(text(bar)).toContain("₹60,000");
    expect(text(bar)).toContain("₹55,125");
    const fills = bar.querySelectorAll(".pv-track > span");
    expect(fills[0].style.width).toBe("100%");
    expect(fills[1].style.width).toBe("92%");
    expect(fills[1].className).toBe("is-cost");
  });

  it("shows a smaller-area plan: acres and guntha, and the cost, sales and profit of that area", () => {
    const part = withMoney(vplan().crops[2], { crop: "Brinjal", area_acres: 0.55, guntha: 22, upfront: 39414, revenue: 100790, profit: 53312, fits_budget: true });
    const p = vplan({ inputs: { budget_inr: 40000, priority: "highest_profit", risk_level: "high", area_acres: 1 }, outcome: "partial", best_for_you: "Brinjal", alternatives: [], partial: part });
    render(<PersonalPlan response={response(p)} />);
    expect(screen.getByTestId("plan-grow").textContent).toBe("Grow it on 0.55 acre · 22 guntha of your field.");
    const opt = text(screen.getByTestId("plan-option"));
    expect(opt).toContain("Best option within your money");
    expect(opt).toContain("Cost to grow₹39,414");
    expect(opt).toContain("Sales₹1,00,790");
    expect(opt).toContain("Profit₹53,312");
    expect(text(screen.getByTestId("budget-bar"))).toContain("Cost of the whole field₹71,662");
    expect(text(screen.getByTestId("plan-compare"))).toContain("compared on 0.55 acre · 22 guntha");
  });

  it("compares the best crops with the same cost and profit the plan holds", () => {
    render(<PersonalPlan response={response(vplan())} />);
    const rows = screen.getByTestId("plan-compare").querySelectorAll("li");
    expect(rows).toHaveLength(3);
    expect(text(rows[0])).toContain("Brinjal");
    expect(text(rows[0])).toContain("₹96,931");
    expect(text(rows[0])).toContain("cost ₹71,662");
    expect(rows[1].className).toBe("is-pick");
  });

  it("lists, collapsed, why other crops are not shown, each with its plain reason", () => {
    render(<PersonalPlan response={response(vplan())} />);
    const d = screen.getByTestId("plan-excluded");
    expect(d.open).toBe(false);
    const items = Array.from(d.querySelectorAll("li")).map((li) => li.textContent);
    expect(items).toContain("Wheat — does not suit your soil and weather");
    expect(items).toContain("Tomato — low price risk".replace("low", "high"));
  });

  it("says plainly that no crop is practical, with the cheapest crop's full cost, when the budget does not even pay for a small plot", () => {
    const p = vplan({ outcome: "none_fit", best_for_you: null, alternatives: [], no_fit_reason: "budget", partial: null,
      fallback: { crop: "Cabbage", upfront: 55125, upfront_per_acre: 55125, extra_needed: 52125, affordable_area: 0.0544, risk_level: "medium", profit: 6469, downside_profit: -21415 },
      inputs: { budget_inr: 3000, priority: "balanced", risk_level: "medium", area_acres: 1 } });
    render(<PersonalPlan response={response(p)} />);
    expect(screen.getByTestId("plan-nofit").textContent).toContain("No suitable crop fits your budget.");
    expect(screen.queryByTestId("plan-option")).toBeNull();
    expect(screen.queryByTestId("budget-bar")).toBeNull();
  });

  it("says when no crop suits the field at all", () => {
    render(<PersonalPlan response={response(vplan({ outcome: "none_fit", best_for_you: null, alternatives: [], no_fit_reason: "no_suitable", full_field_best: null, compare: [] }))} />);
    expect(screen.getByTestId("plan-nofit").textContent).toContain("No crop is suitable for your soil, weather and months");
    expect(screen.queryByTestId("plan-full")).toBeNull();
  });

  it("ends with the estimates footer and the cost basis", () => {
    render(<PersonalPlan response={response(vplan())} />);
    expect(text(screen.getByTestId("personal-plan"))).toContain("Costs and prices are estimates from past data. Costs are approximate estimates (2024 prices + 5% a year).");
  });
});

describe("explanation step for the budget and priorities", () => {
  const t = (k, v = {}) => ({ ...enMain, ...en }[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => v[n]);
  it("writes 2-3 short sentences from the real values", () => {
    const s = planStep(response(), t);
    expect(s.headline).toBe("Cabbage");
    expect(s.lines).toEqual([
      "With ₹60,000, Cabbage and Cauliflower fit your budget.",
      "You chose Balanced and Medium risk, so Cabbage was picked: it gives the most profit for each rupee spent, and its price forecast held up in past tests.",
      "Costs are approximate estimates (2024 prices + 5% a year).",
    ]);
    // only crops that are suitable AND within the budget are named: Brinjal costs more, Wheat does not suit the field
  });

  it("says 'more predictable' only when the pick has a reliable forecast and a rejected alternative does not", () => {
    const p = plan(); p.crops.find((f) => f.crop === "Brinjal").reliable_forecast = false;       // Brinjal is a suitable crop that was not picked
    expect(planStep(response(p), t).lines[1]).toBe("You chose Balanced and Medium risk, so Cabbage was picked: it gives the most profit for each rupee spent, and its price has been more predictable in past tests.");
  });

  it("an unsuitable crop is not a rejected alternative, so it cannot make the pick 'more predictable'", () => {
    const p = plan(); p.crops.find((f) => f.crop === "Wheat").reliable_forecast = false;           // Wheat does not suit the field
    expect(planStep(response(p), t).lines[1]).toContain("and its price forecast held up in past tests.");
  });

  it("says 'held up in past tests' when the pick is reliable and no such comparison exists", () => {
    expect(planStep(response(), t).lines[1]).toContain("it gives the most profit for each rupee spent, and its price forecast held up in past tests.");
  });

  it("leaves the forecast sentence out when the pick's own forecast is not reliable", () => {
    const p = plan(); p.crops[0].reliable_forecast = false; p.crops[2].reliable_forecast = false;
    const line = planStep(response(p), t).lines[1];
    expect(line).toBe("You chose Balanced and Medium risk, so Cabbage was picked: it gives the most profit for each rupee spent.");
    expect(line).not.toMatch(/predictable|held up|less certain/);
  });

  it("is null without a plan, and says so when nothing fits", () => {
    expect(planStep(response(null), t)).toBeNull();
    const none = plan({ outcome: "none_fit", best_for_you: null, no_fit_reason: "no_suitable", fallback: null });
    const s = planStep(response(none), t);
    expect(s.headline).toBe("No crop fits");
    expect(s.lines[1]).toBe("No crop is suitable for your soil, weather and months, so there is no plan to show.");   // said once
  });
});

describe("the explanation page gets one extra numbered step only when there is a plan", () => {
  const FEATS = { N: [100, 80, 120], P: [60, 40, 80], K: [100, 80, 120], ph: [6.5, 6, 7.5], temperature: [24, 20, 30], humidity: [65, 50, 80], rainfall: [100, 50, 200] };
  const crop = () => ({
    crop_name: "Cabbage", rank: 1, recommended: true, feasible: true, eligible: true, profit_rank: 1, forecast_reliability: "tested", recommendation_score: 80,
    agronomic_score: 100, timing_score: 100, profit_score: 70, profit_score_used: 70,
    economics: { selling_price: 1000, gross_revenue: 90000, total_cost: 50000, net_profit: 40000, roi_pct: 80, effective_yield_q: 90, status: "fresh", months_stored: 0, break_even_price: 600, marketing_cost: 1, cultivation_cost: 1, storage_cost: 0, yield_q_per_acre: 100 },
    range_fit: { soil: { within: 4, total: 4 }, weather: { within: 3, total: 3 } }, timeline: { status: "fresh", planting: "2026-10", harvest_start: "2027-01", harvest_end: "2027-02", growth_months_min: 3, growth_months_max: 4, planting_in_window: true },
    important_factors: Object.entries(FEATS).map(([feature, [v, lo, hi]]) => ({ feature, value: String(v), unit: "", typical_low: lo, typical_high: hi, within_typical_range: true, direction: "supports", label: feature })),
    selling_options: [], market: null, score_points: { agronomic: 40, timing: 20, profit: 28 }, reasons: [], limitations: [], why: [],
  });
  const base = { best_overall: "Cabbage", highest_profit: "Cabbage", results: [crop()], city: "Pune", state: "Maharashtra", area_acres: 1, selling_date: "2027-02", planting_date: "2026-10", weights: {} };
  const inputs = { nitrogen: 100, phosphorus: 60, potassium: 100, ph: 6.5, temperature: 24, humidity: 65, rainfall: 100 };

  it("adds 'Your budget and priorities' as the last step with a plan, and nothing without one", () => {
    const r = render(<FarmExplanation result={crop()} response={{ ...base, personal_plan: plan() }} inputs={inputs} />);
    const titles = Array.from(r.container.querySelectorAll(".xp-step-title")).map((h) => h.textContent);
    expect(titles).toHaveLength(7);
    expect(titles[6]).toContain("Your budget and priorities");
    expect(titles[6]).toContain("Cabbage");
    expect(r.container.querySelectorAll(".xp-step")[6].textContent).toContain("With ₹60,000, Cabbage and Cauliflower fit your budget.");
    cleanup();
    const r2 = render(<FarmExplanation result={crop()} response={{ ...base, personal_plan: null }} inputs={inputs} />);
    const t2 = Array.from(r2.container.querySelectorAll(".xp-step-title")).map((h) => h.textContent);
    expect(t2).toHaveLength(6);
    expect(t2.join()).not.toContain("Your budget and priorities");
  });
});
