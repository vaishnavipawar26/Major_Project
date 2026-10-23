// Pure helpers for the crop result page: they turn the API response into the short, farmer-facing
// facts the page shows. No React and no calculations of money here - prices, profit and scores are
// always the API's own numbers; these helpers only classify and phrase them.
import { cropName, monthLabel, monthLong, rupees } from "./format";

const INPUT_OF = { N: "nitrogen", P: "phosphorus", K: "potassium", ph: "ph", temperature: "temperature", humidity: "humidity", rainfall: "rainfall" };
export const SOIL = ["N", "P", "K", "ph"];
export const WEATHER = ["temperature", "humidity", "rainfall"];
// price moves smaller than this are called "about the same" (same cut-off the API uses for its trend label)
const FLAT_PCT = 5;

/** Month number (1-12) of "2027-03". */
const monthNo = (ym) => Number(ym.split("-")[1]);

export const inRange = (r) => r.range_fit.soil.within + r.range_fit.weather.within;
export const rangeTotal = (r) => r.range_fit.soil.total + r.range_fit.weather.total;

/** Harvest window as text: "Mar 2027" or "Feb 2027 – Apr 2027". */
export const harvestSpan = (tl) => (tl.harvest_start === tl.harvest_end
  ? monthLabel(tl.harvest_start) : `${monthLabel(tl.harvest_start)} – ${monthLabel(tl.harvest_end)}`);

/** Is the price forecast for this crop trustworthy? tested = beat the simple baseline in testing. */
export const reliabilityOf = (r) => r.forecast_reliability;

/**
 * Best month to sell, read from the API's own selling options. Those options already cover only the
 * sellable window (earliest harvest up to the last storage month) and only months the produce is fresh
 * or storable, so the pick can never fall outside it. The best month is the one with the highest
 * projected price; "gain" is the extra net profit per quintal over the chosen month, which already
 * includes the extra storage cost and storage losses.
 * kind: "best" (chosen month is the best), "similar" (< 5% price difference), "costly" (higher price
 * but extra costs cancel it) or "wait".
 */
export function bestSellTime(r, response) {
  const e = r.economics;
  const sellable = (r.selling_options || []).filter((o) => o.status === "fresh" || o.status === "stored");
  if (!e || !sellable.length) return null;
  const top = sellable.reduce((b, o) => (o.price > b.price ? o : b));
  // the chosen month counts as best unless another month is projected higher
  const best = top.price > e.selling_price ? top : { month: response.selling_date, price: e.selling_price, net_profit: e.net_profit };
  const diffPct = e.selling_price ? ((best.price - e.selling_price) / e.selling_price) * 100 : 0;
  const gain = e.effective_yield_q ? (best.net_profit - e.net_profit) / e.effective_yield_q : null;
  let kind = "wait";
  if (best.month === response.selling_date) kind = "best";
  else if (diffPct < FLAT_PCT) kind = "similar";
  else if (gain != null && gain <= 0) kind = "costly";
  return { month: best.month, price: best.price, diffPct, gain, kind };
}

/** "2027-11" -> "November 2027" */
export const monthYear = (ym) => `${monthLong(monthNo(ym))} ${ym.split("-")[0]}`;

/** ROI in % = net profit / estimated costs x 100, from the API's own unrounded-to-percent figures; null if unusable. */
export const roiOf = (e) => {
  if (!e || !Number.isFinite(e.net_profit) || !Number.isFinite(e.total_cost) || e.total_cost <= 0) return null;
  return (e.net_profit / e.total_cost) * 100;
};

/**
 * Data for "Why X ranks first": the best overall crop set against the crop with the highest total profit,
 * using only the API's own figures. Total profit and profit per Rs 100 spent (ROI) are separate
 * comparisons. The ROI comparison is shown only when both ROI values are valid and the best crop's
 * rounded return is really higher; the "choose" advice only when the profit leader is itself a sound
 * option (feasible, profitable, good soil/weather fit). Returns null when one crop wins both or none is recommended.
 */
export function rankingCompare(response) {
  // both winners are read from the ranked results themselves and compared by crop id (crop_name)
  const results = response.results || [];
  const best = results.find((r) => r.rank === 1 && r.recommended);
  const top = results.find((r) => r.profit_rank === 1);
  if (!best || !top || best.crop_name === top.crop_name) return null;
  if (!Number.isFinite(best.economics?.net_profit) || !Number.isFinite(top.economics?.net_profit)) return null;
  const ex = response.ranking_explanation;
  const reasonsOk = ex && ex.best_overall === best.crop_name && ex.highest_profit === top.crop_name;
  const be = best.economics, te = top.economics;
  const gap = te.net_profit - be.net_profit;
  if (!(gap > 0)) return null; // the profit leader must really earn more
  const rb = roiOf(be), rt = roiOf(te);
  const roi = rb != null && rt != null ? { best: Math.round(rb), top: Math.round(rt) } : null;
  const roiShown = !!roi && roi.best - roi.top >= 1 && gap > 0;
  return {
    best, top, gap, roiShown,
    roi: roiShown ? roi : null,
    roiDiff: roiShown ? roi.best - roi.top : null,
    cheaper: be.total_cost < te.total_cost,
    // fit, timing and forecast reasons come from the score; "returns" is what the ROI panel itself shows
    reasons: (reasonsOk ? ex.reasons : []).filter((x) => x.code !== "returns"),
    canChoose: roiShown && top.eligible && !top.low_agronomic_suitability,
    weights: response.weights,
  };
}

/**
 * The crop whose details (and bold bar outline) are shown: the one the farmer clicked, else the best overall crop (the
 * recommended #1, which need not be the most profitable one), else the highest-profit crop, else the first-ranked crop.
 * Always found by crop name, never by position, so the chart's profit order cannot shift it.
 */
export function defaultCrop(results, response, selected) {
  return results.find((r) => r.crop_name === selected) || results.find((r) => r.crop_name === response.best_overall)
    || results.find((r) => r.crop_name === response.highest_profit) || results[0];
}

/** Rows for the all-crops chart and table: every number comes straight from the API. */
export function compareRows(results, response, t) {
  return results.map((r) => {
    const e = r.economics;
    return {
      crop: r.crop_name, name: cropName(t, r.crop_name), result: r,
      price: e?.selling_price ?? null, revenue: e?.gross_revenue ?? null, cost: e?.total_cost ?? null,
      profit: e?.net_profit ?? null, roi: e?.roi_pct ?? null,
      soil: r.range_fit.soil, weather: r.range_fit.weather,
      timing: e?.status ?? r.timeline.status, feasible: r.feasible,
      reliability: reliabilityOf(r), status: r.status, rank: r.rank, profitRank: r.profit_rank,
      isBest: r.crop_name === response.best_overall, isTop: r.crop_name === response.highest_profit,
      // no reliable price forecast for this crop (crop_policy.json): its profit bar is a rough estimate
      rough: r.price_policy === "context_only",
    };
  });
}

/** "a", "a and b", "a, b and c" */
const joinWords = (xs, and) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${and} ${xs[xs.length - 1]}`);

/** Soil and weather values outside the crop's usual range, largest deviation first (deviation = distance beyond the bound / width of the range). */
export function outOfRange(r) {
  return (r.important_factors || [])
    .filter((f) => [...SOIL, ...WEATHER].includes(f.feature) && f.within_typical_range === false && f.typical_low != null && f.typical_high != null)
    .map((f) => {
      const v = parseFloat(f.value), low = v < f.typical_low;
      const width = f.typical_high - f.typical_low || 1;
      return { feature: f.feature, low, deviation: Math.abs(low ? f.typical_low - v : v - f.typical_high) / width };
    })
    .filter((x) => Number.isFinite(x.deviation))
    .sort((a, b) => b.deviation - a.deviation);
}

/** Profit difference for the note: nearest 1,000 rupees (nearest 100 when that would round to zero). */
const roundGap = (g) => (g >= 500 ? Math.round(g / 1000) * 1000 : Math.max(100, Math.round(g / 100) * 100));

/**
 * The short "Why <crop>?" paragraph under the profit chart, only when the recommended (#1) crop is not the most profitable one
 * that can be sold in the chosen month. Everything comes from the API's scores and reference-range checks:
 *  - "fully" when every soil and weather value of the recommended crop is in range, else "better";
 *  - the reasons are the most profitable crop's two largest out-of-range soil/weather deviations, with direction;
 *  - with none out of range, the real ranking factor that is lower for it: timing (planting window / growing period), else the
 *    profit score (return on the money spent), else the overall score.
 * Null when there is nothing to explain.
 */
export function chartNote(response, t) {
  const results = response.results || [];
  const best = results.find((r) => r.crop_name === response.best_overall);
  const sellable = results.filter((r) => r.feasible && Number.isFinite(r.economics?.net_profit));
  const top = sellable.reduce((m, r) => (!m || r.economics.net_profit > m.economics.net_profit ? r : m), null);
  if (!best || !top || top.crop_name === best.crop_name || !Number.isFinite(best.economics?.net_profit)) return null;
  const gap = top.economics.net_profit - best.economics.net_profit;
  if (!(gap > 0)) return null;
  const fit = best.range_fit.soil.within + best.range_fit.weather.within === best.range_fit.soil.total + best.range_fit.weather.total ? "fully" : "better";
  const p = { best: cropName(t, best.crop_name), top: cropName(t, top.crop_name), gap: rupees(roundGap(gap)), fit: t(`cr.chart.fit.${fit}`) };
  const bad = outOfRange(top).slice(0, 2);
  if (bad.length) return t("cr.chart.why", { ...p, reasons: joinWords(bad.map((x) => t(`cr.chart.f.${x.feature}.${x.low ? "low" : "high"}`)), t("cr.chart.and")) });
  if (top.timing_score < best.timing_score) return t("cr.chart.whyTiming", p);
  if (top.profit_score_used < best.profit_score_used) return t("cr.chart.whyReturns", p);
  return t("cr.chart.whyOverall", p);
}

/**
 * Soil or weather inputs as simple rows. "ok" only means the value lies in the crop's usual range in the
 * dataset; it never claims the value is optimal, and a value is not called harmful because another crop
 * fits it better.
 */
export function indicatorRows(r, features, inputs, t) {
  const byFeature = Object.fromEntries(r.important_factors.map((f) => [f.feature, f]));
  return features.map((f) => {
    const fa = byFeature[f];
    const v = inputs[INPUT_OF[f]];
    const unit = fa.unit ? ` ${fa.unit}` : "";
    const n = v === "" || v == null ? NaN : Number(v);
    const known = !Number.isNaN(n) && fa.typical_low != null && fa.typical_high != null;
    const state = !known ? "unknown" : n < fa.typical_low ? "low" : n > fa.typical_high ? "high" : "ok";
    return {
      feature: f, label: t(`feature.${f}`), value: fa.value, ok: state === "ok", state,
      num: known ? n : null, low: fa.typical_low, high: fa.typical_high, unit: fa.unit || "",
      status: state === "unknown" ? t("score.notAvailable") : t(`cr.ind.${state}`),
      range: t("cr.ind.range", { low: fa.typical_low, high: fa.typical_high, unit }),
    };
  });
}

// Presentation bands for the overall 0-100 score; they only label the number, they do not change it.
const GOOD_SCORE = 70, OK_SCORE = 50;

/** "good" | "moderate" | "weak" | "notFeasible" - the band shown beside the overall score. */
export function fitBand(r) {
  if (!r.feasible) return "notFeasible";
  if (r.recommendation_score >= GOOD_SCORE) return "good";
  return r.recommendation_score >= OK_SCORE ? "moderate" : "weak";
}

/** The soil or weather value furthest from helping: the first outside-the-usual-range factor, in the API's importance order. */
export function mainConcern(r, inputs, t) {
  const rows = indicatorRows(r, [...SOIL, ...WEATHER], inputs, t);
  const byFeature = Object.fromEntries(r.important_factors.map((f) => [f.feature, f]));
  const order = r.important_factors.map((f) => f.feature);
  const bad = rows.filter((x) => x.state === "low" || x.state === "high").sort((a, b) => order.indexOf(a.feature) - order.indexOf(b.feature));
  if (!bad.length) return null;
  const x = bad[0], fa = byFeature[x.feature];
  return { feature: x.feature, label: x.label, low: x.state === "low", value: fa.value,
    range: `${fa.typical_low}–${fa.typical_high}${fa.unit ? ` ${fa.unit}` : ""}` };
}

/** One or two plain sentences on why the crop got its score, built from the three part scores. */
export function fitSummary(r, inputs, t) {
  const crop = cropName(t, r.crop_name);
  const parts = [
    { key: "field", score: r.agronomic_score },
    { key: "plan", score: r.timing_score },
    { key: "profit", score: r.profit_score },
  ].filter((p) => p.score != null);
  const strong = parts.filter((p) => p.score >= GOOD_SCORE).map((p) => t(`cr.sum.strong.${p.key}`));
  const weak = parts.filter((p) => p.score < OK_SCORE).map((p) => t(`cr.sum.weak.${p.key}`));
  const out = [strong.length
    ? t("cr.sum.matches", { crop, list: strong.join(t("cr.sum.and")) })
    : t("cr.sum.partly", { crop })];
  if (weak.length) out.push(t("cr.sum.weakPart", { list: weak.join(t("cr.sum.and")) }));
  const c = mainConcern(r, inputs, t);
  if (c) out.push(t("cr.sum.attention", { factor: c.label }));
  return out.join(" ");
}

/** The three default points: profit outlook, field conditions, planting and harvest. Each has a tone for the icon. */
export function keyPoints(r, response, inputs, t) {
  const e = r.economics, tl = r.timeline;
  const crop = cropName(t, r.crop_name), month = monthYear(response.selling_date);
  let profit;
  if (!e) profit = { tone: "flat", text: t("cr.pts.noForecast", { crop }) };
  else {
    const rough = reliabilityOf(r) !== "tested" ? ` ${t("cr.pts.roughPrice")}` : "";
    profit = e.net_profit > 0
      ? { tone: "good", text: t("cr.pts.profitPos", { price: rupees(e.selling_price), month, profit: rupees(e.net_profit) }) + rough }
      : { tone: "warn", text: t("cr.pts.profitNeg", { price: rupees(e.selling_price), month, loss: rupees(Math.abs(e.net_profit)),
        breakEven: rupees(e.break_even_price) }) + rough };
  }
  const c = mainConcern(r, inputs, t);
  const field = c
    ? { tone: "warn", text: t(c.low ? "cr.pts.fieldLow" : "cr.pts.fieldHigh", { label: c.label, crop, value: c.value, range: c.range })
      + (c.feature === "rainfall" && c.low ? ` ${t("cr.pts.irrigation")}` : "") }
    : { tone: "good", text: t("cr.pts.fieldOk", { crop }) };
  const plant = monthLong(monthNo(tl.planting)), harvest = harvestSpan(tl);
  let timing = tl.planting_in_window
    ? t("cr.pts.plantOk", { plant, harvest })
    : t("cr.pts.plantOut", { plant, harvest });
  const bad = tl.status === "not_ready" || tl.status === "spoiled";
  if (bad) timing += ` ${t(`timeline.concl.${tl.status}`, { crop, sell: monthLabel(tl.selling), harvest, n: tl.months_stored })}`;
  return { profit, field, timing: { tone: tl.planting_in_window && !bad ? "good" : "warn", text: timing } };
}


/**
 * "5 of the 7 crops can be sold in Jan 2027; Brinjal earns the most of these." Generated from the results: a crop counts as sellable when the
 * month is a sale month for it (feasible) and it has an estimated profit; "the most" is the highest net profit among those crops.
 */
export function sellableSummary(response, t) {
  const total = response.results.length;
  const sellable = response.results.filter((r) => r.feasible && Number.isFinite(r.economics?.net_profit));
  const month = monthLabel(response.selling_date);
  const n = sellable.length;
  if (!n) return { n, total, text: t("cr.sell.none", { month }) };
  const top = sellable.reduce((m, r) => (r.economics.net_profit > m.economics.net_profit ? r : m));
  const crop = cropName(t, top.crop_name);
  const text = n === 1 ? t("cr.sell.one", { total, month, crop })
    : top.economics.net_profit > 0 ? t("cr.sell.many", { n, total, month, crop }) : t("cr.sell.noProfit", { n, total, month });
  return { n, total, month, top: top.crop_name, text };
}
