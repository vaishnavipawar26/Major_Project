import { useT } from "../i18n/LanguageContext";

/** Horizontal 0-100 magnitude bar (single sequential hue); value text is always shown. */
export default function ScoreBar({ label, value, note }) {
  const t = useT();
  const unavailable = value == null;
  return (
    <div className="score">
      <div className="score-head">
        <span>{label}</span>
        <strong className="num">{unavailable ? t("score.notAvailable") : t("score.outOf100", { n: Math.round(value) })}</strong>
      </div>
      <div className="score-track" aria-hidden="true">
        {!unavailable && <div className="score-fill" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />}
      </div>
      {note && <span className="muted small">{note}</span>}
    </div>
  );
}
