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
/**
 * The model's own contributions (SHAP, rupees per quintal) for the two factor groups the price model really has, season and crop/market:
 * read from the explanation's local breakdown and only when that breakdown adds up to the forecast; otherwise null. `experimental` is true
 * when the forecast is not validated for this crop and distance. Weather and soil are not model inputs, so they never appear here.
 */
export function modelContributions(exp) {
  const local = exp?.charts?.local;
  const ok = Boolean(local?.matches_forecast);
  const of = (group) => {
    const st = ok ? (local.steps || []).find((x) => x.group === group && Number.isFinite(x.inr)) : null;
    return st ? st.inr : null;
  };
  return { season: of("season"), crop_market: of("crop_market"),
    experimental: exp?.policy?.mode === "context_only" || Boolean(exp?.v3?.context_only) };
}

/**
 * The two short lines that explain a model factor ("season" or "crop_market") from its signed SHAP value in rupees per quintal: what the
 * past prices showed, then what the model adds or subtracts. Only past price patterns are named, never a cause (supply, demand, weather).
 */
export function whyLines(t, group, inr, { crop, market }) {
  const dir = inr >= 0 ? "up" : "down";
  const n = Math.round(Math.abs(inr)).toLocaleString("en-IN");
  return [t(`wf.why.${group === "season" ? "season" : "market"}.${dir}`, { crop, market }), t(inr >= 0 ? "wf.why.adds" : "wf.why.subtracts", { n })];
}

/**
 * Where a farm-guidance value sits on its OWN scale, 0-100 (a place on a range, never a model share or an influence): humidity is already a
 * percentage, pH is out of 14, and temperature is placed between the historical min and max for the selling-date window when the weather
 * data gives them (`temperature_min_c` / `temperature_max_c`). Without them, and for soil type and the growing location (categories), null.
 */
export function scalePct(id, value, w) {
  const num = (v) => (v == null || v === "" ? NaN : Number(v));
  const n = num(value);
  if (!Number.isFinite(n)) return null;
  const clamp = (p) => Math.round(Math.min(100, Math.max(0, p)));
  if (id === "humidity") return clamp(n);
  if (id === "ph") return clamp((n / 14) * 100);
  if (id === "temperature") {
    const lo = num(w?.temperature_min_c), hi = num(w?.temperature_max_c);
    return Number.isFinite(lo) && Number.isFinite(hi) && hi > lo ? clamp(((n - lo) / (hi - lo)) * 100) : null;
  }
  return null;
}

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
