// The six decision factors of the explanation page as simple visual cards. Every figure is a field of the API response: the farmer's own
// values and the crop's usual ranges (range_fit / important_factors), the planting calendar (timeline), the economics and the personal
// plan. A factor is marked "decided" only where the backend's ranking really uses it: profit, budget and risk are what the personal plan
// ranks by, so they are the deciding factors when a plan chose the crop; otherwise nothing is marked, because the score weights
// (already shown in the histogram below) are the only claim the backend supports.
import { areaBasis, harvestSpan, indicatorRows, SOIL, WEATHER } from "./cropPlan";
import { monthLong, rupees, signedRupees } from "./format";

const monthNo = (ym) => Number(String(ym).split("-")[1]);

const tone = (within, total) => (within === total ? "good" : within >= total - 1 ? "warn" : "bad");

/** The value rows of a group for the cards: the farmer's value against the crop's usual range, plus where it sits (0-100 %) on the track. */
function rows(r, features, inputs, t) {
  const have = new Set((r.important_factors || []).map((f) => f.feature));      // an older result without the factor list just has no value rows
  return indicatorRows(r, features.filter((f) => have.has(f)), inputs, t).filter((x) => x.num != null).map((x) => {
    const span = x.high - x.low || 1;
    const pos = Math.max(0, Math.min(100, ((x.num - (x.low - span * 0.5)) / (span * 2)) * 100));
    return { key: x.feature, label: x.label, value: `${x.shown}${x.unit ? ` ${x.unit}` : ""}`, range: x.range, state: x.state, pos,
      lowPct: (0.5 / 2) * 100, highPct: ((span * 1.5) / (span * 2)) * 100 };
  });
}

/** Cards for: location, planting & harvest, soil, weather, profit, budget. Returns null if the crop has no planting timeline. */
export function decisionFactors(best, response, inputs, t) {
  if (!best?.timeline || !best.range_fit) return null;
  const plan = response.personal_plan;
  const byPlan = response.recommendation_basis === "plan" && !!plan;
  const basis = areaBasis(response);
  const e = best.economics;
  const tl = best.timeline;
  const f = plan?.crops?.find((x) => x.crop === best.crop_name);
  const soil = best.range_fit.soil, weather = best.range_fit.weather;

  const cards = [
    { key: "location", tone: best.location_score >= 70 ? "good" : best.location_score >= 40 ? "warn" : "bad",
      big: `${Math.round(best.location_score)}/100`, bar: best.location_score,
      text: t("cr.df.location", { share: best.location.growing_area_share_pct }), decided: false },
    { key: "timing", tone: tl.planting_in_window ? "good" : "warn", big: monthLong(monthNo(tl.planting)), bar: null,
      text: t(tl.planting_in_window ? "cr.df.timingOk" : "cr.df.timingOff", { harvest: harvestSpan(tl) }), decided: false },
    { key: "soil", tone: tone(soil.within, soil.total), big: `${soil.within}/${soil.total}`, bar: (soil.within / soil.total) * 100,
      text: t("cr.df.inRange"), rows: rows(best, SOIL, inputs, t), decided: false },
    { key: "weather", tone: tone(weather.within, weather.total), big: `${weather.within}/${weather.total}`, bar: (weather.within / weather.total) * 100,
      text: t("cr.df.inRange"), rows: rows(best, WEATHER, inputs, t), decided: false },
  ];
  if (e) {
    const profit = Math.round(e.net_profit * basis.factor);
    cards.push({ key: "profit", tone: profit > 0 ? "good" : "bad", big: signedRupees(profit), bar: null,
      text: t("cr.df.profit", { cost: rupees(Math.round(e.total_cost * basis.factor)) }), decided: byPlan && plan.inputs.priority !== "spend_less" });
  }
  if (plan?.inputs.budget_inr != null && f) {
    const cost = plan.outcome === "partial" ? plan.partial?.upfront : f.upfront;
    cards.push({ key: "budget", tone: cost <= plan.inputs.budget_inr ? "good" : "bad", big: rupees(cost), bar: Math.min(100, (cost / plan.inputs.budget_inr) * 100),
      text: t("cr.df.budget", { budget: rupees(plan.inputs.budget_inr) }), decided: byPlan });
  }
  return cards;
}

/**
 * The highlighted "strongest reason": when the farmer's plan chose the crop, the plan's own rule (priority, budget, risk) with the
 * crop's real figure; otherwise null, and the page keeps the score-based strongest-influence card.
 */
export function planReason(best, response, t) {
  const plan = response.personal_plan;
  if (response.recommendation_basis !== "plan" || !plan || !best?.economics) return null;
  const k = areaBasis(response).factor;
  const profit = rupees(Math.round(best.economics.net_profit * k));
  const cost = rupees(Math.round((plan.crops.find((x) => x.crop === best.crop_name)?.upfront ?? 0) * k));
  const p = plan.inputs.priority;
  return { priority: p, text: t(`cr.df.reason.${p}${plan.inputs.budget_inr != null ? "Budget" : ""}`, { profit, cost, budget: rupees(plan.inputs.budget_inr ?? 0) }) };
}
