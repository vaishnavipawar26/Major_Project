import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "../services/api";
import { weatherService } from "../services/weatherService";

const DEBOUNCE_MS = 500;
const IDLE = { state: "idle", data: null, error: null };

/**
 * Fetches the growing-period weather once city, planting month and selling month are set (debounced 500 ms).
 * Returns { state: idle | loading | ok | error, data, error, retry }. While `enabled` is false nothing is fetched
 * and the last result is kept. Older requests are cancelled so a slow answer can never overwrite a newer one.
 */
export function useWeather({ city, state, plantMonth, sellMonth, enabled = true }) {
  const [result, setResult] = useState(IDLE);
  const [attempt, setAttempt] = useState(0);
  const ready = Boolean(city && state && plantMonth && sellMonth);

  useEffect(() => {
    if (!enabled) return undefined;
    if (!ready) { setResult(IDLE); return undefined; }
    setResult({ state: "loading", data: null, error: null });
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      weatherService.growingPeriod({ city, state, plantMonth, sellMonth }, ctrl.signal)
        .then((data) => setResult({ state: "ok", data, error: null }))
        .catch((e) => { if (!ctrl.signal.aborted) setResult({ state: "error", data: null, error: errorMessage(e) }); });
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [enabled, ready, city, state, plantMonth, sellMonth, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...result, retry, ready };
}
