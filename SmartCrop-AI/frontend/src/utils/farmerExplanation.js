// Farmer-facing explanation of one crop result as six numbered sections (location, planting time, soil, temperature,
// rainfall, expected profit) plus a final explanation. Everything is read from the API's own numbers (usual ranges,
// timeline, economics, profit rank); nothing is recalculated here except comparing a value with a range. A missing
// value or range leaves that comparison out ("Not available") instead of guessing. "Usual range" is the crop's
// 5th-95th percentile in the dataset: it says where a value sits, never that the value caused the recommendation.
import { recommendedName, SOIL, indicatorRows, reliabilityOf, sellableSummary } from "./cropPlan";
import { fieldSizeText } from "./fieldSize";
import { cropName, monthLong, rupees } from "./format";

const SLIGHT_PCT = 0.10;   // up to 10% beyond the nearest bound still reads as "slightly" outside
const SLIGHT_PH = 0.3;     // pH is logarithmic, so it is judged in pH units instead
const PAD = 0.25;          // free space left and right of the usual range on the mini range bar, as a share of its width
const clean = (v) => Number(Number(v).toFixed(2));
const approx = (v) => Number(Number(v).toFixed(1));
const monthNo = (ym) => Number(ym.split("-")[1]);
const yearOf = (ym) => ym.split("-")[0];
const monthYearLong = (ym) => `${monthLong(monthNo(ym))} ${yearOf(ym)}`;
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** "10 acres", "1 acre", "0.51 acre (20.5 guntha)": the same format on every page (see utils/fieldSize.js) */
export const acresText = (n, t) => fieldSizeText(t, n);
const join = (list, t) => (list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")}${t("cr.sum.and")}${list[list.length - 1]}`);

/** "between February and April 2027", "between November 2026 and February 2027" or "in March 2027". */
export function harvestPhrase(tl, t) {
  const [a, b] = [tl.harvest_start, tl.harvest_end];
  if (a === b) return t("cr.fx.harvestIn", { month: monthYearLong(a) });
  return t("cr.fx.harvestBetween", { from: yearOf(a) === yearOf(b) ? monthLong(monthNo(a)) : monthYearLong(a), to: monthYearLong(b) });
}

/**
 * Where a value sits against a usual range: { state: "ok"|"edge"|"low"|"high"|"unknown", size: "slight"|"clear"|"far" | null }.
 * "edge" = just outside (within 2% of the range width): neutral, and never counted as needing attention.
 * "far" (red) is reserved for values at zero/negative or at least double the upper limit; pH uses absolute distance.
 */
export function judge(row) {
  if (row.state === "unknown" || row.state === "ok" || row.state === "edge") return { state: row.state, size: null };
  const gap = row.state === "low" ? row.low - row.num : row.num - row.high;
  const bound = row.state === "low" ? row.low : row.high;
  if (row.feature === "ph") return { state: row.state, size: gap <= SLIGHT_PH ? "slight" : gap >= 1.5 ? "far" : "clear" };
  const far = row.state === "low" ? row.num <= 0 : row.num >= bound * 2;
  return { state: row.state, size: far ? "far" : gap <= Math.abs(bound) * SLIGHT_PCT ? "slight" : "clear" };
}

const toneOf = (j) => (j.state === "ok" ? "good" : j.state === "unknown" || j.state === "edge" ? "neutral" : j.size === "far" ? "bad" : "warn");

function statusText(j, t) {
  if (j.state === "unknown") return t("score.notAvailable");
  if (j.state === "ok") return t("cr.fx.within");
  if (j.state === "edge") return t("cr.fx.edge");
  return t(`cr.fx.${j.state === "low" ? "below" : "above"}${j.size === "slight" ? "Slightly" : ""}`);
}

/** Position of the usual range (band) and of the farmer's value (marker) on a bar, in percent. */
function barOf(row) {
  if (row.num == null || row.low == null || row.high == null) return null;
  const pad = Math.max(row.high - row.low, 1e-9) * PAD;
  const min = Math.min(row.low, row.num) - pad, max = Math.max(row.high, row.num) + pad;
  const at = (v) => Math.round(((v - min) / (max - min)) * 1000) / 10;
  return { from: at(row.low), to: at(row.high), marker: at(row.num) };
}

/** One measured value: the actual value, its usual range, a status and a position on the range bar. */
function valueRow(row, label, t) {
  const j = judge(row);
  const unit = row.unit ? ` ${row.unit}` : "";
  return {
    key: row.feature, label, value: row.num != null ? `${row.shown}${unit}` : t("score.notAvailable"),
    range: row.low != null && row.high != null ? t("cr.ind.range", { low: clean(row.low), high: clean(row.high), unit }) : null, edge: j.state === "edge",
    tone: toneOf(j), status: statusText(j, t), judged: j, bar: barOf(row),
  };
}

// ---- 1. location and 2. planting time ----------------------------------------------------------------------------

/**
 * "Your location": real evidence from the mandi price data, not a generic sentence: what this crop actually sold for in the selling month in the
 * years of the data, at the city's market (or Maharashtra-wide when the city has too few reports). One line when there is no record.
 */
function locationOf(r, response, crop, t) {
  if (!response.city) return null;
  const city = cropName(t, response.city, "city");
  const month = monthLong(monthNo(response.selling_date));
  const h = r.market?.month_history;
  if (!h) return { headline: city, tone: "neutral", text: t("cr.fx.loc.none", { crop, city, month }) };
  const years = h.years.length > 1 ? `${h.years[0]}–${h.years[h.years.length - 1]}` : String(h.years[0]);
  const round = (v) => rupees(Math.max(10, Math.round(v / 10) * 10));
  const stateWide = r.market.series === "Maharashtra (all markets)";
  return { headline: city, tone: "neutral",
    text: t(stateWide ? "cr.fx.loc.evidenceState" : "cr.fx.loc.evidence", { years, crop, city, month, low: round(h.low), high: round(h.high) }) };
}

function planningOf(r, crop, t) {
  const tl = r.timeline;
  if (!tl?.planting || !tl.selling) return null;
  const { growth_months_min: min, growth_months_max: max } = tl;
  const growth = !Number.isFinite(min) || !Number.isFinite(max) ? null
    : min === max ? t("cr.fx.months", { n: min }) : t("cr.fx.monthsRange", { a: min, b: max });
  const p = { crop, sell: monthYearLong(tl.selling), n: tl.months_stored, plant: monthLong(monthNo(tl.planting)), harvest: harvestPhrase(tl, t), growth };
  const bad = tl.status === "not_ready" || tl.status === "spoiled";
  const matches = tl.status === "fresh" && tl.planting_in_window !== false;
  const parts = [t(growth ? "cr.fx.plan.base" : "cr.fx.plan.baseNoGrowth", p)];
  if (["fresh", "stored", "not_ready", "spoiled"].includes(tl.status)) parts.push(t(`cr.fx.plan.${tl.status}`, p));
  if (tl.planting_in_window === false) parts.push(t("cr.fx.plan.outside", p));
  return { headline: monthYearLong(tl.planting), tone: bad ? "bad" : matches ? "good" : "warn", matches, text: parts.join(" ") };
}

// ---- 3. soil, 4. temperature, 5. rainfall ----------------------------------------------------------------------

function soilOf(r, inputs, crop, t) {
  const rows = indicatorRows(r, SOIL, inputs, t).map((x) => ({ ...valueRow(x, t(`cr.fx.soil.${x.feature}`), t), short: t(`cr.fx.short.${x.feature}`) }));
  const known = rows.filter((x) => x.judged.state !== "unknown");
  const edge = known.filter((x) => x.judged.state === "edge");
  const within = known.filter((x) => x.judged.state === "ok" || x.judged.state === "edge"), off = known.filter((x) => x.judged.state === "low" || x.judged.state === "high");
  let headline, text;
  if (!known.length) { headline = t("score.notAvailable"); text = t("cr.fx.na"); }
  else if (!off.length) {
    headline = t(edge.length ? "cr.fx.withinEdge" : "cr.fx.withinUsual");
    text = [t("cr.fx.soil.allOk", { crop }), edge.length ? t("cr.fx.edgeSoil", { what: join(edge.map((x) => capital(x.short)), t), verb: t(edge.length > 1 ? "cr.fx.are" : "cr.fx.is") }) : null].filter(Boolean).join(" ");
  }
  else {
    headline = off.length === 1 ? t("cr.fx.attention1", { what: capital(off[0].short) })
      : off.length === 2 ? t("cr.fx.attention2", { what: join(off.map((x) => capital(x.short)), t) }) : t("cr.fx.attentionN", { n: off.length });
    const lead = t(within.length > off.length ? "cr.fx.soil.most" : "cr.fx.soil.some", { crop });
    const lines = off.map((x) => t("cr.fx.offLine", { label: capital(x.short), how: t(`cr.fx.how.${x.judged.state}${x.judged.size === "slight" ? "Slight" : ""}`) }));
    text = [lead, ...lines, t("cr.fx.soil.check")].join(" ");
  }
  return { rows, headline, text, tone: known.length ? (known.some((x) => x.tone === "bad") ? "bad" : off.length ? "warn" : "good") : "neutral", within, off, edge };
}

function weatherOf(feature, r, inputs, crop, t) {
  const [row] = indicatorRows(r, [feature], inputs, t);
  const v = valueRow(row, t(`feature.${feature}`), t);
  const state = v.judged.state;
  let headline, text;
  if (state === "unknown") { headline = t("score.notAvailable"); text = t("cr.fx.na"); }
  else {
    const range = `${clean(row.low)}–${clean(row.high)}${row.unit ? `${row.unit === "°C" ? "" : " "}${row.unit}` : ""}`;
    if (state === "edge") {
      headline = t("cr.fx.edgeHead");
      text = t("cr.fx.edgeText", { label: t(`cr.fx.name.${feature}`), value: row.shown, range, crop });
    } else {
      headline = state === "ok" ? t("cr.fx.withinUsual")
        : feature === "rainfall" ? t(`cr.fx.rain.head.${state}`) : t(`cr.fx.${state === "low" ? "belowUsual" : "aboveUsual"}`);
      text = t(`cr.fx.${feature}.${state}`, { crop, value: row.shown, range });
    }
  }
  return { ...v, headline, text, short: t(`cr.fx.name.${feature}`), note: feature === "rainfall" ? t("cr.fx.rainNote") : null };
}

// ---- 6. expected profit --------------------------------------------------------------------------------------------

function profitOf(r, response, crop, t) {
  const e = r.economics;
  if (!e || !Number.isFinite(e.net_profit)) return null;
  const ranked = response.results.filter((x) => x.profit_rank != null).length;
  const rank = r.profit_rank;
  const loss = e.net_profit <= 0;
  const top = rank === 1 && !loss;
  const rough = reliabilityOf(r) !== "tested";
  const month = monthYearLong(response.selling_date);
  const p = { crop, n: ranked, rank, summary: sellableSummary(response, t).text };
  const headline = loss ? t("cr.fx.profit.head.loss") : top ? t("cr.fx.profit.head.top") : rank != null ? t("cr.fx.profit.head.rank", p) : t("cr.fx.profit.head.positive");
  const body = loss ? t("cr.fx.profit.text.loss", p) : top ? t("cr.fx.profit.text.top", p) : rank != null ? t("cr.fx.profit.text.rank", p) : t("cr.fx.profit.text.positive", p);
  return {
    amount: rupees(Math.abs(e.net_profit)), loss, top, rank, ranked, rough, headline,
    tone: loss ? "bad" : rough ? "warn" : "good",
    text: `${body} ${t("cr.fx.profit.vary")}`,
    label: t(loss ? "cr.fx.profit.netLoss" : "cr.fx.profit.net", { farm: acresText(response.area_acres, t) }),
    metrics: [
      { key: "revenue", label: t("cr.fx.profit.revenue"), value: rupees(e.gross_revenue) },
      { key: "cost", label: t("cr.fx.profit.cost"), value: rupees(e.total_cost) },
      { key: "price", label: t("cr.fx.profit.price"), value: rupees(e.selling_price), sub: t("cr.fx.profit.priceSub", { month }) },
    ],
    note: rough ? t("cr.pts.roughPrice") : null,
  };
}

// ---- final explanation ------------------------------------------------------------------------------------------------

function finalOf({ r, response, planning, soil, temperature, rainfall, profit, crop, t }) {
  const recommended = r.crop_name === recommendedName(response);
  const strengths = [], limits = [];
  if (profit?.top) strengths.push(t("cr.fx.s.profitTop", { n: profit.ranked }));
  else if (profit && !profit.loss && profit.rank != null) strengths.push(t("cr.fx.s.profitRank", { rank: profit.rank, n: profit.ranked }));
  if (planning?.matches) strengths.push(t("cr.fx.s.timing"));
  else if (planning) limits.push(t("cr.fx.l.timing"));
  if (profit?.loss) limits.push(t("cr.fx.l.loss"));
  else if (profit?.rough) limits.push(t("cr.fx.l.rough"));

  // soil is one "within" item only when every soil value is inside its range; values outside are named one by one
  const ok = [], off = [];
  if (soil.rows.some((x) => x.judged.state !== "unknown") && !soil.off.length) ok.push({ name: t("cr.fx.name.soil"), plural: true });
  else soil.off.forEach((x) => off.push({ name: x.short }));
  // values just outside the range are named on their own: they are not a problem and are never listed as needing attention
  const edge = soil.edge.map((x) => ({ name: x.short }));
  for (const w of [temperature, rainfall]) {
    if (w.judged.state === "ok") ok.push({ name: w.short });
    else if (w.judged.state === "edge") edge.push({ name: w.short });
    else if (w.judged.state !== "unknown") off.push({ name: w.short });
  }
  const many = (list) => list.length > 1 || list.some((x) => x.plural);
  const sub = { ok: join(ok.map((x) => x.name), t), okVerb: t(many(ok) ? "cr.fx.are" : "cr.fx.is"),
    off: join(off.map((x) => x.name), t), offVerb: t(many(off) ? "cr.fx.need" : "cr.fx.needs") };

  const parts = [];
  if (recommended) parts.push(t(strengths.length ? "cr.fx.fin.top" : "cr.fx.fin.topPlain", { crop, list: join(strengths, t) }));
  else {
    parts.push(t("cr.fx.fin.rank", { crop, rank: r.rank, n: response.results.length }));
    if (strengths.length) parts.push(t("cr.fx.fin.for", { list: join(strengths, t) }));
  }
  if (ok.length && off.length) parts.push(t("cr.fx.fin.both", sub));
  else if (ok.length) parts.push(t("cr.fx.fin.onlyOk", sub));
  else if (off.length) parts.push(t("cr.fx.fin.onlyOff", sub));
  if (edge.length) parts.push(t("cr.fx.fin.edge", { list: capital(join(edge.map((x) => x.name), t)), verb: t(edge.length > 1 ? "cr.fx.are" : "cr.fx.is") }));
  if (limits.length) parts.push(t("cr.fx.fin.limits", { list: join(limits, t) }));
  const advice = [];
  if (soil.off.length) advice.push(t("cr.fx.adv.soil"));
  if (rainfall.judged.state === "low") advice.push(t("cr.fx.adv.water"));
  if (advice.length) parts.push(t("cr.fx.adv.lead", { list: join([capital(advice[0]), ...advice.slice(1)], t) }));
  return parts.join(" ");
}

/** Everything the explanation section shows for one crop result. */
export function buildExplanation(r, response, inputs, t) {
  const crop = cropName(t, r.crop_name);
  const location = locationOf(r, response, crop, t);
  const planning = planningOf(r, crop, t);
  const soil = soilOf(r, inputs, crop, t);
  const temperature = weatherOf("temperature", r, inputs, crop, t);
  const rainfall = weatherOf("rainfall", r, inputs, crop, t);
  const profit = profitOf(r, response, crop, t);
  return { crop, location, planning, soil, temperature, rainfall, profit, final: finalOf({ r, response, planning, soil, temperature, rainfall, profit, crop, t }) };
}
