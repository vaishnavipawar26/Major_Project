// Pure helpers for the crop result page: they turn the API response into the short, farmer-facing
// facts the page shows. No React and no calculations of money here - prices, profit and scores are
// always the API's own numbers; these helpers only classify and phrase them.
import { cropName, monthLabel, monthLong, rupees, signedRupees } from "./format";

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
export function reliabilityOf(r) {
  const m = r.market;
  if (!m) return "unavailable";
  if (m.beyond_model_horizon || !m.reliability.beats_baseline) return "limited";
  return "tested";
}

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

/** Recommendation status of one crop, used for badges in the comparison table. */
export function statusOf(r, response) {
  if (!r.feasible) return { key: "notFeasible", tone: "bad" };
  if (r.crop_name === response.best_overall) return { key: "best", tone: "good" };
  if (r.recommended) return { key: "recommended", tone: "good" };
  if (!r.profitable) return { key: "loss", tone: "bad" };
  if (r.low_agronomic_suitability) return { key: "poorFit", tone: "warn" };
  return { key: "notTop", tone: "neutral" };
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
      reliability: reliabilityOf(r), status: statusOf(r, response),
      isBest: r.crop_name === response.best_overall, isTop: r.crop_name === response.highest_profit,
    };
  });
}

/** One indicator line: tone is "up" (helps), "down" (may reduce returns) or "flat" (limited effect). */
const item = (tone, text) => ({ tone, text });

/** Price, profit and (if the data supports it) one seasonal trend for the "market" card. */
export function marketFacts(r, response, t) {
  const e = r.economics, m = r.market;
  const crop = cropName(t, r.crop_name), sell = monthLabel(response.selling_date);
  if (!e || !m) return [item("flat", t("cr.mkt.noForecast", { crop }))];
  const ref = t("cr.mkt.reference", { month: monthLabel(m.latest_month), price: rupees(m.latest_price) });
  const change = m.change_pct;
  const out = [Math.abs(change) < FLAT_PCT
    ? item("flat", t("cr.mkt.priceFlat", { month: sell, price: rupees(e.selling_price), ref }))
    : item(change > 0 ? "up" : "down", t(change > 0 ? "cr.mkt.priceUp" : "cr.mkt.priceDown",
      { month: sell, price: rupees(e.selling_price), pct: Math.abs(Math.round(change)), ref }))];
  out.push(e.net_profit > 0
    ? item("up", t("cr.mkt.profitPos", { profit: signedRupees(e.net_profit), roi: Math.round(e.roi_pct) }))
    : item("down", t("cr.mkt.profitNeg", { loss: rupees(Math.abs(e.net_profit)), breakEven: rupees(e.break_even_price) })));
  const s = m.explanation?.seasonal;
  if (s) {
    const month = monthLong(s.month);
    if (s.price_vs_avg_pct <= -FLAT_PCT) out.push(item("down", t("cr.mkt.seasonLow", { crop, month })));
    else if (s.price_vs_avg_pct >= FLAT_PCT) out.push(item("up", t("cr.mkt.seasonHigh", { crop, month })));
    else if (s.arrivals_vs_avg_pct != null && Math.abs(s.arrivals_vs_avg_pct) >= FLAT_PCT) {
      out.push(item("flat", t(s.arrivals_vs_avg_pct > 0 ? "cr.mkt.arrivalsHigh" : "cr.mkt.arrivalsLow", { crop, month })));
    }
  }
  return out;
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
    const state = fa.within_typical_range ? "ok" : v < fa.typical_low ? "low" : "high";
    return {
      feature: f, label: t(`feature.${f}`), value: fa.value, ok: state === "ok",
      status: t(`cr.ind.${state}`), range: t("cr.ind.range", { low: fa.typical_low, high: fa.typical_high, unit }),
    };
  });
}

/** Planting window, expected harvest and whether the selling month fits the crop cycle. */
export function plantingFacts(r, t) {
  const tl = r.timeline, crop = cropName(t, r.crop_name);
  const args = {
    crop, grow: tl.growth_months_min === tl.growth_months_max ? `${tl.growth_months_min}` : `${tl.growth_months_min}–${tl.growth_months_max}`,
    plant: monthLabel(tl.planting), sell: monthLabel(tl.selling), n: tl.months_stored, harvest: harvestSpan(tl),
    month: monthLong(monthNo(tl.planting)), usual: tl.planting_months.map(monthLong).join(", "),
  };
  return [
    item(tl.planting_in_window ? "up" : "down", t(tl.planting_in_window ? "cr.time.plantOk" : "cr.time.plantOut", args)),
    item("flat", t("cr.time.ready", args)),
    item({ fresh: "up", stored: "flat", not_ready: "down", spoiled: "down" }[tl.status], t(`timeline.concl.${tl.status}`, args)),
  ];
}
