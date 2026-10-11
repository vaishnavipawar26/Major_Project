/** Horizontal 0-100 magnitude bar (single sequential hue); value text is always shown. */
export default function ScoreBar({ label, value, note }) {
  const unavailable = value == null;
  return (
    <div className="score">
      <div className="score-head">
        <span>{label}</span>
        <strong className="num">{unavailable ? "Not available" : `${Math.round(value)} / 100`}</strong>
      </div>
      <div className="score-track" aria-hidden="true">
        {!unavailable && <div className="score-fill" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />}
      </div>
      {note && <span className="muted small">{note}</span>}
    </div>
  );
}
