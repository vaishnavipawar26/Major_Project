import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useNarrow } from "../../hooks/useNarrow";
import { useT } from "../../i18n/LanguageContext";
import { barRows, explanationOk, fmtNum } from "./factorModel";

const GREEN = "#1f7a45";
const RED = "#c43f2f";

/** Factors left to right: the ones pushing the price up first (tallest first), then the ones pushing it down, "Other" last. */
export function orderRows(rows) {
  const main = rows.filter((r) => r.key !== "other").sort((a, b) => b.value - a.value);
  return [...main, ...rows.filter((r) => r.key === "other")];
}

/** Axis ticks in even steps that always include 0, so the zero line is labelled. */
export function axisTicks(bottom, top) {
  const want = (top - bottom) / 5;
  const step = [0.005, 0.01, 0.02, 0.025, 0.05, 0.1, 0.2].find((s) => s >= want) ?? 0.2;
  const ticks = [];
  for (let v = Math.ceil(bottom / step) * step; v <= top + 1e-9; v += step) ticks.push(Math.round(v / step) * step);
  return ticks;
}

/** X-axis label split into at most two lines so neighbouring names never overlap. */
function Tick({ x, y, payload, narrow }) {
  const words = String(payload.value).split(" ");
  const mid = Math.ceil(words.length / 2);
  const lines = words.length > 1 ? [words.slice(0, mid).join(" "), words.slice(mid).join(" ")] : words;
  return (
    <text x={x} y={y + 12} textAnchor="middle" fontSize={narrow ? 10.5 : 12.5} fontWeight={600} fill="var(--text)">
      {lines.map((l, i) => <tspan key={i} x={x} dy={i === 0 ? 0 : 14}>{l}</tspan>)}
    </text>
  );
}

/** A rounded, pill-shaped bar. Direction comes from the value, so it never depends on how the chart reports the box. */
function Pill({ x, y, width, height, fill }) {
  if (!height) return null;
  const top = Math.min(y, y + height), h = Math.abs(height);
  const r = Math.min(width / 2, h / 2, 12);
  return <rect x={x} y={top} width={width} height={h} rx={r} ry={r} fill={fill} />;
}

function Tip({ active, payload, t }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tooltip" style={{ maxWidth: 260 }}>
      <strong>{d.title}</strong><br />
      {t("fb.value")}: <span style={{ color: d.value >= 0 ? GREEN : RED, fontWeight: 700 }}>{fmtNum(d.value, 4)}</span><br />
      <span className="muted small">{t(d.value >= 0 ? "fb.raises" : "fb.lowers")}. {d.help}</span>
    </div>
  );
}

/**
 * Graph 2 "What Affects Your Crop Price?": one vertical bar per factor, factors along the bottom, the model's own SHAP contribution for
 * this prediction up the side (the model's output units, not rupees or percent). A bold zero line splits the chart: green bars rise above
 * it (they push the price up), red bars hang below it (they push it down). Only factors the production model uses appear.
 * History-only crops and explanations that do not add up show a short message instead.
 */
export default function FactorBars({ exp, ctxOnly, crop }) {
  const t = useT();
  const narrow = useNarrow();
  if (!exp) return <p className="muted small" data-testid="fb-unavailable">{t("fb.unavailable")}</p>;
  if (!explanationOk(exp, ctxOnly)) {
    return <p className="muted small" data-testid="fb-unavailable">{t(ctxOnly || exp.v3?.context_only ? "fb.notShown" : "fb.unavailable", { crop })}</p>;
  }
  const rows = orderRows(barRows(exp.charts.local, narrow ? 5 : 6));
  const lo = Math.min(0, ...rows.map((r) => r.value)), hi = Math.max(0, ...rows.map((r) => r.value));
  const pad = (hi - lo || 0.02) * 0.1;
  const yTop = hi > 0 ? hi + pad : pad, yBottom = lo < 0 ? lo - pad : -pad;   // both sides always exist, so the zero line sits inside the chart
  return (
    <div data-testid="factor-bars">
      <div style={{ width: "100%", height: narrow ? 250 : 270 }} role="img" aria-label={t("fb.title")}>
        <ResponsiveContainer>
          <BarChart data={rows} margin={{ top: 6, right: 6, bottom: 4, left: 0 }} barCategoryGap="26%">
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="label" interval={0} tickLine={false} axisLine={false} height={40} tick={<Tick narrow={narrow} />} />
            <YAxis domain={[yBottom, yTop]} allowDataOverflow width={narrow ? 40 : 46} ticks={axisTicks(yBottom, yTop)} interval={0} tickLine={false} axisLine={false}
              tickFormatter={(v) => (Math.abs(v) < 1e-9 ? "0" : fmtNum(v, 2))} tick={{ fill: "var(--muted)", fontSize: 11.5 }} />
            <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} content={<Tip t={t} />} />
            <ReferenceLine y={0} stroke="#1f2d24" strokeWidth={1.75} ifOverflow="visible" />
            <Bar dataKey="value" maxBarSize={narrow ? 30 : 46} isAnimationActive={false} shape={<Pill />}>
              {rows.map((r) => <Cell key={r.key} fill={r.value >= 0 ? GREEN : RED} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="legend" style={{ gap: narrow ? "0.6rem" : "1.4rem", margin: "6px 0 0", fontSize: narrow ? "0.76rem" : "0.95rem", flexWrap: "nowrap", whiteSpace: "nowrap" }} data-testid="fb-legend">
        <span><span style={{ width: 13, height: 13, borderRadius: "50%", background: GREEN, display: "inline-block" }} />{t("fb.raises")}</span>
        <span><span style={{ width: 13, height: 13, borderRadius: "50%", background: RED, display: "inline-block" }} />{t("fb.lowers")}</span>
      </div>
    </div>
  );
}
