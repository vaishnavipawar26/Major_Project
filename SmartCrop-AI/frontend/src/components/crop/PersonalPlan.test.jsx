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

describe("personalised plan card", () => {
  it("is not rendered at all when the farmer gave no budget, priority or risk level", () => {
    const { container } = render(<PersonalPlan response={response(null)} />);
    expect(container.innerHTML).toBe("");
    expect(planView(response(null), (k) => k)).toBeNull();
  });

  it("starts with the budget, priority and risk the farmer chose", () => {
    render(<PersonalPlan response={response()} />);
    expect(screen.getByTestId("plan-header").textContent).toBe("Based on your budget ₹60,000 · Priority: Balanced · Risk: Medium");
  });

  it("leaves the budget out of that line when none was entered", () => {
    render(<PersonalPlan response={response(plan({ inputs: { budget_inr: null, priority: "spend_less", risk_level: "low", area_acres: 1 } }))} />);
    expect(screen.getByTestId("plan-header").textContent).toBe("Based on your choices · Priority: Spend less to start · Risk: Low");
  });

  it("shows the best crop and an alternative as small cards with cost against the budget, profit, low-end profit, risk chip and one reason", () => {
    render(<PersonalPlan response={response()} />);
    const best = screen.getByTestId("plan-card-Cabbage");
    const t = text(best);
    expect(t).toContain("Cabbage");
    expect(t).toContain("Best for you");
    expect(t).toContain("₹55,125 of your ₹60,000");
    expect(best.querySelector(".pp-bar > span").style.width).toBe("92%");
    expect(t).toContain("Estimated profit₹6,469");
    expect(t).toContain("If the price is at the low end of its expected range−₹21,415");
    expect(within(best).getByTestId("risk-chip").textContent).toBe("Medium risk");
    expect(t).toContain("Fits your budget and gives the best profit for the money among suitable crops.");
    const alt = screen.getByTestId("plan-card-Cauliflower");
    expect(text(alt)).toContain("Alternative");
    expect(text(alt)).toContain("Also suitable, and fits your budget and risk level.");
    expect(screen.getAllByTestId(/plan-card-/)).toHaveLength(2);
  });

  it("explains an alternative by what is really different from the pick", () => {
    const p = plan({ alternatives: ["Brinjal"], crops: plan().crops.map((f) => (f.crop === "Brinjal" ? { ...f, upfront: 50000, fits_budget: true, extra_needed: null } : f)) });
    render(<PersonalPlan response={response(p)} />);
    expect(text(screen.getByTestId("plan-card-Brinjal"))).toContain("Costs less to start than Cabbage.");
  });

  it("adds a supply chip with its basis, and says Maharashtra-wide when the whole state was used", () => {
    const p = plan({ alternatives: ["Tomato"] });
    p.crops.find((f) => f.crop === "Tomato").fits_budget = true;
    render(<PersonalPlan response={response(p)} />);
    const card = screen.getByTestId("plan-card-Tomato");
    expect(within(card).getByTestId("supply-chip").textContent).toBe("Usually low supply in January");
    expect(text(card)).toContain("Based on past arrivals 2023–2025, not a forecast · Maharashtra-wide");
  });

  it("matches the standard #1: one line and one short reason instead of the cards", () => {
    render(<PersonalPlan response={response(plan({ matches_standard: true }), { best_overall: "Cabbage" })} />);
    const m = screen.getByTestId("plan-match");
    expect(m.textContent).toContain("Our top recommendation also fits your budget and preferences.");
    expect(m.textContent).toContain("Fits your budget and gives the best profit for the money among suitable crops.");
    expect(screen.queryAllByTestId(/plan-card-/)).toHaveLength(0);
  });

  it("still names the other crops that fit, compactly, with their risk, when the plan matches the standard #1", () => {
    const p = plan({ matches_standard: true, alternatives: ["Cauliflower", "Brinjal"] });
    p.crops.find((f) => f.crop === "Brinjal").fits_budget = true;
    render(<PersonalPlan response={response(p, { best_overall: "Cabbage" })} />);
    expect(screen.getByTestId("plan-others").textContent).toBe("Other options that fit: Cauliflower (Medium risk), Brinjal (Low risk)");
  });

  it("shows no 'other options' line when nothing else fits", () => {
    render(<PersonalPlan response={response(plan({ matches_standard: true, alternatives: [] }), { best_overall: "Cabbage" })} />);
    expect(screen.queryByTestId("plan-others")).toBeNull();
  });

  it("adds 'May lose money if prices are low' on a crop whose low-end profit is below zero, and not otherwise", () => {
    const p = plan({ alternatives: ["Brinjal"] });
    p.crops.find((f) => f.crop === "Brinjal").fits_budget = true;                              // Brinjal's low-end profit is +20,608
    render(<PersonalPlan response={response(p)} />);
    expect(within(screen.getByTestId("plan-card-Cabbage")).getByTestId("lose-chip").textContent).toBe("May lose money if prices are low");
    expect(within(screen.getByTestId("plan-card-Brinjal")).queryByTestId("lose-chip")).toBeNull();
  });

  it("shows that chip on the matching-#1 line too when its low-end profit is a loss", () => {
    render(<PersonalPlan response={response(plan({ matches_standard: true }), { best_overall: "Cabbage" })} />);
    expect(within(screen.getByTestId("plan-match")).getByTestId("lose-chip").textContent).toBe("May lose money if prices are low");
  });

  it("puts the forecast sentence in the card's reason only when it is true", () => {
    const p = plan(); p.crops.find((f) => f.crop === "Brinjal").reliable_forecast = false;
    const { unmount } = render(<PersonalPlan response={response(p)} />);
    expect(text(screen.getByTestId("plan-card-Cabbage"))).toContain("among suitable crops. Its price has been more predictable in past tests.");
    unmount();
    render(<PersonalPlan response={response()} />);
    expect(text(screen.getByTestId("plan-card-Cabbage"))).toContain("among suitable crops. Its price forecast held up in past tests.");
    cleanup();
    const q = plan(); q.crops[0].reliable_forecast = false;
    render(<PersonalPlan response={response(q)} />);
    expect(text(screen.getByTestId("plan-card-Cabbage"))).not.toMatch(/predictable|held up/);
  });

  it("lists, collapsed, why other crops are not shown, each with its plain reason", () => {
    render(<PersonalPlan response={response()} />);
    const d = screen.getByTestId("plan-excluded");
    expect(d.tagName).toBe("DETAILS");
    expect(d.hasAttribute("open")).toBe(false);
    const items = Array.from(d.querySelectorAll("li")).map((li) => li.textContent);
    expect(items).toEqual(["Brinjal — needs ₹11,662 more · your budget covers about 0.84 acre", "Tomato — high price risk", "Wheat — does not suit your soil and weather"]);
    expect(d.querySelector("summary").textContent).toBe("Why other crops aren't shown");
  });

  it("ends with the estimates footer and the cost basis", () => {
    render(<PersonalPlan response={response()} />);
    const t = text(screen.getByTestId("personal-plan"));
    expect(t).toContain("Costs and prices are estimates from past data.");
    expect(t).toContain("Costs are approximate estimates (2024 prices + 5% a year).");
  });

  it("says plainly that no crop fits and shows the cheapest suitable crop's full cost for the field and the extra money needed", () => {
    const p = plan({ outcome: "none_fit", best_for_you: null, alternatives: [], no_fit_reason: "budget", inputs: { budget_inr: 10000, priority: "spend_less", risk_level: "low", area_acres: 1 },
      fallback: { crop: "Brinjal", upfront: 71662, upfront_per_acre: 71662, extra_needed: 61662, affordable_area: 0.14, risk_level: "low", profit: 96931, downside_profit: 20608 } });
    render(<PersonalPlan response={response(p)} />);
    expect(screen.getByTestId("plan-nofit").textContent).toBe(
      "No suitable crop fits your budget. The cheapest suitable crop is Brinjal: it costs about ₹71,662 for your 1 acre field, so you need ₹61,662 more. Your budget covers about 0.14 acre.");
    expect(screen.queryAllByTestId(/plan-card-/)).toHaveLength(0);
  });

  it("says when no suitable crop matches the risk level, and when no crop suits the field at all", () => {
    const risk = plan({ outcome: "none_fit", best_for_you: null, no_fit_reason: "risk", fallback: { crop: "Tomato", upfront: 121275, upfront_per_acre: 121275, extra_needed: null, affordable_area: null, risk_level: "high" } });
    const { unmount } = render(<PersonalPlan response={response(risk)} />);
    expect(screen.getByTestId("plan-nofit").textContent).toBe("No suitable crop matches your risk level. The closest is Tomato (High risk, about ₹1,21,275 for your 1 acre field).");
    unmount();
    render(<PersonalPlan response={response(plan({ outcome: "none_fit", best_for_you: null, no_fit_reason: "no_suitable", fallback: null }))} />);
    expect(screen.getByTestId("plan-nofit").textContent).toBe("No crop is suitable for your soil, weather and months, so there is no plan to show.");
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
