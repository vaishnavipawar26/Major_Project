/** Pure helpers that arrange the backend's explanation for the explanation page (no reasoning added here). */

/** Factors the farmer sees: evidence exists and it is not an identifier-only group. */
export const shownFactors = (exp) =>
  (exp?.factors || []).filter((f) => f.evidence_available && f.factor !== "crop_market");

/** Split by the SHAP direction and strength reported by the backend. */
export function splitFactors(exp) {
  const shown = shownFactors(exp);
  return {
    higher: shown.filter((f) => f.direction === "up" && f.strength !== "small"),
    lower: shown.filter((f) => f.direction === "down" && f.strength !== "small"),
    small: shown.filter((f) => f.strength === "small"),
  };
}

/** True when an explanation response belongs to the request it is shown for. */
export function matchesRequest(req, explain) {
  if (!req || !explain) return false;
  return String(explain.series?.commodity || "").toLowerCase() === String(req.commodity || "").toLowerCase()
    && explain.target_date === req.target_date;
}

/** Measure rows in the market-data table: only evidence the backend actually measured. */
export const marketRows = (exp) =>
  shownFactors(exp).flatMap((f) => f.evidence.map((e) => ({ ...e, key: `${f.factor}-${e.label}` })));

/** The factors to show: the backend's own top picks by SHAP size (at most three), else the top three that have evidence. */
export function mainFactors(exp, limit = 3) {
  const shown = shownFactors(exp);
  const picked = Array.isArray(exp?.main_factors) ? exp.main_factors.map((k) => shown.find((f) => f.factor === k)).filter(Boolean) : shown;
  return picked.slice(0, limit);
}

/** False when there is nothing to show or the SHAP breakdown does not add up to the model output: then the page says it could not explain. */
export const isExplainedReliably = (exp) => reasonsOf(exp).length > 0 && exp?.technical?.reconstruction_ok !== false;

/** "rise" / "fall" (or "increase" / "decrease" with nouns) for the signed change; "change" when it is flat. */
export const moveWord = (changeAbs, flat, nouns = false) =>
  flat ? "change" : changeAbs > 0 ? (nouns ? "increase" : "rise") : (nouns ? "decrease" : "fall");

/**
 * The reliability facts worth showing, all from the backend's own numbers: the typical error (only with enough past
 * tests) read against the expected change, the price range, and the data-quality warnings that really apply.
 * Test count, error and range are different measurements and none is turned into a "reliable" label.
 */
export function reliabilityView(exp) {
  const r = exp.reliability, s = exp.summary;
  const mae = r?.sufficient_data && r.model_mae != null ? r.model_mae : null;
  const change = Math.abs(s.change_abs);
  const move = moveWord(s.change_abs, s.direction === "about the same", true);
  let message = null;
  if (mae != null) message = { key: change < mae ? "price.expl.relSmallerMae" : "price.expl.relLargerMae", vars: { change, mae, move } };
  else if (s.within_typical_error && s.typical_error_pct != null) message = { key: "price.expl.relMsgSmall", vars: { pct: Math.round(s.typical_error_pct) } };
  const warnings = [];
  if (exp.projected) warnings.push({ key: "price.expl.warnProjected" });
  if (r && r.beats_no_change === false) warnings.push({ key: "price.xai.relNotBetter" });
  if (r && !r.sufficient_data) warnings.push({ key: "price.expl.relInsufficient" });
  if (!r) warnings.push({ key: "price.expl.relNone" });
  const c = exp.data_completeness;
  if (c && c.inputs_missing > 0) warnings.push({ key: "price.xai.relInputsSome", vars: { missing: c.inputs_missing, total: c.inputs_total } });
  return { mae, range: exp.price_range, message, warnings, smaller: mae != null && change < mae };
}

/**
 * The reasons shown to the farmer: the backend's own `reasons` (at most three, each with measured evidence and a model
 * contribution). Saved responses from before `reasons` existed fall back to the top factors with the same fields.
 */
export function reasonsOf(exp, limit = 3) {
  if (Array.isArray(exp?.reasons)) return exp.reasons.slice(0, limit);
  return mainFactors(exp, limit).map((f) => ({ id: f.factor, title: f.title, direction: f.direction, evidence: f.observation, meaning: f.farmer_effect || f.model_says }));
}
