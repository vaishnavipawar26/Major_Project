// Ranges for the "Compare crops" form. Every number comes from GET /api/crop-recommendation/feature-ranges, which reads
// the dataset min/max from the trained model's feature_ranges.json. Nothing is hard-coded here: until the request
// succeeds (or if it fails) the ranges are empty (all null), so no hint, limit or out-of-range note is shown.
// Form field key -> feature name used by the model and the API.
export const FEATURE_OF = { nitrogen: "N", phosphorus: "P", potassium: "K", ph: "ph", temperature: "temperature", humidity: "humidity", rainfall: "rainfall" };

const EMPTY = { min: null, max: null, hardMin: null, hardMax: null, perCrop: {}, live: false };
export const hasRange = (r) => Number.isFinite(r?.min) && Number.isFinite(r?.max);

/**
 * Per field key: { min, max, hardMin, hardMax, perCrop } from the API response, or EMPTY when it is missing.
 * min/max = the training dataset's range (outside it only a soft note is shown); hardMin/hardMax = what the API accepts.
 */
export function buildRanges(api) {
  return Object.fromEntries(Object.entries(FEATURE_OF).map(([key, feature]) => {
    const r = api?.[feature];
    if (r && Number.isFinite(r.min) && Number.isFinite(r.max) && r.perCrop) {
      return [key, { min: r.min, max: r.max, hardMin: r.hardMin ?? null, hardMax: r.hardMax ?? null, perCrop: r.perCrop, live: true }];
    }
    return [key, EMPTY];
  }));
}

const clean = (v) => Number(Number(v).toFixed(2));
/** Short text for a range, e.g. "6.4–7.5". */
export const fmtRange = (lo, hi) => `${clean(lo)}–${clean(hi)}`;

/** Union of the crops' usual ranges as [lo, hi] pieces (merged), for shading the mini bar. */
export function coverage(perCrop) {
  const spans = Object.values(perCrop).map(([a, b]) => [a, b]).sort((x, y) => x[0] - y[0]);
  const out = [];
  spans.forEach(([a, b]) => {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]);
  });
  return out;
}

/** Crops whose usual range contains `value`. */
export const cropsFitting = (value, perCrop) => Object.entries(perCrop).filter(([, [a, b]]) => value >= a && value <= b).map(([c]) => c);

/**
 * "ok" | "required" | "invalid" | "outside" for one typed value. `invalid` = outside what the API accepts (blocks submit);
 * `outside` = inside those limits but outside the training dataset's min/max, so the model extrapolates (soft note, never blocks).
 */
export function fieldStatus(raw, range) {
  if (raw === "" || raw == null) return { state: "required" };
  const n = Number(raw);
  if (Number.isNaN(n) || (range.hardMin != null && n < range.hardMin) || (range.hardMax != null && n > range.hardMax)) return { state: "invalid" };
  if (hasRange(range) && (n < range.min || n > range.max)) return { state: "outside" };
  return { state: "ok" };
}

/**
 * Preview of the crops that suit the typed soil and weather values: how many of the 7 values fall inside each
 * crop's usual range (the same test the result page uses). Crops matching at least 6 of 7 are listed, best first.
 * Returns null until every value is a valid number.
 */
export function likelyFits(form, ranges, max = 3) {
  const keys = Object.keys(FEATURE_OF);
  const values = {};
  for (const k of keys) {
    const raw = form[k];
    const n = Number(raw);
    if (raw === "" || Number.isNaN(n) || fieldStatus(raw, ranges[k]).state === "invalid") return null;
    values[k] = n;
  }
  const crops = Object.keys(ranges[keys[0]].perCrop).filter(Boolean);
  if (!crops.length) return null;
  return crops
    .map((crop) => ({ crop, count: keys.filter((k) => { const r = ranges[k].perCrop[crop]; return values[k] >= r[0] && values[k] <= r[1]; }).length }))
    .filter((c) => c.count >= 6)
    .sort((a, b) => b.count - a.count || a.crop.localeCompare(b.crop))
    .slice(0, max);
}
