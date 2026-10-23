// "Why this crop?" in at most three short reasons, built only from the API's numbers for the chosen crop:
//   - soil and weather reasons compare the farmer's values with the crop's usual ranges (range_fit evidence),
//   - the third reason is timing or profit, whichever matters more for this crop and plan,
//   - `modelNotes` are the crop-matching model's own SHAP contributions, kept apart because they explain that model
//     only, not the timing and profit parts of the final ranking.
// Nothing here is invented: a missing range, forecast or SHAP value simply leaves that sentence out.
import { SOIL, WEATHER, harvestSpan, indicatorRows, reliabilityOf } from "./cropPlan";
import { cropName, monthLabel, monthLong, rupees } from "./format";

const MAX_REASONS = 3;
const MAX_NOTES = 3;
const MIN_SHARE = 5;   // a model note needs at least this share (%) of the model's total absolute SHAP
const INPUT_OF = { N: "nitrogen", P: "phosphorus", K: "potassium", ph: "ph", temperature: "temperature", humidity: "humidity", rainfall: "rainfall" };
const NUMERIC = new Set([...SOIL, ...WEATHER]);
const monthNo = (ym) => Number(ym.split("-")[1]);
const rangeText = (r) => `${r.low}–${r.high}${r.unit ? ` ${r.unit}` : ""}`;

/** Importance of a row for wording: the size of the crop model's SHAP value for that feature. */
const weight = (r, shapOf) => Math.abs(shapOf[r.feature] ?? 0);

function fieldReason(kind, r, inputs, t) {
  const features = kind === "soil" ? SOIL : WEATHER;
  const crop = cropName(t, r.crop_name);
  const shapOf = Object.fromEntries(r.important_factors.map((f) => [f.feature, f.shap_value]));
  const rows = indicatorRows(r, features, inputs, t).filter((x) => x.state !== "unknown");
  if (!rows.length) return null;
  const off = rows.filter((x) => x.state === "low" || x.state === "high").sort((a, b) => weight(b, shapOf) - weight(a, shapOf));
  if (off.length) {
    const x = off[0];
    const others = off.length - 1;
    let text = t(x.state === "low" ? "cr.reason.low" : "cr.reason.high", { label: x.label, value: x.value, crop, range: rangeText(x) });
    if (others) text += ` ${t("cr.reason.alsoOff", { n: others })}`;
    if (x.feature === "rainfall" && x.state === "low") text += ` ${t("cr.reason.water")}`;
    return { key: kind, tone: "warn", text };
  }
  const first = [...rows].sort((a, b) => weight(b, shapOf) - weight(a, shapOf))[0];
  const text = kind === "soil"
    ? t("cr.reason.soilOk", { label: first.label, value: first.value, crop, range: rangeText(first), rest: rows.length > 1 ? t("cr.reason.restOk") : "" })
    : t("cr.reason.weatherOk", { list: rows.map((x) => `${x.label.toLowerCase()} ${x.value}`).join(", "), crop });
  return { key: kind, tone: "good", text: text.replace(/\s+/g, " ").trim() };
}

function timingReason(r, response, inputs, t) {
  const tl = r.timeline;
  if (!tl) return null;
  const crop = cropName(t, r.crop_name);
  const plant = monthLong(monthNo(tl.planting)), sell = monthLabel(tl.selling), harvest = harvestSpan(tl);
  const bad = tl.status === "not_ready" || tl.status === "spoiled";
  const p = { crop, plant, sell, harvest, n: tl.months_stored };
  if (bad) return { key: "timing", tone: "warn", text: `${t(tl.planting_in_window ? "cr.reason.timingIn" : "cr.reason.timingOut", p)} ${t(`timeline.concl.${tl.status}`, { ...p, crop })}` };
  if (!tl.planting_in_window) return { key: "timing", tone: "warn", text: t("cr.reason.timingOut", p) };
  if (tl.status === "stored") return { key: "timing", tone: "warn", text: `${t("cr.reason.timingIn", p)} ${t("cr.reason.stored", p)}` };
  return { key: "timing", tone: "good", text: t("cr.reason.timingFresh", p) };
}

function profitReason(r, response, t) {
  const e = r.economics;
  if (!e) return null;
  const crop = cropName(t, r.crop_name);
  const month = monthLabel(response.selling_date);
  const rough = reliabilityOf(r) !== "tested" ? ` ${t("cr.pts.roughPrice")}` : "";
  if (e.net_profit <= 0) {
    return { key: "profit", tone: "warn", text: t("cr.reason.profitLoss", { crop, price: rupees(e.selling_price), month, loss: rupees(Math.abs(e.net_profit)), breakEven: rupees(e.break_even_price) }) + rough };
  }
  const p = { profit: rupees(e.net_profit), roi: Math.round(e.roi_pct), price: rupees(e.selling_price), month, rank: r.profit_rank };
  let text;
  if (r.profit_rank === 1) text = t("cr.reason.profitTop", p);
  else {
    text = t("cr.reason.profitPos", p);
    const top = r.rank === 1 && response.highest_profit && response.highest_profit !== r.crop_name ? response.highest_profit : null;
    if (top) text += ` ${t("cr.reason.otherEarnsMore", { top: cropName(t, top), crop })}`;
  }
  return { key: "profit", tone: "good", text: text + rough };
}

/** SHAP notes: the crop model's biggest pushes for (or against) this crop, each with the farmer's value and, for numbers, the usual range. */
export function modelNotes(r, inputs, t) {
  const crop = cropName(t, r.crop_name);
  return [...r.important_factors]
    .filter((f) => Number.isFinite(f.shap_value) && Math.abs(f.share_pct) >= MIN_SHARE && !(f.feature === "soil_type" && /not specified/i.test(f.value)))
    .sort((a, b) => Math.abs(b.shap_value) - Math.abs(a.shap_value))
    .slice(0, MAX_NOTES)
    .map((f) => {
      const label = NUMERIC.has(f.feature) ? t(`feature.${f.feature}`) : f.label;
      // where the value sits against the crop's usual range (agronomic evidence) is told separately from the SHAP direction
      let where = t("cr.reason.whereNone", { crop });
      const n = Number(inputs[INPUT_OF[f.feature]]);
      if (NUMERIC.has(f.feature) && f.typical_low != null && f.typical_high != null && Number.isFinite(n)) {
        const range = `${f.typical_low}–${f.typical_high}${f.unit ? ` ${f.unit}` : ""}`;
        where = t(n < f.typical_low ? "cr.reason.whereLow" : n > f.typical_high ? "cr.reason.whereHigh" : "cr.reason.whereIn", { crop, range });
      }
      const supports = f.shap_value > 0;
      return { feature: f.feature, supports, text: t(supports ? "cr.reason.modelFor" : "cr.reason.modelAgainst", { label, value: f.value, crop, where }) };
    });
}

/** Picks the third reason: an unfavourable timing or loss first (never hidden), else the larger weighted score part. */
function pickThird(r, timing, profit) {
  if (timing?.tone === "warn") return timing;
  if (profit?.tone === "warn") return profit;
  if (!timing) return profit;
  if (!profit) return timing;
  return (r.score_points?.profit ?? 0) >= (r.score_points?.timing ?? 0) ? profit : timing;
}

/** { reasons: [{key, tone: "good"|"warn", text}] (max 3), modelNotes: [...] } for one crop result. */
export function whyReasons(r, response, inputs, t) {
  const soil = fieldReason("soil", r, inputs, t);
  const weather = fieldReason("weather", r, inputs, t);
  const third = pickThird(r, timingReason(r, response, inputs, t), profitReason(r, response, t));
  return { reasons: [soil, weather, third].filter(Boolean).slice(0, MAX_REASONS), modelNotes: modelNotes(r, inputs, t) };
}
