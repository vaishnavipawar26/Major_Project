// The ONE price for the farmer's selected date. The chart's "Your date" dot, the "Your estimated price" card and the
// "Your planned date" tile of Smart Selling all read it from here, so the three can never disagree.
//   forecast allowed -> the model's estimate for that date (with its likely range)
//   forecast blocked -> last year's price on that date, inflation adjusted like the rest of the chart (no range, and
//                       it is a past price, never an expected one)
import { priceOnDate } from "./priceChart";
import { isContextOnly } from "./priceView";

/** Past prices drawn as the grey line: the history plus last year's (or the real later) prices on to the chart's end. */
export const referenceRows = (f) => [...(f.history || []), ...(f.history_is_reference ? (f.reference_after || []) : (f.actual_after_origin || []))];

/** { price, low, high, source: "forecast" | "reference", averaged } or null when there is no price to show. */
export function selectedPrice(f) {
  if (!f) return null;
  if (!isContextOnly(f)) {
    const t = f.target;
    return t ? { price: t.predicted_price, low: t.lower, high: t.upper, source: "forecast", averaged: false } : null;
  }
  const p = priceOnDate(referenceRows(f), f.target_date);
  return p ? { price: p.price, low: null, high: null, source: "reference", averaged: p.averaged } : null;
}

/** How far past estimates were usually off (rupees per quintal), or null. */
export const typicalMiss = (f) => f?.range_info?.typical_miss_inr ?? f?.target?.model_mae ?? null;

const shiftYears = (iso, years) => {
  const [y, m, d] = iso.split("-").map(Number);
  const out = new Date(Date.UTC(y + years, m - 1, d));
  if (out.getUTCMonth() !== m - 1) out.setUTCDate(0);          // 29 Feb in a non-leap year -> 28 Feb
  return out.toISOString().slice(0, 10);
};

/**
 * Where a "reference" (historical) price really comes from. The backend moves earlier records forward whole years (and scales them to today's
 * price level), so the dates it sends are in the planned year; the price itself was reported `years` earlier.
 * { years, sourceDate, inflationPct } - years is 0 when the price is a real report of that very date.
 */
export function referenceInfo(f) {
  const years = f?.dates?.years_shifted ?? f?.projection?.years_ahead ?? 0;
  return { years, sourceDate: years > 0 && f?.target_date ? shiftYears(f.target_date, -years) : f?.target_date ?? null,
    inflationPct: f?.projection?.inflation_annual_pct ?? null };
}
