/**
 * Helpers for the price explanation. All contribution values here are the model's own SHAP values in the model's output units:
 * the natural log of (price on the selling date / starting price). They are NOT converted to rupees. A value of 0.05 means about
 * a 5% higher price (exp(0.05) - 1 = 5.1%) if that factor acted alone.
 */

/** Short names for the bar labels. They only shorten the backend's factor groups; the groups themselves are the model's. */
export const SHORT = {
  season: "Season", price_level: "Current price", recent_week: "Last week", recent_month: "Last month",
  averages: "Vs. average", volatility: "Price swings", arrivals: "Supply", state_market: "Other markets",
  distance: "Days ahead", crop_market: "Crop & market", other: "Other",
};

/** Largest allowed gap between base value + contributions and the model output (the backend's documented reconstruction tolerance). */
export const TOLERANCE = 1e-3;

/** A plain signed number for the chart: minus for negatives, no plus sign. */
export const fmtNum = (v, digits = 3) => `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}`;
export const fmtShap = (v, digits = 3) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;
/** What a log-scale value means for the price when that factor acts alone, in percent. */
export const aboutPct = (v) => (Math.exp(v) - 1) * 100;
export const fmtPct = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;

/**
 * The explanation can be shown only when the app trusts a price for this crop and distance and the SHAP breakdown adds up to the
 * model output.
 */
export function explanationOk(exp, ctxOnly) {
  const local = exp?.charts?.local;
  return Boolean(exp && !ctxOnly && !exp.v3?.context_only && exp.technical?.reconstruction_ok !== false && local?.matches_forecast
    && Array.isArray(local.steps) && local.steps.length > 0);
}

/** Bars: the largest factors by size (at most `max`), the rest added into one "Other" bar. Values are SHAP sums per factor group. */
export function barRows(local, max = 6) {
  const steps = [...local.steps].sort((a, b) => Math.abs(b.log_contribution) - Math.abs(a.log_contribution));
  const rows = steps.slice(0, max).map((s) => ({ key: s.group, label: SHORT[s.group] || s.title, title: s.title, help: s.help, value: s.log_contribution }));
  const rest = steps.slice(max);
  if (rest.length) rows.push({ key: "other", label: SHORT.other, title: "All other factors", help: "The smaller factors added together.", value: rest.reduce((a, s) => a + s.log_contribution, 0) });
  return rows.filter((r) => Math.abs(r.value) >= 0.0005);
}

/** Factors that raised and lowered the model output, largest first. */
export function splitSteps(local) {
  const named = [...local.steps].sort((a, b) => Math.abs(b.log_contribution) - Math.abs(a.log_contribution)).filter((s) => Math.abs(s.log_contribution) >= 0.0005);
  return { up: named.filter((s) => s.log_contribution > 0), down: named.filter((s) => s.log_contribution < 0) };
}

/**
 * The calculation on the explanation page: base value + SHAP contributions = model output (log scale), checked against the
 * model's own output, and then the documented transformation back to a price: start price x exp(output).
 */
export function calculation(exp) {
  const local = exp.charts.local;
  const base = exp.base_value;
  const sum = local.steps.reduce((a, s) => a + s.log_contribution, 0);
  const output = exp.technical.model_output_log;
  const gap = Math.abs(base + sum - output);
  const price = local.start_price * Math.exp(output);
  return { base, sum, output, gap, ok: gap <= TOLERANCE, start: local.start_price, price, forecast: local.forecast_price };
}
