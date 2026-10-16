// Ranges for the "Compare crops" form. The real numbers come from GET /api/crop-recommendation/feature-ranges
// (computed from the training data); FALLBACK is only used if that request fails.
// Form field key -> feature name used by the model and the API.
export const FEATURE_OF = { nitrogen: "N", phosphorus: "P", potassium: "K", ph: "ph", temperature: "temperature", humidity: "humidity", rainfall: "rainfall" };

// Previous hard-coded values: min/max = what the API accepts, usual = range of the whole dataset.
export const FALLBACK = {
  nitrogen: { min: 0, max: 300, usual: [0, 140] },
  phosphorus: { min: 0, max: 300, usual: [5, 145] },
  potassium: { min: 0, max: 400, usual: [5, 205] },
  ph: { min: 0, max: 14, usual: [3.5, 9.9] },
  temperature: { min: -10, max: 55, usual: [8.8, 43.7] },
  humidity: { min: 0, max: 100, usual: [14, 100] },
  rainfall: { min: 0, max: 3000, usual: [20, 299] },
};

/** Per field key: { min, max, perCrop } from the API response, or the fallback (no per-crop data) when it is missing. */
export function buildRanges(api) {
  return Object.fromEntries(Object.entries(FEATURE_OF).map(([key, feature]) => {
    const r = api?.[feature];
    if (r && Number.isFinite(r.min) && Number.isFinite(r.max) && r.perCrop) return [key, { min: r.min, max: r.max, perCrop: r.perCrop, live: true }];
    const fb = FALLBACK[key];
    return [key, { min: fb.min, max: fb.max, perCrop: { "": fb.usual }, live: false }];
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
 * "ok" | "required" | "invalid" | "outside" (inside the hard limits but outside the usual range of most crops)
 * for one typed value. `outside` only warns; it never blocks.
 */
export function fieldStatus(raw, range) {
  if (raw === "" || raw == null) return { state: "required" };
  const n = Number(raw);
  if (Number.isNaN(n) || n < range.min || n > range.max) return { state: "invalid" };
  const crops = Object.keys(range.perCrop).filter(Boolean);
  if (crops.length && cropsFitting(n, range.perCrop).length * 2 < crops.length) return { state: "outside" };
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
    if (raw === "" || Number.isNaN(n) || n < ranges[k].min || n > ranges[k].max) return null;
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
