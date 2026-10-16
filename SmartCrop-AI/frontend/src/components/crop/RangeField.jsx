import { CircleAlert, Info } from "lucide-react";
import { useT } from "../../i18n/LanguageContext";
import { coverage, fmtRange, hasRange } from "../../utils/featureRanges";

/** Thin track: the part covered by crops' usual ranges is green, the typed value is a dot. Decorative; the text hint carries the numbers. */
function RangeBar({ range, value }) {
  if (!hasRange(range)) return null;
  const span = range.max - range.min || 1;
  const pos = (v) => `${Math.min(100, Math.max(0, ((v - range.min) / span) * 100))}%`;
  const has = value !== "" && value != null && !Number.isNaN(Number(value));
  return (
    <div className="range-bar" aria-hidden="true">
      {coverage(range.perCrop).map(([a, b]) => (
        <span key={a} className="range-fill" style={{ left: pos(a), width: `${Math.max(1.5, ((Math.min(b, range.max) - Math.max(a, range.min)) / span) * 100)}%` }} />
      ))}
      {has && <span className="range-dot" style={{ left: pos(Number(value)) }} />}
    </div>
  );
}

/**
 * Number input for one soil or weather value: label with a unit pill, one help line, the unit inside the input,
 * the real usual range and a mini range bar. `error` (red) blocks submit; `warn` (amber) only informs.
 */
export default function RangeField({ id, label, unit, help, range, value, step, placeholder, error, warn, onChange, onBlur }) {
  const t = useT();
  const describedBy = [help && `${id}-help`, hasRange(range) && `${id}-hint`, error && `${id}-error`, !error && warn && `${id}-warn`].filter(Boolean).join(" ");
  return (
    <div className={`field range-field${error ? " has-error" : ""}`}>
      <label htmlFor={id}>
        {label}<span className="field-req" aria-hidden="true"> *</span>
        {unit && <span className="unit-pill">{unit}</span>}
      </label>
      {help && <span className="field-help" id={`${id}-help`}>{help}</span>}
      <div className="input-unit">
        <input id={id} name={id} type="number" inputMode="decimal" step={step} min={range.hardMin ?? undefined} max={range.hardMax ?? undefined} required
          value={value} placeholder={placeholder} onChange={onChange} onBlur={onBlur}
          onWheel={(e) => e.currentTarget.blur()} aria-invalid={error ? true : undefined} aria-describedby={describedBy} />
        {unit && <span className="input-unit-text" aria-hidden="true">{unit}</span>}
      </div>
      <RangeBar range={range} value={value} />
      {hasRange(range) && <span className="hint" id={`${id}-hint`}>{t("crop.form.typical", { range: fmtRange(range.min, range.max) })}</span>}
      {error && <span className="error" id={`${id}-error`}><CircleAlert size={14} aria-hidden="true" />{error}</span>}
      {!error && warn && <span className="warn-hint" id={`${id}-warn`}><Info size={14} aria-hidden="true" />{warn}</span>}
    </div>
  );
}
