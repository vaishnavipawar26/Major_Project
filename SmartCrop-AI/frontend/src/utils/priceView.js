import { fmtDate, rupees } from "./format";

/** Display rules for a price forecast, kept in one place so every page applies them the same way. */

/** True where backtests show the model is not reliable enough to claim a rise or fall (crop x distance). */
export const isContextOnly = (x) => x?.policy?.mode === "context_only";

/**
 * How the forecast's range may be shown, from the measured coverage the backend reports for this crop and distance:
 *   "hidden"     coverage below the threshold (40 %): the range is not shown at all
 *   "measured"   coverage known and high enough: shown together with how often the real price fell inside it
 *   "unmeasured" no backtest figure exists: shown, but said to be unmeasured
 *   "none"       nothing to show (context-only cells have no model price, so no model range)
 * The word "likely" is never used: a range is described only by what testing showed.
 */
export function rangeView(forecast) {
  if (!forecast || isContextOnly(forecast)) return { kind: "none" };
  const ri = forecast.range_info;
  const t = forecast.target;
  if (ri && ri.shown === false) return { kind: "hidden", pct: ri.coverage_pct };
  if (ri && ri.coverage_pct != null) return { kind: "measured", low: t.lower, high: t.upper, pct: Math.round(ri.coverage_pct), n: ri.n };
  return { kind: "unmeasured", low: t.lower, high: t.upper };
}

/**
 * True where the model's estimate differs from the starting price by less than its typical miss for this crop and distance
 * (the backend's `verdict`, the same call the explanation page makes): the headline then says "about the same".
 */
export const isAboutSame = (x) => !isContextOnly(x) && x?.verdict?.code === "about_the_same";

/** The one "Latest recorded price" sentence (backend `latest_recorded`: last real report, its date and age). */
export function latestText(t, lr) {
  if (!lr) return null;
  const vars = { price: rupees(lr.price), date: fmtDate(lr.date), n: lr.age_n };
  if (lr.stale) return t("price.latest.stale", vars);
  return t(lr.age_n === 0 ? "price.latest.today" : lr.age_n === 1 ? "price.latest.fresh1" : "price.latest.fresh", vars);
}
