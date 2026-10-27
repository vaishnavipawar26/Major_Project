// Chart helpers for the result page's price chart: a gap-free daily series, a light smoothing for a jagged one, the price
// on a date and the y-axis limits. Everything is computed from the rows the API returned; nothing is invented.

export const NEAR_DAYS = 3;       // a date without a report uses the average of the reported days this far either side
export const SMOOTH_DAYS = 3;
export const JAGGED_SHARE = 0.02; // average day-to-day move above this share of the price counts as jagged
export const Y_PAD = 0.15;        // the y-axis covers at least this share above and below the starting price
const DAY = 86400000;
const ts = (iso) => Date.parse(`${iso}T00:00:00Z`);
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const byDate = (a, b) => ts(a.date) - ts(b.date);

/**
 * One row per day from the first known row to the last known row (or `to`, if earlier). A day with no report carries
 * the last known price forward, so the line has no holes. After the last known row nothing is added: the line is
 * never extended past real data.
 */
export function dailyCarried(rows, to) {
  const known = rows.filter((r) => r.price != null).sort(byDate);
  if (!known.length) return [];
  const price = new Map(known.map((r) => [r.date, r.price]));
  const end = Math.min(ts(known[known.length - 1].date), ts(to));
  const out = [];
  let last = null;
  for (let t = ts(known[0].date); t <= end; t += DAY) {
    const d = iso(t);
    if (price.has(d)) last = price.get(d);
    out.push({ date: d, price: last });
  }
  return out;
}

/** Trailing average of the last `n` values (fewer at the start). */
export function rollingMean(values, n = SMOOTH_DAYS) {
  return values.map((_, i) => {
    const w = values.slice(Math.max(0, i - n + 1), i + 1);
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
}

/** The values as they are, or a 3-day average of them when day-to-day moves are large (jagged). */
export function smoothIfJagged(values) {
  if (values.length < 3) return values;
  const moves = values.slice(1).map((v, i) => Math.abs(v - values[i]));
  const jagged = moves.reduce((a, b) => a + b, 0) / moves.length > JAGGED_SHARE * (values.reduce((a, b) => a + b, 0) / values.length);
  return jagged ? rollingMean(values, SMOOTH_DAYS) : values;
}

/**
 * The price on `date` from rows that really were reported: that day's price, or else the average of the reported
 * days within `win` days either side. { price, averaged, n } or null when there is nothing near the date.
 */
export function priceOnDate(rows, date, win = NEAR_DAYS) {
  const on = rows.filter((r) => r.price != null && r.date === date);
  const pick = on.length ? on : rows.filter((r) => r.price != null && Math.abs(ts(r.date) - ts(date)) <= win * DAY);
  if (!pick.length) return null;
  return { price: pick.reduce((a, r) => a + r.price, 0) / pick.length, averaged: !on.length, n: pick.length };
}

/** y-axis limits that keep at least ±Y_PAD of the starting price in view and every drawn price inside. */
export function yDomain(prices, start) {
  const lo = Math.min(start * (1 - Y_PAD), ...prices), hi = Math.max(start * (1 + Y_PAD), ...prices);
  return [Math.floor(lo / 50) * 50, Math.ceil(hi / 50) * 50];
}
