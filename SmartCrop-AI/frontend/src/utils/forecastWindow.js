// Rows and ticks for the 60-day forecast chart. Everything comes from the API's `window` (one entry per day) and `observed` (prices the
// market really reported); a day without a validated prediction or a report is left empty, never filled in.

const DAY = 86400000;
export const ACTUAL_GAP_DAYS = 10;     // a longer wait between two real reports is drawn as a break, not a joined line
export const ACTUAL_SHOW_DAYS = 45;    // real prices are drawn only if the latest one is this close to the forecast start
export const ts = (iso) => Date.parse(`${iso}T00:00:00Z`);
export const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const num = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * { rows, showActual, firstActual, ticks, domain } for the chart.
 * rows: { t, date, actual?, predicted?, experimental?, estimate?, range?, ref?, kind } sorted by time. `range` ([low, high]) only where the
 * API gave both. `estimate` = the API's historical estimate for a day the model does not reach (never a model price).
 * The start row carries the starting reference price (`ref`, and `predicted` so the dashed line begins there).
 */
export function chartModel(win, observed = [], { showRange = false, showExperimental = false, showEstimates = false, tickDays = 7 } = {}) {
  const start = ts(win.start_date), end = ts(win.end_date);
  const real = (observed || []).filter((p) => num(p.price) && ts(p.date) <= start);
  const latest = real.length ? ts(real.at(-1).date) : null;
  const showActual = latest != null && start - latest <= ACTUAL_SHOW_DAYS * DAY;
  const from = showActual ? start - ACTUAL_SHOW_DAYS * DAY : start;
  const rows = new Map();
  const row = (t, kind) => { if (!rows.has(t)) rows.set(t, { t, date: isoOf(t), kind }); return rows.get(t); };

  let firstActual = null;
  if (showActual) {
    const hist = real.filter((p) => ts(p.date) >= from);
    hist.forEach((p, i) => {
      if (i > 0 && ts(p.date) - ts(hist[i - 1].date) > ACTUAL_GAP_DAYS * DAY) row(ts(hist[i - 1].date) + DAY, "gap").actual = null;
      const r = row(ts(p.date), "actual");
      r.actual = p.price;
      firstActual ??= ts(p.date);
    });
  }
  if (num(win.reference_price)) {
    const r = row(start, "start");
    r.ref = win.reference_price;
    r.predicted = win.reference_price;
  }
  for (const e of win.entries) {
    if (showExperimental && e.status === "not_validated" && num(e.predicted_price)) row(ts(e.date), "experimental").experimental = e.predicted_price;
    if (showEstimates && e.status === "unavailable" && num(e.estimate?.price)) row(ts(e.date), "estimate").estimate = e.estimate.price;
    if (e.status !== "validated" || !num(e.predicted_price)) continue;
    const r = row(ts(e.date), "forecast");
    r.predicted = e.predicted_price;
    if (showRange && num(e.lower) && num(e.upper)) r.range = [e.lower, e.upper];
  }
  // a line is never drawn across days that have no validated prediction: a break row sits after every predicted day whose next predicted
  // day is more than one day later (recharts would otherwise join the two neighbouring rows)
  const predictedTimes = [...rows.values()].filter((r) => r.predicted != null).map((r) => r.t).sort((a, b) => a - b);
  predictedTimes.forEach((t0, i) => {
    const next = predictedTimes[i + 1];
    if (next != null && next - t0 > DAY && !rows.has(t0 + DAY)) row(t0 + DAY, "gap").predicted = null;
  });
  const sorted = [...rows.values()].sort((a, b) => a.t - b.t);
  const left = showActual && firstActual != null ? firstActual : start;
  const ticks = [];
  for (let t = start; t <= end; t += tickDays * DAY) ticks.push(t);
  for (let t = start - 7 * DAY; t >= left; t -= tickDays * DAY) ticks.unshift(t);
  return { rows: sorted, showActual, firstActual, ticks, domain: [left, end], latestActual: real.at(-1) || null };
}
