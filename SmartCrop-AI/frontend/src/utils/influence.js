// "What influences your crop recommendation?" — built only from numbers the API already returns.
//
// The crop ranking is Overall = 0.20 Location + 0.20 Planting + 0.10 Selling + 0.15 Soil + 0.15 Weather + 0.20 Profit (the weights come
// from the API). Location is half growing-belt share and half the city's own climate over the growing months; soil is N, P, K and pH
// inside the crop's usual range; weather is temperature, humidity and rainfall inside it; profit is the adjusted profit score. Every term
// is already in weighted score points (`score_points`), so the points the selected crop gains or loses against its closest eligible rival,
// factor by factor, add up to the score gap. Each bar is the points the crop earns on that factor out of the points it could earn; the
// "strongest influence" is the factor with the biggest advantage over the rival. SHAP values and the classifier probability are not part
// of the final ranking, so they are not shown as numbers (the tooltip only says how the AI model leaned).
import { monthLabel, monthLong, rupees, signedRupees } from "./format";

export const TIE = 0.05;          // score-point differences below this are a tie
const RANGE_KEYS = ["N", "P", "K", "ph", "temperature", "humidity", "rainfall"];
const SOIL_GROUP = new Set(["N", "P", "K", "ph"]);
const INPUT_OF = { N: "nitrogen", P: "phosphorus", K: "potassium" };
const SOIL_KEYS = ["N", "P", "K", "ph"], WEATHER_KEYS = ["temperature", "humidity", "rainfall"];
const num = (v, d = 1) => Number(v).toFixed(d);
const factorOf = (r, f) => r.important_factors?.find((x) => x.feature === f);
const MATERIAL_SHARE = 8;     // % of the model's total effect below which a factor counts as "little effect" for the model
// the project shows rainfall as mm per month; the API only says "mm"
const unitOf = (k, unit) => (k === "rainfall" ? "mm/month" : unit);
const rangeText = (fa, k = fa.feature) => `${fa.typical_low}–${fa.typical_high}${unitOf(k, fa.unit) ? ` ${unitOf(k, fa.unit)}` : ""}`;
const valueText = (fa) => (fa.feature === "rainfall" ? fa.value.replace(/ mm$/, " mm/month") : fa.value);

/** The crop to compare with: the best other eligible crop (or the winner, when explaining a lower-ranked crop). */
export function rivalOf(sel, results) {
  const others = results.filter((r) => r.crop_name !== sel.crop_name);
  if (sel.rank === 1) return others.find((r) => r.eligible) || others.find((r) => r.rank === 2) || null;
  return others.find((r) => r.rank === 1) || null;
}

/** Whether the response carries everything this page reads. */
export const canInfluence = (sel, response) => !!(sel?.important_factors?.length && sel.range_fit?.soil?.items && sel.location
  && sel.score_points?.location != null && sel.planting_fit_score != null && sel.selling_fit_score != null && response?.weights?.location != null);

/** Weighted points per ranking factor for one crop, straight from the API's score parts (soil and weather split evenly over their values). */
export function factorPoints(r, w) {
  const { soil, weather } = r.score_points;
  const out = {
    location: r.score_points.location, planting: r.score_points.planting, timing: r.score_points.selling, profit: r.score_points.profit,
  };
  for (const k of SOIL_KEYS) out[k] = r.range_fit.soil.items[k] ? soil / Math.max(1, SOIL_KEYS.filter((x) => r.range_fit.soil.items[x]).length) : 0;
  for (const k of WEATHER_KEYS) out[k] = r.range_fit.weather.items[k] ? weather / Math.max(1, WEATHER_KEYS.filter((x) => r.range_fit.weather.items[x]).length) : 0;
  return out;
}

/** Weighted score points the selected crop gains (+) or loses (−) against the rival, one entry per ranking factor. */
export function rankingFactors(sel, ref, w) {
  const a = factorPoints(sel, w), b = factorPoints(ref, w);
  const max = { location: w.location * 100, planting: w.planting * 100, timing: w.selling * 100, profit: w.profit * 100 };
  for (const k of SOIL_KEYS) max[k] = (w.soil * 100) / SOIL_KEYS.length;
  for (const k of WEATHER_KEYS) max[k] = (w.weather * 100) / WEATHER_KEYS.length;
  return ["location", "planting", "timing", ...RANGE_KEYS, "profit"].map((key) => ({ key, own: a[key], rival: b[key], max: max[key], pts: a[key] - b[key] }));
}

/** Everything the page shows. Returns null when the response is too old to explain. */
export function buildInfluence(sel, response, inputs, t, cropLabel = (c) => c) {
  if (!canInfluence(sel, response)) return null;
  const crop = cropLabel(sel.crop_name);
  const isBest = sel.rank === 1;
  const ref = rivalOf(sel, response.results);
  const refName = ref ? cropLabel(ref.crop_name) : null;
  const name = (k) => t(`cr.inf.f.${k}`);
  const lower = (k) => t(`cr.inf.l.${k}`);
  const econ = sel.economics;
  const tl = sel.timeline || {};
  const w = response.weights;
  const loc = sel.location;
  const city = response.city;
  const nIn = Object.values(loc.climate.items).filter(Boolean).length, nClim = Object.keys(loc.climate.items).length;

  const valueOf = (k) => {
    if (k === "location") return city;
    if (k === "profit") return econ ? signedRupees(econ.net_profit) : "—";
    if (k === "planting") return monthLong(response.planting_month);
    if (k === "timing") return monthLong(response.selling_month);
    const fa = factorOf(sel, k);
    return fa ? valueText(fa) : "";
  };
  // one short sentence per factor, for the tooltip
  const detail = (k) => {
    if (k === "location") return t(loc.growing_area_score >= 100 ? "cr.inf.txt.location.main" : "cr.inf.txt.location.minor",
      { city, crop, share: num(loc.growing_area_share_pct, 0), n: nIn, total: nClim });
    if (k === "profit") return econ ? t("cr.inf.txt.profit", { price: rupees(econ.selling_price), np: signedRupees(econ.net_profit), roi: num(econ.roi_pct, 0) }) : t("cr.inf.txt.profitNa");
    if (k === "planting") return t(`cr.inf.txt.planting.${sel.planting_fit_score >= 100 ? "in" : sel.planting_fit_score > 0 ? "near" : "out"}`, { month: monthLong(response.planting_month), crop });
    if (k === "timing") {
      if (tl.status === "stored") return t("cr.inf.txt.selling.stored", { month: monthLong(response.selling_month), n: tl.months_stored, crop });
      return t(`cr.inf.txt.selling.${tl.status === "fresh" ? "fresh" : tl.status === "not_ready" ? "notReady" : "spoiled"}`, { month: monthLong(response.selling_month), crop });
    }
    const fa = factorOf(sel, k);
    const v = inputs[INPUT_OF[k] || k];
    const status = v == null || fa.typical_low == null ? "unknown" : v < fa.typical_low ? "below" : v > fa.typical_high ? "above" : "within";
    return t(`cr.inf.range.${status}`, { value: valueText(fa), crop, range: rangeText(fa) });
  };

  const ranking = ref ? rankingFactors(sel, ref, w) : [];
  // how the AI model itself reacted to the factor (qualitative only: its numbers are on another scale and are not shown)
  const modelOf = (k) => {
    const fs = (k === "planting" ? ["planting_month"] : k === "timing" ? ["selling_month", "growing_months"] : k === "location" ? ["city_code"] : RANGE_KEYS.includes(k) ? [k] : [])
      .map((f) => factorOf(sel, f)).filter(Boolean);
    if (!fs.length) return null;
    const share = fs.reduce((a, f) => a + f.share_pct, 0);
    return Math.abs(share) < MATERIAL_SHARE ? "little" : share > 0 ? "for" : "against";
  };
  const harvest = tl.harvest_start ? `${monthLabel(tl.harvest_start)}${tl.harvest_end && tl.harvest_end !== tl.harvest_start ? ` – ${monthLabel(tl.harvest_end)}` : ""}` : null;
  const extras = (k) => {
    if (k === "location") {
      const c = loc.climate.values;
      return [[t("cr.inf.tip.area"), `${num(loc.growing_area_share_pct, 0)}% ${t("cr.inf.tip.areaOf", { crop })}`],
        [t("cr.inf.tip.climate"), `${nIn} / ${nClim} ${t("cr.inf.tip.inRange")}`],
        ...(c.temperature != null ? [[t("cr.inf.tip.localClimate"), `${c.temperature} °C · ${c.humidity}% · ${c.rainfall} mm/month`]] : [])];
    }
    if (k === "profit" && econ) return [[t("cr.inf.tip.price"), `${rupees(econ.selling_price)}/quintal`], [t("cr.inf.tip.cost"), rupees(econ.total_cost)], [t("cr.inf.tip.net"), signedRupees(econ.net_profit)]];
    if (k === "planting") return [[t("cr.inf.tip.sell"), monthLong(response.selling_month)]];
    if (k === "timing" && harvest) return [[t("cr.inf.tip.harvest"), harvest]];
    return [];
  };
  const bars = ranking.map((f) => {
    const ratio = f.max ? f.own / f.max : 0;
    const fa = RANGE_KEYS.includes(f.key) ? factorOf(sel, f.key) : null;
    return {
      key: f.key, short: t(`cr.inf.s.${f.key}`), name: name(f.key), input: valueOf(f.key), text: detail(f.key),
      earned: f.own, missed: Math.max(0, f.max - f.own), max: f.max, advantage: f.pts,
      status: ratio >= 0.6 ? "supports" : ratio < 0.4 ? "limits" : "mixed",
      range: fa && fa.typical_low != null ? rangeText(fa) : null, model: modelOf(f.key), extras: extras(f.key),
    };
  }).sort((a, b) => b.earned - a.earned || b.advantage - a.advantage);
  const byAdv = [...bars].sort((a, b) => b.advantage - a.advantage);
  const pos = byAdv.filter((b) => b.advantage > TIE);
  const neg = byAdv.filter((b) => b.advantage < -TIE).reverse();
  const group = isBest ? pos : neg;
  const top = group[0];
  const topTie = top ? group.filter((b) => Math.abs(Math.abs(b.advantage) - Math.abs(top.advantage)) <= TIE) : [];
  const main = topTie[0] || null;      // on a tie the first listed factor is shown and the tie is stated

  // the card explains why THIS crop suits the farm on that factor; it does not compare with another crop
  const mainText = main ? detail(main.key) : null;
  const mainCard = main && { key: main.key, name: main.name, value: main.input, text: mainText,
    influence: t("cr.inf.influence.own", { earned: num(main.earned), max: num(main.max) }),
    tie: topTie.length > 1, others: topTie.slice(1).map((b) => b.name) };

  // ---- "What supports it?" and "What needs attention?": each from the data, and only when the data supports it
  const bar = (k) => bars.find((b) => b.key === k);
  const inRange = RANGE_KEYS.filter((k) => (SOIL_GROUP.has(k) ? sel.range_fit.soil.items[k] : sel.range_fit.weather.items[k]));
  const outRange = RANGE_KEYS.filter((k) => !inRange.includes(k));
  const listed = (ks) => ks.slice(0, 3).map(lower).join(", ");
  const skip = main?.key;
  let supports = null;
  if (skip !== "location" && bar("location").earned / bar("location").max >= 0.75) supports = t("cr.inf.sup.location", { city, crop, share: num(loc.growing_area_share_pct, 0) });
  else if (skip !== "planting" && sel.planting_fit_score >= 100) supports = t("cr.inf.sup.planting", { month: monthLong(response.planting_month), crop });
  else if (inRange.length === RANGE_KEYS.length) supports = t("cr.inf.sup.all");
  else if (inRange.length >= 4) supports = t("cr.inf.sup.most", { n: inRange.length, total: RANGE_KEYS.length, list: listed(inRange) });
  else if (sel.planting_fit_score >= 100 && tl.status === "fresh") supports = t("cr.inf.sup.timing");

  // the limitation that costs the crop the most score points
  const cands = [];
  if (sel.planting_fit_score < 100) {
    const bp = bar("planting");
    cands.push({ lost: bp.missed, text: t(sel.planting_fit_score > 0 ? "cr.inf.att.plantingNear" : "cr.inf.att.plantingOut", { month: monthLong(response.planting_month), crop }) });
  }
  if (sel.selling_fit_score < 100) {
    const bt = bar("timing");
    cands.push({ lost: bt.missed, text: tl.status === "stored" ? t("cr.inf.att.stored", { n: tl.months_stored }) : t("cr.inf.att.sellingOut", { month: monthLong(response.selling_month), crop }) });
  }
  const badClimate = Object.entries(loc.climate.items).filter(([, ok]) => !ok).map(([f]) => f);
  if (badClimate.length) {
    const f = badClimate[0], fa = factorOf(sel, f), v = loc.climate.values[f];
    cands.push({ lost: bar("location").missed * (loc.growing_area_score >= 100 ? 1 : 0.5), text: t(`cr.inf.att.climate.${v < fa.typical_low ? "below" : "above"}`,
      { city, name: lower(f), value: `${v} ${unitOf(f, fa.unit)}`.trim(), range: rangeText(fa) }) });
  } else if (loc.growing_area_score < 100) {
    cands.push({ lost: bar("location").missed * 0.5, text: t("cr.inf.att.minorArea", { city, crop, share: num(loc.growing_area_share_pct, 0) }) });
  }
  for (const k of outRange) {
    const fa = factorOf(sel, k), v = inputs[INPUT_OF[k] || k];
    const span = fa.typical_high - fa.typical_low || 1, above = v > fa.typical_high;
    cands.push({ lost: bar(k).missed, text: t(`cr.inf.att.${above ? "above" : "below"}.${SOIL_GROUP.has(k) ? "soil" : "weather"}`, { name: lower(k), value: valueText(fa), range: rangeText(fa), gap: (above ? v - fa.typical_high : fa.typical_low - v) / span }) });
  }
  cands.sort((a, b) => b.lost - a.lost);
  const attention = cands[0]?.text || (econ && econ.net_profit < 0 ? t("cr.inf.att.loss") : null);

  // ---- one-sentence summary for the top card
  let summary = null;
  if (ref && isBest) {
    const parts = [];
    if (skip !== "location" && bar("location").earned / bar("location").max >= 0.75) parts.push(t("cr.inf.sum.location", { city }));
    if (skip !== "planting" && sel.planting_fit_score >= 100) parts.push(t("cr.inf.sum.planting"));
    if (inRange.length >= 5) parts.push(t("cr.inf.sum.fit"));
    const support = parts.length ? t("cr.inf.sum.supported", { list: parts.slice(0, 3).join(", ") }) : "";
    summary = main ? t("cr.inf.sum.best", { crop, factor: lower(main.key), support }) : t("cr.inf.sum.balanced", { crop, ref: refName });
  } else if (ref) summary = t(main ? "cr.inf.sum.other" : "cr.inf.sum.otherNone", { crop, rank: sel.rank, ref: refName, factor: main ? lower(main.key) : "" });

  return {
    crop, ref: refName, isBest, mainCard, bars, summary, noRival: !ref,
    points: { main: mainText, supports, attention },
    yLabel: ref ? t("cr.inf.y") : "",
  };
}
