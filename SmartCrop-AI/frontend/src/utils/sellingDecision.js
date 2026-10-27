// Smart Selling: should the farmer sell on the planned date or on another one? One pure function decides, from prices
// that are passed in; it never reads the page. A different date counts as better only when its price beats the planned
// date's price by MORE than the typical forecast miss, and only inside the crop's shelf life.
import { addDays, daysBetween } from "./format";
import { isContextOnly } from "./priceView";
import { selectedPrice } from "./selectedPrice";

export const STEP_DAYS = 7;
const median = (v) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * Candidate selling dates, every 7 days. Normally the planned date + 7, 14, ... up to today + shelf life. When the planned
 * date is beyond the shelf life, the dates 7 days apart going back from it, from tomorrow to today + shelf life.
 */
export function candidateDates(plannedDate, today, shelfDays) {
  const last = addDays(today, shelfDays), first = addDays(today, 1);
  const out = [];
  if (daysBetween(today, plannedDate) > shelfDays) {
    for (let d = addDays(plannedDate, -STEP_DAYS); d >= first; d = addDays(d, -STEP_DAYS)) if (d <= last) out.push(d);
    return out.reverse();
  }
  for (let d = addDays(plannedDate, STEP_DAYS); d <= last; d = addDays(d, STEP_DAYS)) out.push(d);
  return out;
}

/**
 * { code, chip, recommended, best, sellBy, plannedBeyond, source }
 *   A  planned date is best, or the gain is within the typical miss   chip "none"       recommended "planned"
 *   B  a better date inside the shelf life (gain > typical miss)      chip "wait"       recommended "best"
 *   C  no reliable comparison (no best date, no higher price named)   chip "none"       recommended "planned"
 *   D  planned date is beyond the shelf life                          chip "sell_soon"  recommended "best" or null
 * `best` = { date, price, diff, pct, days, gainSmall } (days: after the planned date, negative = earlier).
 * `priceAt(date)` gives the estimated price or null; `typicalMiss` is in rupees (null: any gain above 0 counts).
 */
export function decideSelling({ plannedDate, today, shelfDays, plannedPrice, priceAt, typicalMiss = null, dates = null }) {
  const plannedBeyond = daysBetween(today, plannedDate) > shelfDays;
  const sellBy = addDays(today, shelfDays);
  const priced = (dates || candidateDates(plannedDate, today, shelfDays))
    .map((date) => ({ date, price: priceAt(date) })).filter((c) => c.price != null && Number.isFinite(c.price));
  const top = priced.reduce((b, c) => (!b || c.price > b.price ? c : b), null);   // earliest date wins a tie

  if (plannedBeyond) {
    const best = top && { date: top.date, price: top.price, days: daysBetween(plannedDate, top.date),
      diff: plannedPrice == null ? null : top.price - plannedPrice, pct: plannedPrice ? ((top.price - plannedPrice) / plannedPrice) * 100 : null, gainSmall: false };
    return { code: "D", chip: "sell_soon", recommended: best ? "best" : null, best, sellBy, plannedBeyond: true };
  }
  if (plannedPrice == null || !top) return { code: "C", chip: "none", recommended: "planned", best: null, sellBy, plannedBeyond: false };

  const diff = top.price - plannedPrice;
  const best = { date: top.date, price: top.price, diff, pct: plannedPrice ? (diff / plannedPrice) * 100 : 0, days: daysBetween(plannedDate, top.date),
    gainSmall: diff <= (typicalMiss ?? 0) };
  return best.gainSmall
    ? { code: "A", chip: "none", recommended: "planned", best, sellBy, plannedBeyond: false }
    : { code: "B", chip: "wait", recommended: "best", best, sellBy, plannedBeyond: false };
}

/**
 * The price estimator for the dates around the planned one. Forecast allowed: the daily forecast. Forecast blocked: the
 * "same time in earlier years" pattern, only for a date where at least 3 earlier years have a price both on the planned date
 * and on that date AND more than half of them moved the same way; the price is the planned-date price times the typical
 * change of those years. Otherwise null (no reliable comparison).
 */
export function makePriceAt(f) {
  const planned = f.target_date;
  if (!isContextOnly(f)) {
    const byDate = new Map((f.chart_path || f.path || []).map((p) => [p.date, p.predicted_price]));
    return (date) => byDate.get(date) ?? null;
  }
  const base = selectedPrice(f)?.price;
  return (date) => {
    const off = daysBetween(planned, date);
    if (base == null || off % STEP_DAYS !== 0) return null;
    const ratios = (f.earlier_years || [])
      .filter((y) => y.weekly && y.weekly[String(off)] != null && y.weekly["0"] != null)
      .map((y) => y.weekly[String(off)] / y.weekly["0"]);
    if (ratios.length < 3) return null;
    const up = ratios.filter((r) => r > 1).length, down = ratios.filter((r) => r < 1).length;
    if (Math.max(up, down) * 2 <= ratios.length) return null;       // most years must agree on the direction
    return base * median(ratios);
  };
}
