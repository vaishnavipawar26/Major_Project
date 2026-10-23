/** Helpers for the optional "Budget & priorities" card of the crop form. Nothing here changes the standard recommendation. */
import { rupees } from "./format";

export const BUDGET_MAX = 1_000_000_000;
export const DEFAULT_PRIORITY = "balanced";
export const DEFAULT_RISK = "medium";
export const PRIORITIES = ["spend_less", "balanced", "highest_profit"];
export const RISKS = ["low", "medium", "high"];

/** What the farmer typed, without commas, spaces or the rupee sign. */
export const cleanBudget = (text) => String(text ?? "").replace(/[,\s₹]/g, "");

/** Indian digit grouping while the text is a plain whole number (40000 -> 40,000; 500000 -> 5,00,000); anything else is shown as typed. */
export const formatBudget = (raw) => (/^\d+$/.test(raw) ? Number(raw).toLocaleString("en-IN") : raw);

/** Error key (translated by the form) for a budget, or null. Empty is fine: the card is optional. */
export function budgetError(raw) {
  if (raw === "") return null;
  const n = Number(raw);
  if (!/^-?\d+(\.\d+)?$/.test(raw) || Number.isNaN(n)) return "crop.form.budgetErrNumber";
  if (n <= 0) return "crop.form.budgetErrPositive";
  return n > BUDGET_MAX ? "crop.form.budgetErrMax" : null;
}

/** The planting year the backend uses: the next occurrence of the planting month (this month counts as now). */
export const plantingYear = (plantMonth, today = new Date()) => (plantMonth >= today.getMonth() + 1 ? today.getFullYear() : today.getFullYear() + 1);

/**
 * Cultivation cost of the cheapest and dearest crop for this field, from the API's own per-acre costs (options.economics) inflated
 * to the planting year with its own yearly rate. Returns null until the options are loaded.
 */
export function costRange(economics, inflationPct, plantMonth, areaAcres, today = new Date()) {
  const rows = Object.values(economics || {});
  const area = Number(areaAcres);
  if (!rows.length || !(area > 0)) return null;
  const year = plantingYear(plantMonth, today);
  const costs = rows.map((e) => e.cost_per_acre_inr * (1 + (inflationPct ?? 0) / 100) ** Math.max(0, year - e.cost_reference_year) * area);
  return { low: Math.min(...costs), high: Math.max(...costs) };
}

/** Round to the nearest 1,000 for the helper text ("about"). */
export const roundK = (v) => Math.round(v / 1000) * 1000;
export const rangeText = (r) => `${rupees(roundK(r.low))}–${rupees(roundK(r.high))}`;

/**
 * The plan fields to send. Nothing (so the request is exactly today's) unless the farmer entered a budget or changed a priority or risk
 * choice away from its default.
 */
export function planPayload({ budget_inr, priority, risk_level }) {
  const entered = budget_inr !== "";
  if (!entered && priority === DEFAULT_PRIORITY && risk_level === DEFAULT_RISK) return {};
  return { ...(entered ? { budget_inr: Number(budget_inr) } : {}), priority, risk_level };
}
