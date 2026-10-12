import { useEffect, useMemo } from "react";

const COLORS = ["#2F855A", "#174D35", "#F2C14E", "#E8B23A", "#7BC48F"];
const DURATION = { login: 850, register: 1000 };
const COUNT = { login: 18, register: 30 };

/**
 * A short "phataka" confetti burst in forest green and harvest gold (CSS only, no package).
 * It is started only by a confirmed login or registration, never by a page load, so refreshing
 * the dashboard does not replay it. Decorative and click-through; not rendered at all when the
 * user prefers reduced motion (the toast's static check mark is the success signal then).
 */
export default function Celebration({ kind = "login", onDone }) {
  const pieces = useMemo(() => Array.from({ length: COUNT[kind] || 18 }, (_, i) => {
    const angle = (i / (COUNT[kind] || 18)) * Math.PI * 2 + Math.random() * 0.4;
    const dist = (kind === "register" ? 120 : 90) + Math.random() * 70;
    return {
      dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist * 0.8 - 30,
      rot: Math.round(Math.random() * 540 - 270), delay: Math.round(Math.random() * 90),
      color: COLORS[i % COLORS.length], round: i % 3 === 0,
    };
  }), [kind]);
  const ms = DURATION[kind] || 850;

  useEffect(() => {
    const id = setTimeout(onDone, ms + 200);
    return () => clearTimeout(id);
  }, [ms, onDone]);

  return (
    <div className="celebration" aria-hidden="true" style={{ "--burst-ms": `${ms}ms` }}>
      {pieces.map((p, i) => (
        <span key={i} className={`confetti${p.round ? " is-round" : ""}`}
          style={{ "--dx": `${p.dx.toFixed(0)}px`, "--dy": `${p.dy.toFixed(0)}px`, "--rot": `${p.rot}deg`,
            "--delay": `${p.delay}ms`, background: p.color }} />
      ))}
    </div>
  );
}
