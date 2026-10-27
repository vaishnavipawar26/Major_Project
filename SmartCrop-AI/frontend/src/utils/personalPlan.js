// View model for the "Your personalised plan" card (result page) and the "Your budget and priorities" step (explanation page).
// The decision itself is made by the backend (app/ml/crop_recommendation/budget_plan.py); this file only turns its numbers and codes
// into plain sentences. Nothing is recalculated and no number is invented: every figure is a field of `response.personal_plan`.
import { fieldSizeText } from "./fieldSize";
import { cropName, monthLong, rupees, signedRupees } from "./format";

const byCrop = (plan) => Object.fromEntries(plan.crops.map((f) => [f.crop, f]));
const acres = (t, n) => fieldSizeText(t, n);
const joinWords = (xs, and) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${and} ${xs[xs.length - 1]}`);

/** "Costs are approximate estimates (2024 prices + 5% a year)." from the plan's own cost basis. */
export function costNote(plan, t) {
  const b = plan.cost_basis;
  return b?.reference_year ? t("cr.pp.costNote", { year: b.reference_year, pct: b.inflation_annual_pct }) : t("cr.pp.costNoteShort");
}

/** "Based on your budget ₹40,000 · Priority: Balanced · Risk: Medium" (the budget part only when one was entered). */
export function headerLine(plan, t) {
  const i = plan.inputs;
  return [i.budget_inr != null ? t("cr.pp.basedOnBudget", { budget: rupees(i.budget_inr) }) : t("cr.pp.basedOnChoices"),
    t("cr.pp.priorityIs", { v: t(`crop.form.priority.${i.priority}`) }), t("cr.pp.riskIs", { v: t(`crop.form.risk.${i.risk_level}`) })].join(" · ");
}

/**
 * How to describe the picked crop's price forecast, from the monthly model's own testing (never invented):
 *  "predictable" : the pick has a reliable forecast AND at least one other suitable crop that was considered and not picked does not;
 *  "held"        : the pick has a reliable forecast and there is no such comparison;
 *  null          : the pick's forecast is not reliable: say nothing about it.
 */
export function forecastClaim(best, plan) {
  if (!best.reliable_forecast) return null;
  const others = plan.crops.filter((f) => f.crop !== best.crop && !f.unsuitable && f.upfront != null);
  return others.some((f) => !f.reliable_forecast) ? "predictable" : "held";
}

/** One plain line on why this crop is shown, from the real comparison with the pick and the farmer's priority. */
function reasonOf(f, kind, best, plan, t) {
  const budget = plan.inputs.budget_inr != null ? "Budget" : "";
  if (kind === "best") {
    const claim = forecastClaim(f, plan);
    return `${t(`cr.pp.reason.best.${plan.inputs.priority}${budget}`)}${claim ? ` ${t(`cr.pp.reason.${claim}`)}` : ""}`;
  }
  if (f.upfront < best.upfront) return t("cr.pp.reason.cheaper", { best: cropName(t, best.crop) });
  if (f.downside_pct > best.downside_pct) return t("cr.pp.reason.safer", { best: cropName(t, best.crop) });
  return t("cr.pp.reason.also");
}

function supplyChip(f, t) {
  const n = f.supply_note;
  if (!n) return null;
  return { kind: n.kind, text: t(`cr.pp.supply.${n.kind}`, { month: monthLong(n.month) }),
    note: `${t("cr.pp.supply.basis", { years: n.years })}${n.scope === "state" ? ` · ${t("cr.pp.supply.state")}` : ""}` };
}

function cardOf(f, kind, best, plan, t) {
  const budget = plan.inputs.budget_inr;
  return {
    crop: f.crop, name: cropName(t, f.crop), kind, badge: t(kind === "best" ? "cr.pp.badge.best" : "cr.pp.badge.alt"),
    cost: budget != null ? t("cr.pp.costOf", { cost: rupees(f.upfront), budget: rupees(budget) }) : t("cr.pp.costToStart", { cost: rupees(f.upfront) }),
    costPct: budget != null ? Math.min(100, Math.round((f.upfront / budget) * 100)) : null,
    profit: rupees(f.profit), downside: signedRupees(f.downside_profit), downsideLoss: f.downside_profit < 0,
    mayLose: f.downside_profit < 0 ? t("cr.pp.mayLose") : null,
    risk: f.risk_level, riskText: t(`cr.pp.risk.${f.risk_level}`), supply: supplyChip(f, t),
    reason: reasonOf(f, kind, best, plan, t),
  };
}

const exText = (x, t) => {
  if (x.code === "over_budget") {
    const area = x.params.area;
    return `${t("cr.pp.ex.over_budget", { extra: rupees(x.params.extra) })}${area != null ? ` · ${t("cr.pp.covers", { area: String(area), unit: t(area <= 1 ? "cr.pp.acreWord" : "cr.pp.acresWord") })}` : ""}`;
  }
  if (x.code === "risk") return t(`cr.pp.ex.risk.${x.params?.level}`);
  return t(`cr.pp.ex.${x.code}`);
};
/** "<Crop> — <reason>", never empty and never a raw dictionary key: an unknown code falls back to a plain generic reason. */
export function exReason(x, t) {
  const reason = exText(x, t);
  return !reason || /^cr\.pp\./.test(reason) || /\{\w+\}/.test(reason) ? t("cr.pp.ex.other") : reason;
}
function exLine(x, t) {
  return `${cropName(t, x.crop) || String(x.crop)} — ${exReason(x, t)}`;
}

/** The sentence(s) shown when no crop passes the filters, with the cheapest suitable crop's full cost for the field. */
export function noFitText(plan, response, t) {
  if (plan.no_fit_reason === "no_suitable") return t("cr.pp.noFit.noSuitable");
  const f = plan.fallback;
  const name = cropName(t, f.crop), size = acres(t, response.area_acres);
  if (plan.no_fit_reason === "risk") return `${t("cr.pp.noFit.risk")} ${t("cr.pp.noFit.closest", { crop: name, risk: t(`crop.form.risk.${f.risk_level}`), cost: rupees(f.upfront), size })}`;
  const covers = f.affordable_area != null ? ` ${t("cr.pp.coversSentence", { area: String(f.affordable_area), unit: t(f.affordable_area <= 1 ? "cr.pp.acreWord" : "cr.pp.acresWord") })}` : "";
  return `${t("cr.pp.noFit.budget")} ${t("cr.pp.noFit.cheapest", { crop: name, cost: rupees(f.upfront), size, extra: rupees(f.extra_needed) })}${covers}`;
}

/** Everything the plan card shows. Returns null when the farmer gave no budget, priority or risk level. */
export function planView(response, t) {
  const plan = response.personal_plan;
  if (!plan) return null;
  const facts = byCrop(plan);
  const best = plan.best_for_you ? facts[plan.best_for_you] : null;
  const view = {
    header: headerLine(plan, t), ok: plan.outcome === "ok", matches: !!plan.matches_standard, cards: [], noFit: null, matchLine: null,
    excluded: (plan.excluded || []).filter((x) => x?.crop).map((x) => ({ crop: x.crop, text: exLine(x, t) })), costNote: costNote(plan, t),
  };
  if (!best) {
    view.noFit = noFitText(plan, response, t);
    return view;
  }
  view.cards = [cardOf(best, "best", best, plan, t), ...plan.alternatives.map((c) => cardOf(facts[c], "alt", best, plan, t))];
  if (plan.matches_standard) {
    // the plan agrees with the standard #1: say so, but still name the other crops that fit
    const others = plan.alternatives.map((c) => `${cropName(t, c)} (${t(`cr.pp.risk.${facts[c].risk_level}`)})`);
    view.matchLine = { text: t(plan.inputs.budget_inr != null ? "cr.pp.matches" : "cr.pp.matchesNoBudget"), reason: view.cards[0].reason, others: others.length ? t("cr.pp.otherFit", { list: others.join(", ") }) : null, mayLose: view.cards[0].mayLose };
  }
  return view;
}

/** The numbered explanation step "Your budget and priorities — <result>": 2-3 short sentences from the plan's real values. */
export function planStep(response, t) {
  const plan = response.personal_plan;
  if (!plan) return null;
  const facts = byCrop(plan), i = plan.inputs;
  const best = plan.best_for_you ? facts[plan.best_for_you] : null;
  const fits = plan.crops.filter((f) => !f.unsuitable && f.upfront != null && f.fits_budget !== false).map((f) => cropName(t, f.crop));
  const lines = [];
  if (i.budget_inr == null) lines.push(t("cr.pp.step.noBudget"));
  else if (fits.length) lines.push(t(fits.length === 1 ? "cr.pp.step.fit1" : "cr.pp.step.fit", { budget: rupees(i.budget_inr), list: joinWords(fits, t("cr.chart.and")) }));    // when nothing fits, the no-fit sentence below says so once
  if (!best) {
    lines.push(noFitText(plan, response, t));
  } else {
    const why = t(`cr.pp.step.why.${i.priority}`);
    const claim = forecastClaim(best, plan);
    const steady = claim ? t(`cr.pp.step.${claim}`) : ".";
    lines.push(t("cr.pp.step.picked", { priority: t(`crop.form.priority.${i.priority}`), risk: t(`crop.form.risk.${i.risk_level}`), crop: cropName(t, best.crop), why, steady }));
  }
  lines.push(costNote(plan, t));
  return { headline: best ? cropName(t, best.crop) : t("cr.pp.step.none"), tone: best ? "good" : "warn", lines };
}

/** "30 guntha" for a cultivated area, always shown beside the acres. */
export const gunthaText = (t, acres) => `${Math.round(Number(acres) * 40)} ${t("crop.form.gunthaWord")}`;

/** "0.75 acre · 30 guntha" (whole fields of 1 acre or more keep the guntha too, so a farmer can read either unit). */
export function areaBoth(t, acres) {
  const n = Number(acres);
  const a = Number(n.toFixed(2));
  return `${t(a <= 1 ? "cr.plan.acre" : "cr.plan.acres", { n: a })} · ${gunthaText(t, n)}`;
}

/**
 * The visual plan card: budget and field size, the best crop for the whole field, the best option the budget really pays for (the whole
 * field or a smaller area), a budget bar and the two or three best suitable crops side by side. Every number is a field of
 * ``response.personal_plan``; the smaller-area money is the backend's own scaled figures, never recomputed here.
 */
export function planVisualView(response, t) {
  const plan = response.personal_plan;
  if (!plan) return null;
  const facts = byCrop(plan);
  const budget = plan.inputs.budget_inr;
  const fullArea = response.area_acres;
  const fullBest = plan.full_field_best;
  const pick = plan.outcome === "partial" ? plan.partial : plan.best_for_you ? facts[plan.best_for_you] : null;
  const partial = plan.outcome === "partial";
  const view = {
    ok: plan.outcome !== "none_fit", partial, budget: budget != null ? rupees(budget) : null, hasBudget: budget != null,
    area: areaBoth(t, fullArea), header: headerLine(plan, t), costNote: costNote(plan, t),
    full: fullBest && {
      crop: fullBest.crop, name: cropName(t, fullBest.crop), cost: rupees(fullBest.upfront), profit: rupees(fullBest.profit),
      profitLoss: fullBest.profit < 0, shortfall: fullBest.extra_needed != null ? rupees(fullBest.extra_needed) : null,
      fits: fullBest.fits_budget !== false, area: areaBoth(t, fullArea),
    },
    option: pick && {
      crop: pick.crop, name: cropName(t, pick.crop), partial, area: areaBoth(t, partial ? pick.area_acres : fullArea),
      cost: rupees(pick.upfront), revenue: rupees(pick.revenue), profit: rupees(pick.profit), profitLoss: pick.profit < 0,
      risk: pick.risk_level, riskText: t(`cr.pp.risk.${pick.risk_level}`),
    },
    bar: null, compare: [], noFit: null,
    excluded: (plan.excluded || []).filter((x) => x?.crop).map((x) => ({ crop: x.crop, text: exLine(x, t) })),
  };
  if (budget != null && pick) {
    const scale = Math.max(budget, pick.upfront, partial ? fullBest?.upfront ?? 0 : 0) || 1;
    view.bar = {
      money: rupees(budget), moneyPct: Math.round((budget / scale) * 100), cost: rupees(pick.upfront), costPct: Math.round((pick.upfront / scale) * 100),
      over: pick.upfront > budget, fullCost: partial && fullBest ? rupees(fullBest.upfront) : null, fullPct: partial && fullBest ? Math.round((fullBest.upfront / scale) * 100) : null,
    };
  }
  // the same area for every crop in the comparison: the option's own area
  const k = partial ? pick.area_acres / fullArea : 1;
  const rows = (plan.compare || []).map((c) => facts[c]).filter(Boolean);
  const top = Math.max(1, ...rows.map((f) => Math.abs(f.profit * k)));
  view.compareArea = areaBoth(t, partial ? pick.area_acres : fullArea);
  view.compare = rows.map((f) => ({
    crop: f.crop, name: cropName(t, f.crop), cost: rupees(Math.round(f.upfront * k)), profit: rupees(Math.round(f.profit * k)),
    pct: Math.max(4, Math.round((Math.abs(f.profit * k) / top) * 100)), isPick: pick ? f.crop === pick.crop : false,
  }));
  if (!pick) view.noFit = noFitText(plan, response, t);
  return view;
}
