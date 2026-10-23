import { fmtDate, rupees } from "./format";
import { latestText } from "./priceView";

/**
 * View model for the price explanation page. Pure: it only arranges what the backend measured (v3 `display.groups`,
 * `headline`, `trust`) into plain sentences. It decides nothing new: the verdict is the backend's `headline.code`
 * (price_verdict), every number is a backend number, and no cause is ever invented.
 *
 * Trust badge rule (computed by the backend, price_explainer_v3.trust_level):
 *   High    beat the simple guess by >= 10% in past tests AND the range held the real price in >= 70% of them
 *   Medium  beat it by >= 2% AND range coverage >= 40%
 *   Low     anything else / no past test. A forecast that replays last year's season is capped at Medium.
 */

/** The four ordered steps: their groups and the group whose reading drives the status chip. */
const STEPS = [
  { key: "season", groups: ["seasonal"], lead: "seasonal" },
  { key: "prices", groups: ["trend", "last_year"], lead: "trend" },
  { key: "market", groups: ["market"], lead: "market" },
  { key: "supply", groups: ["supply"], lead: "supply" },
];

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
/** "a", "a and b", "a, b and c" */
const joinWords = (xs, and) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${and} ${xs[xs.length - 1]}`);

/** Sort key for steps 1-4: the model's total push in rupees (all groups of the step); steps with no push sort last. */
const effectOf = (groups) => sum(groups.map((g) => g?.inr_effect ?? 0));

function buildStep(def, groups, ctxOnly, t) {
  const gs = def.groups.map((k) => groups?.[k]).filter(Boolean);
  const lead = groups?.[def.lead];
  const have = gs.filter((g) => g.available);
  const main = (lead?.available ? lead : have[0]) || null;
  const used = gs.filter((g) => g.used && g.inr_effect != null);
  const total = used.length ? sum(used.map((g) => g.inr_effect)) : null;
  const step = {
    key: def.key, title: t(`pe.n.${def.key}`), available: have.length > 0, order: ctxOnly ? 0 : Math.abs(effectOf(gs)),
    headline: main ? main.plain : t("pe.noData"), reading: main ? main.reading : null,
    text: have.length ? have.map((g) => g.detail).filter(Boolean).join(" ") : (gs.find((g) => g.missing)?.missing ?? t("pe.noDataLine")),
    push: null, against: false, tone: "neutral", chip: null,
  };
  if (have.length) step.chip = main.reading === "up" ? "higher" : main.reading === "down" ? "lower" : "little";
  if (!ctxOnly && total != null && have.length) {
    const rounded = sum(used.map((g) => g.inr_effect_rounded ?? 0));
    step.push = Math.abs(total) < 5 ? { kind: "none" } : { kind: total > 0 ? "up" : "down", amount: rupees(Math.abs(rounded)) };
    step.against = lead?.agreement === "disagree";
    if (step.against) step.tone = "warn";
  }
  return step;
}

/** The sentence of the headline and its tone, from the backend verdict code. */
function headlineOf(h, ctxOnly, t) {
  if (ctxOnly) return { text: t("pe.head.ctx"), tone: "neutral" };
  if (h.code === "about_the_same") return { text: t("pe.head.same", { price: rupees(h.start_price) }), tone: "neutral" };
  if (h.code === "rise") return { text: t("pe.head.rise", { price: rupees(h.predicted_price) }), tone: "good" };
  if (h.code === "fall") return { text: t("pe.head.fall", { price: rupees(h.predicted_price) }), tone: "bad" };
  return { text: t("pe.head.none"), tone: "neutral" };
}

/** The one grey line under the headline: the model's own estimate, the change and the range, each shown once. */
function subOf(h, ctxOnly, t) {
  if (ctxOnly) return latestText(t, h.latest_recorded) ?? t("pe.sub.noPrice");
  const parts = [];
  const delta = rupees(Math.abs(h.change_inr ?? 0));
  if (h.code === "about_the_same") parts.push(t("pe.sub.same", { estimate: rupees(h.predicted_price), diff: delta, where: t(h.change_inr >= 0 ? "pe.above" : "pe.below") }));
  else if (h.code === "rise" || h.code === "fall") parts.push(t("pe.sub.move", { start: rupees(h.start_price), diff: delta, dir: t(h.code === "rise" ? "pe.up" : "pe.down"), pct: `${Math.abs(h.change_pct).toFixed(1)}%` }));
  if (h.range) parts.push(t("pe.sub.range", { low: rupees(h.range[0]), high: rupees(h.range[1]) }));
  else if (h.range_hidden) parts.push(t("pe.sub.rangeHidden"));
  return parts.join(" ");
}

function trustStep(v, crop, ctxOnly, hasReplay, t) {
  const tr = v.trust || {};
  if (ctxOnly) return { key: "trust", title: t("pe.n.trust"), headline: t("pe.trust.noForecast"), tone: "neutral", level: null, text: t("pe.trust.ctx", { crop }) };
  const level = tr.level || "low";
  const bits = [];
  if (tr.skill_pct != null && tr.skill_pct > 0) bits.push(t("pe.trust.skill", { crop, skill: `${Math.round(tr.skill_pct)}%` }));
  else bits.push(t("pe.trust.noSkill", { crop }));
  if (tr.range_coverage_pct != null) bits.push(t("pe.trust.coverage", { pct: Math.round(tr.range_coverage_pct) }));
  if (hasReplay) bits.push(t("pe.trust.replay"));
  return { key: "trust", title: t("pe.n.trust"), headline: t(`pe.trust.${level}`), tone: level === "high" ? "good" : level === "medium" ? "warn" : "bad", level, text: bits.join(" ") };
}

/** Three or four templated sentences from the same data; the numbers are not repeated. */
function finalOf(v, steps, crop, ctxOnly, t) {
  const h = v.headline;
  const topics = (chip) => joinWords(steps.filter((s) => s.chip === chip).map((s) => t(`pe.fin.topic.${s.key}`)), t("pe.and"));
  const higher = topics("higher"), lower = topics("lower");
  const lean = higher && lower ? t("pe.fin.lean.both", { higher, lower }) : higher ? t("pe.fin.lean.higher", { higher }) : lower ? t("pe.fin.lean.lower", { lower }) : null;
  const lines = [];
  if (ctxOnly) {
    lines.push(t("pe.fin.ctx", { crop }));
    lines.push(lean ?? t("pe.fin.recordsNone"));
    lines.push(t("pe.fin.check"));
    return lines.join(" ");
  }
  lines.push(t(`pe.fin.verdict.${["rise", "fall", "about_the_same"].includes(h.code) ? h.code : "none"}`, { crop }));
  lines.push(lean ?? t("pe.fin.signalsNone"));
  const against = steps.filter((s) => s.against);
  if (against.length) lines.push(t("pe.fin.against", { topic: t(`pe.fin.topic.${against[0].key}`) }));
  lines.push(t(h.code === "about_the_same" ? "pe.fin.sameCheck" : "pe.fin.moveCheck"));
  return lines.join(" ");
}

/** Everything the page shows, from one explanation (`exp.v3`) and the explain response. */
export function buildStory(exp, explain, t, cropLabel, marketLabel) {
  const v = exp.v3;
  const h = v.headline;
  const ctxOnly = v.context_only === true || h.predicted_price == null;
  const groups = v.display?.groups;
  const built = STEPS.map((d) => buildStep(d, groups, ctxOnly, t));
  const ordered = ctxOnly ? built : [...built].sort((a, b) => b.order - a.order);
  const hasReplay = !!v.banner;
  const trust = trustStep(v, cropLabel, ctxOnly, hasReplay, t);
  const head = headlineOf(h, ctxOnly, t);
  const miss = h.typical_miss_inr;
  const days = h.horizon?.days_from_today ?? h.horizon_days;
  return {
    ctxOnly, crop: cropLabel, market: marketLabel, code: h.code,
    headline: head.text, tone: head.tone, sub: subOf(h, ctxOnly, t),
    badge: ctxOnly ? null : trust.level,
    tiles: [
      { key: "sell", label: t("pe.tile.sell"), value: fmtDate(h.target_date) },
      { key: "days", label: t("pe.tile.days"), value: t(days === 1 ? "unit.day" : "unit.days", { n: days }) },
      { key: "miss", label: t("pe.tile.miss"), value: miss != null ? rupees(miss) : "—", sub: t("unit.perQuintal") },
    ],
    notice: v.banner ? t("pe.notice", { year: v.banner.reference_date.slice(0, 4), date: fmtDate(v.banner.reference_date) }) : null,
    steps: [...ordered, trust], final: finalOf(v, ordered, cropLabel, ctxOnly, t),
    horizon: h.horizon?.differs ? t("pe.tech.horizon", { date: fmtDate(h.horizon.counted_from), covers: t("unit.days", { n: h.horizon.covers_days }) }) : null,
  };
}
