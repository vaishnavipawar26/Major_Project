import { CloudRain, Droplets, MapPin, Pencil, RefreshCw, Thermometer, TriangleAlert } from "lucide-react";
import { useT } from "../../i18n/LanguageContext";
import { cropName } from "../../utils/format";

const ROWS = [
  { key: "temperature", icon: Thermometer, tone: "warm", unit: "°C", from: "temperature" },
  { key: "humidity", icon: Droplets, tone: "cool", unit: "%", from: "humidity" },
  { key: "rainfall", icon: CloudRain, tone: "teal", unit: "mm / month", from: "rainfall" },
];

/** Thin track for the dataset range with a dot where the value sits (amber and pinned to the end when outside). */
function TypicalBar({ value, range }) {
  const lo = range.min, hi = range.max;
  const span = hi - lo || 1;
  const raw = ((value - lo) / span) * 100;
  const outside = raw < 0 || raw > 100;
  return (
    <div className="wx-range" aria-hidden="true">
      <div className="wx-track"><span className={`wx-dot${outside ? " is-out" : ""}`} style={{ left: `${Math.min(100, Math.max(0, raw))}%` }} /></div>
      <div className="wx-range-ends"><span>{Number(lo.toFixed(2))}</span><span>{Number(hi.toFixed(2))}</span></div>
    </div>
  );
}

/**
 * The three weather values as stacked rows (icon, full label, large value with its unit), with a shimmer while loading,
 * a hint while city or months are missing, and an error state with Retry and Edit manually. `weather` is from useWeather().
 */
export default function WeatherCards({ weather, onRetry, onManual, city, ranges }) {
  const t = useT();
  const { state, data, error, ready } = weather;
  return (
    <div className="wx">
      <div className="sr-only" role="status" aria-live="polite">{ready && state === "loading" ? t("crop.form.weatherLoading") : ""}</div>
      {!ready && (
        <p className="wx-hint"><MapPin size={18} aria-hidden="true" />{t("crop.form.weatherSelect")}</p>
      )}
      {ready && state === "error" && (
        <div className="wx-error" role="alert">
          <TriangleAlert size={18} aria-hidden="true" />
          <div><strong>{t("crop.form.weatherFailed")}</strong><p>{error}</p></div>
          <div className="wx-error-actions">
            <button type="button" className="btn btn-secondary" onClick={onRetry}><RefreshCw size={15} aria-hidden="true" />{t("common.retry")}</button>
            <button type="button" className="btn btn-primary" onClick={onManual}><Pencil size={15} aria-hidden="true" />{t("crop.form.weatherEdit")}</button>
          </div>
        </div>
      )}
      {ready && state !== "error" && (
        <>
          <ul className="wx-rows" aria-busy={state === "loading"}>
            {ROWS.map(({ key, icon: Icon, tone, unit, from }) => (
              <li key={key} className={`wx-row${state === "loading" ? " is-loading" : ""}`}>
                {state === "ok" ? (
                  <>
                    <span className={`wx-icon tone-${tone}`}><Icon size={20} aria-hidden="true" /></span>
                    <span className="wx-label">{t(`crop.form.field.${key}`)}</span>
                    <strong className="wx-value num">{data[from]}<small>{cropName(t, unit, "unit")}</small></strong>
                    {Number.isFinite(ranges?.[key]?.min) && <TypicalBar value={data[from]} range={ranges[key]} />}
                  </>
                ) : (
                  <>
                    <span className="wx-icon wx-shimmer" aria-hidden="true" />
                    <span className="wx-lines" aria-hidden="true"><span className="wx-shimmer" /><span className="wx-shimmer short" /></span>
                    <span className="wx-shimmer wx-value-skel" aria-hidden="true" />
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
