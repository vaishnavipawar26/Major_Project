// The storage choices the API offers for a crop (window.storage, built from backend/app/ml/price_prediction/crop_storage.py).
// One plan per storage facility and produce condition, each with its own comparison on the SAME daily forecast, so the chart and the
// selling card always read one dataset. Older saved responses have no `storage` block: callers then fall back to window.comparison.

export const planKey = (facility, profile) => `${facility}:${profile}`;

/** The plan for `key`, else the API's default (ordinary farm storage), else null when the response has no storage block. */
export function activePlan(win, key) {
  const st = win?.storage;
  if (!st?.plans) return null;
  return st.plans[key] || st.plans[st.default] || null;
}

/** The comparison to show: the chosen plan's, else the window's own. */
export const activeComparison = (win, key) => activePlan(win, key)?.comparison ?? win?.comparison ?? null;
