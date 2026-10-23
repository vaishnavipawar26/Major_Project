// @vitest-environment jsdom
// These tests use REAL API responses (src/test-fixtures/budget_plan_real.json, written by backend/scripts/save_budget_plan_fixtures.py),
// never hand-made mocks, so a mismatch between what the API sends and what the page reads cannot hide.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/historyService", () => ({
  historyService: { summary: vi.fn(), price: vi.fn(), recommendations: vi.fn(), deletePrice: vi.fn(), deleteRecommendation: vi.fn() },
}));
vi.mock("../../services/api", () => ({ errorMessage: (e) => e.message }));

import { historyService } from "../../services/historyService";
import History from "../../pages/History";
import { LanguageProvider, translate } from "../../i18n/LanguageContext";
import en from "../../i18n/en";
import hi from "../../i18n/hi";
import mr from "../../i18n/mr";
import { planStep, planView } from "../../utils/personalPlan";
import { buildExplanation } from "../../utils/farmerExplanation";
import FarmExplanation from "./FarmExplanation";
import PersonalPlan from "./PersonalPlan";

const FIXTURES = JSON.parse(readFileSync(resolve("src/test-fixtures/budget_plan_real.json"), "utf8"));
const LANGS = ["en", "hi", "mr"];
// a raw dictionary key, an unfilled {placeholder} or the word "undefined" on screen means a missing key or a field the page did not find
const BROKEN = /\b(?:cr|crop|hist)\.(?:pp|form|chart|fx)\.[\w.]+|\{\w+\}|undefined|NaN|\[object/;

const inLang = (lang) => localStorage.setItem("smartcrop_lang", lang);
const t = (lang) => (key, vars) => translate(lang, key, vars);
const renderPlan = (response) => render(<LanguageProvider><PersonalPlan response={response} /></LanguageProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  historyService.summary.mockResolvedValue({ total_price_predictions: 0, total_crop_recommendations: 4, recent_predictions: [], recent_recommendations: [] });
  historyService.price.mockResolvedValue({ total: 0, limit: 10, offset: 0, items: [] });
});
afterEach(() => { cleanup(); localStorage.removeItem("smartcrop_lang"); });

describe("the fixtures are real API responses", () => {
  it("cover the four situations the card has to handle", () => {
    const p = (k) => FIXTURES[k].response.personal_plan;
    expect(p("no_fit_budget")).toMatchObject({ outcome: "none_fit", no_fit_reason: "budget" });
    expect(p("no_fit_budget").excluded).toHaveLength(7);
    expect(p("one_card")).toMatchObject({ outcome: "ok", alternatives: [] });
    expect(p("matches_standard")).toMatchObject({ outcome: "ok", matches_standard: true });
    expect(p("matches_standard").alternatives.length).toBeGreaterThan(0);
    expect(p("no_budget").inputs.budget_inr).toBeNull();
  });
});

describe.each(Object.keys(FIXTURES))("plan card from the real response: %s", (name) => {
  const { response } = FIXTURES[name];

  it.each(LANGS)("(%s) every 'why other crops aren't shown' bullet is '<Crop> — <reason>', none empty", (lang) => {
    inLang(lang);
    const { container } = renderPlan(response);
    const items = Array.from(container.querySelectorAll("[data-testid=plan-excluded] li")).map((li) => li.textContent);
    expect(items).toHaveLength(response.personal_plan.excluded.length);
    items.forEach((text, i) => {
      expect(text.trim().length, `bullet ${i} is empty`).toBeGreaterThan(0);
      expect(text, `bullet ${i}`).toContain(" — ");
      const [crop, reason] = text.split(" — ");
      expect(crop.trim(), `bullet ${i} has no crop name`).not.toBe("");
      expect(reason.trim(), `bullet ${i} has no reason`).not.toBe("");
      expect(text).not.toMatch(BROKEN);
      // the crop named is the crop the API excluded, in this language
      const key = `name.crop.${response.personal_plan.excluded[i].crop}`;
      expect(crop).toBe(translate(lang, key) === key ? response.personal_plan.excluded[i].crop : translate(lang, key));
    });
  });

  it.each(LANGS)("(%s) no text anywhere on the card is a raw key, an unfilled placeholder or 'undefined'", (lang) => {
    inLang(lang);
    const { container } = renderPlan(response);
    const all = container.textContent;
    expect(all.length).toBeGreaterThan(50);
    expect(all).not.toMatch(BROKEN);
    // nothing is rendered as an empty list item, heading, chip, paragraph or definition
    container.querySelectorAll("li, h2, h3, p, dd, dt, summary, .xp-status").forEach((el) => expect(el.textContent.trim(), el.outerHTML.slice(0, 80)).not.toBe(""));
  });

  it.each(LANGS)("(%s) the explanation step is complete and says each thing once", (lang) => {
    const s = planStep(response, t(lang));
    expect(s.headline.trim()).not.toBe("");
    expect(s.lines.length).toBeGreaterThanOrEqual(2);
    s.lines.forEach((l) => { expect(l.trim()).not.toBe(""); expect(l).not.toMatch(BROKEN); });
    expect(new Set(s.lines).size).toBe(s.lines.length);
  });
});

describe("the explanation page renders the step from the real response", () => {
  it.each(Object.keys(FIXTURES))("%s", (name) => {
    const { request, response } = FIXTURES[name];
    const best = response.results.find((r) => r.crop_name === response.best_overall) || response.results[0];
    const inputs = Object.fromEntries(["nitrogen", "phosphorus", "potassium", "ph", "temperature", "humidity", "rainfall"].map((k) => [k, request[k]]));
    const r = render(<LanguageProvider><FarmExplanation result={best} response={response} inputs={inputs} /></LanguageProvider>);
    const steps = Array.from(r.container.querySelectorAll(".xp-step"));
    expect(steps).toHaveLength(7);
    const budget = steps[6].textContent;
    expect(budget).toContain("Your budget and priorities");
    expect(budget).not.toMatch(BROKEN);
    expect(budget).toContain("Costs are approximate estimates (2024 prices + 5% a year).");
    steps.forEach((s) => expect(s.querySelector(".xp-step-title").textContent.trim()).not.toBe(""));
  });
});

describe("the history line from the real history items", () => {
  it("shows the personalised pick, or says no crop fits, with no placeholder left over", async () => {
    historyService.recommendations.mockResolvedValue({ total: 4, limit: 10, offset: 0, items: Object.values(FIXTURES).map((f) => f.history_item) });
    render(<MemoryRouter initialEntries={["/history?tab=recommendations"]}><LanguageProvider><History /></LanguageProvider></MemoryRouter>);
    for (const f of Object.values(FIXTURES)) {
      const h = f.history_item;
      const hasPlan = h.budget_inr != null || h.priority || h.risk_level;
      if (!hasPlan) continue;
      const el = await waitFor(() => screen.getByTestId(`hist-plan-${h.id}`));
      expect(el.textContent).toBe(h.personal_pick ? `Your plan: ${h.personal_pick}` : "Your plan: no crop fits");
      expect(el.textContent).not.toMatch(BROKEN);
    }
  });
});

describe("planView is defensive about the list it is given", () => {
  const response = FIXTURES.no_fit_budget.response;
  it("never produces an empty or key-like bullet, even for a code or shape it does not know", () => {
    const odd = { ...response, personal_plan: { ...response.personal_plan, excluded: [
      { crop: "Brinjal", code: "something_new", params: {} }, { crop: "Wheat", code: "risk" }, { code: "over_budget", params: {} }, null,
      { crop: "Onion", code: "over_budget", params: { extra: 1000, area: null } }] } };
    const v = planView(odd, t("en"));
    expect(v.excluded.map((x) => x.crop)).toEqual(["Brinjal", "Wheat", "Onion"]);       // an entry without a crop is skipped, not shown blank
    v.excluded.forEach((x) => { expect(x.text).toMatch(/^\S.* — \S/); expect(x.text).not.toMatch(BROKEN); });
    expect(v.excluded[0].text).toBe("Brinjal — not a fit for your plan");
  });
});

describe("every dictionary key the plan card, the explanation step and the budget card use exists in English, Hindi and Marathi", () => {
  const sources = ["../../utils/personalPlan.js", "./PersonalPlan.jsx", "./BudgetStep.jsx"].map((f) => readFileSync(new URL(f, import.meta.url), "utf8")).join("\n");
  const P = ["spend_less", "balanced", "highest_profit"], R = ["low", "medium", "high"];
  const dynamic = [
    ...["over_budget", "poor_fit", "loss", "not_sellable", "no_price", "other"].map((c) => `cr.pp.ex.${c}`), ...R.map((r) => `cr.pp.ex.risk.${r}`),
    ...P.flatMap((p) => [`cr.pp.reason.best.${p}`, `cr.pp.reason.best.${p}Budget`, `cr.pp.step.why.${p}`, `crop.form.priority.${p}`, `crop.form.priority.${p}Sub`]),
    ...["predictable", "held"].flatMap((c) => [`cr.pp.reason.${c}`, `cr.pp.step.${c}`]), ...["high", "low"].map((k) => `cr.pp.supply.${k}`),
    ...R.flatMap((r) => [`cr.pp.risk.${r}`, `crop.form.risk.${r}`, `crop.form.risk.${r}Sub`]), "cr.pp.badge.best", "cr.pp.badge.alt",
  ];
  const literal = [...sources.matchAll(/["'`]((?:cr\.pp|crop\.form|cr\.chart|hist)\.[A-Za-z0-9_.]+)["'`]/g)].map((m) => m[1]).filter((k) => !k.endsWith("."));
  const keys = [...new Set([...literal, ...dynamic])];

  it.each([["en", en], ["hi", hi], ["mr", mr]])("(%s)", (_, dict) => {
    expect(keys.length).toBeGreaterThan(60);
    expect(keys.filter((k) => !(k in dict) || String(dict[k]).trim() === "")).toEqual([]);
  });
});


describe("the explanation's 'Your location' step from the real responses", () => {
  it.each(Object.keys(FIELDS_OF()))("%s: states what the crop sold for in the selling month, from the price data", (name) => {
    const { request, response } = FIXTURES[name];
    const inputs = Object.fromEntries(["nitrogen", "phosphorus", "potassium", "ph", "temperature", "humidity", "rainfall"].map((k) => [k, request[k]]));
    for (const r of response.results) {
      const loc = buildExplanation(r, response, inputs, t("en")).location;
      expect(loc.text, r.crop_name).toMatch(/^In 20\d\d(–20\d\d)?, \w+ (at \w+ sold|sold Maharashtra-wide) for about ₹[\d,]+–₹[\d,]+ per quintal in \w+/);
      expect(loc.text).not.toMatch(BROKEN);
    }
  });
});
function FIELDS_OF() { return FIXTURES; }
