import { useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useNarrow } from "../../hooks/useNarrow";
import { useT } from "../../i18n/LanguageContext";
import { chartModel, isoOf, ts } from "../../utils/forecastWindow";
import { fmtDate, pct, rupees, shortDate } from "../../utils/format";
import { rangeView } from "../../utils/priceView";
import HistoricalPriceChart from "./HistoricalPriceChart";
import { priceAxis } from "./SimplePriceChart";

const ACTUAL = "var(--series-actual)";
const PREDICTED = "var(--series-forecast)";
const PLANNED = "#6b3fa0";
const BEST = "#0f7b4f";
const EXPERIMENTAL = "#8a6d3b";

function Stat({ label, value, sub, testid }) {
  return (
    <div className="pf-stat" data-testid={testid}>
      <span className="pf-stat-label">{label}</span>
      <span className="pf-stat-value">{value}</span>
      {sub && <span className="pf-stat-sub">{sub}</span>}
    </div>
  );
}

function Tip({ active, payload, t, crop, market }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  if (!r || (r.actual == null && r.predicted == null && r.experimental == null)) return null;
  const actual = r.actual != null;
  const exp = !actual && r.experimental != null && r.predicted == null;
  const status = actual ? t("pfc.tip.actual") : exp ? t("pfc.tip.experimental") : r.kind === "start" ? t("pfc.tip.start") : t("pfc.tip.forecast");
  return (
    <div className="chart-tooltip" data-testid="pf-tooltip">
      <strong>{fmtDate(r.date)}</strong><br />
      {rupees(actual ? r.actual : exp ? r.experimental : r.predicted)} {t("unit.perQuintal")}<br />
      {r.range && <><span className="muted small">{t("pfc.tip.range", { low: rupees(r.range[0]), high: rupees(r.range[1]) })}</span><br /></>}
      <span className="muted small">{crop} · {market}</span><br />
      <span className="small" style={{ color: actual ? ACTUAL : exp ? EXPERIMENTAL : PREDICTED, fontWeight: 700 }}>{status}</span>
    </div>
  );
}

function Legend({ t, showActual, showRange, hasBest, showExperimental, hasValidated }) {
  return (
    <div className="legend pf-legend" data-testid="pf-legend">
      {showActual && <span><span className="swatch-line" style={{ borderColor: ACTUAL, borderTopWidth: 3 }} />{t("pfc.legend.actual")}</span>}
      {hasValidated && <span><span className="swatch-dash" style={{ borderColor: PREDICTED, borderTopWidth: 3 }} />{t("pfc.legend.predicted")}</span>}
      {showExperimental && <span><span className="swatch-line" style={{ borderColor: EXPERIMENTAL, borderTopStyle: "dotted", borderTopWidth: 3 }} />{t("pfc.legend.experimental")}</span>}
      {showRange && <span><span className="swatch" style={{ background: PREDICTED, opacity: 0.22 }} />{t("pfc.legend.range")}</span>}
      <span><span className="pf-dot" style={{ background: PLANNED }} />{t("pfc.legend.planned")}</span>
      {hasBest && <span><span className="pf-dot pf-star" style={{ background: BEST }} />{t("pfc.legend.best")}</span>}
    </div>
  );
}

/**
 * The daily price forecast for the next 30 days: real reported prices (solid, only when recent enough to share the axis), the model's
 * validated daily predictions (dashed), the farmer's planned date and the highest predicted date. `win` is the API's `window`.
 * Days without a validated prediction are left empty; the notes below the chart say how many.
 */
export default function PriceForecastChart({ forecast, crop, market }) {
  const t = useT();
  const narrow = useNarrow();
  const [showExp, setShowExp] = useState(false);
  const win = forecast.window;
  if (!win) return <p className="muted small" data-testid="pf-unavailable">{t("pfc.unavailable")}</p>;

  const range = rangeView(forecast);
  const showRange = range.kind === "measured" || range.kind === "unmeasured";
  const model = chartModel(win, forecast.observed, { showRange, showExperimental: showExp });
  const hasExperimental = win.entries.some((e) => e.status === "not_validated" && Number.isFinite(e.predicted_price));
  const experimentalRows = model.rows.filter((r) => r.experimental != null);
  const predicted = model.rows.filter((r) => r.predicted != null && r.kind !== "start");
  const planned = win.planned.in_window && win.planned.status === "validated" ? win.planned : null;
    const peak = win.highest;

  const toggle = hasExperimental && (
    <label className="pf-exp-toggle" data-testid="pf-exp-toggle">
      <input type="checkbox" checked={showExp} onChange={(e) => setShowExp(e.target.checked)} />
      <span>{t("pfc.exp.toggle")}</span>
    </label>
  );
  const expWarning = showExp && experimentalRows.length > 0 && <p className="pf-exp-warn" data-testid="pf-exp-warn">{t("pfc.exp.warn", { reason: win.validation?.reasons?.[0] || "" })}</p>;

  if (!predicted.length && !(showExp && experimentalRows.length)) {
    const v = win.validation || {};
    return (
      <div data-testid="pf-chart">
        <p className="pf-none" data-testid="pf-none"><strong>{t("pfc.none.title", { crop, market })}</strong> {t(v.mode === "context_only" ? "pfc.none.policy" : "pfc.none.generic", { crop })}</p>
        {v.reasons?.[0] && <p className="muted small" data-testid="pf-none-reason">{v.reasons[0]}</p>}
        <HistoricalPriceChart observed={forecast.observed} crop={crop} market={market} />
        {!model.latestActual && <p className="muted small">{t("pfc.noActual")}</p>}
        {toggle}
      </div>
    );
  }

  const ys = model.rows.flatMap((r) => [r.actual, r.predicted, r.experimental]).filter((v) => v != null);
  const { domain: yDomain, ticks: yTicks } = priceAxis(Math.min(...ys), Math.max(...ys));
  const [x0, x1] = model.domain;
  const change = win.change;
  const startTs = ts(win.start_date);
  const tickLabel = (v) => shortDate(isoOf(v));
  const sameDay = planned && peak && planned.date === peak.date;
  const rangeText = showRange && planned?.lower != null
    ? t(range.kind === "measured" ? "pfc.rangeMeasured" : "pfc.rangeUnmeasured", { low: rupees(planned.lower), high: rupees(planned.upper), pct: range.pct })
    : null;

  return (
    <div data-testid="pf-chart">
      <div className="pf-stats">
        <Stat testid="pf-start" label={t("pfc.stat.start")} value={win.reference_price != null ? rupees(win.reference_price) : "—"}
          sub={win.reference_date ? fmtDate(win.reference_date) : null} />
        <Stat testid="pf-planned" label={t("pfc.stat.planned")} value={win.planned.price != null ? rupees(win.planned.price) : "—"}
          sub={fmtDate(win.planned.date)} />
        <Stat testid="pf-high" label={t("pfc.stat.high")} value={peak ? rupees(peak.price) : "—"} sub={peak ? fmtDate(peak.date) : null} />
        <Stat testid="pf-change" label={t("pfc.stat.change")} value={change ? pct(change.pct, 1) : "—"}
          sub={change ? t(change.is_window_end ? "pfc.stat.changeTo" : "pfc.stat.changeToLast", { date: shortDate(change.to_date) }) : null} />
      </div>
      <p className="pf-axis-note muted small">{t("pfc.axisNote")}</p>

      <div style={{ width: "100%", height: narrow ? 260 : 340 }} role="img" aria-label={t("pfc.title")}>
        <ResponsiveContainer>
          <ComposedChart data={model.rows} margin={{ top: 30, right: narrow ? 14 : 24, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="t" type="number" scale="time" domain={[x0, x1]} ticks={model.ticks} interval={0} tickLine={false}
              tickFormatter={tickLabel} stroke="var(--axis)" tick={{ fill: "var(--muted)", fontSize: narrow ? 11 : 12.5 }} height={26} />
            <YAxis domain={yDomain} ticks={yTicks} interval={0} allowDataOverflow width={narrow ? 56 : 64} tickLine={false} axisLine={false}
              tickFormatter={(v) => rupees(v)} tick={{ fill: "var(--muted)", fontSize: narrow ? 11 : 12.5 }} />
            <Tooltip content={<Tip t={t} crop={crop} market={market} />} />
            {model.showActual && model.firstActual != null && (
              <ReferenceArea x1={model.firstActual} x2={startTs} fill="var(--grid)" fillOpacity={0.45} strokeOpacity={0}
                label={narrow ? undefined : { value: t("pfc.area.history"), position: "insideTopLeft", fill: "var(--muted)", fontSize: 11 }} />
            )}
            <ReferenceLine x={startTs} stroke="var(--axis)" strokeDasharray="4 3"
              label={{ value: t("pfc.area.start"), position: model.showActual ? "insideTopRight" : "insideTopLeft", fill: "var(--muted)", fontSize: 11 }} />
            {showRange && <Area dataKey="range" stroke="none" fill={PREDICTED} fillOpacity={0.16} connectNulls={false} isAnimationActive={false} activeDot={false} />}
            <Line dataKey="actual" stroke={ACTUAL} strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
            {showExp && <Line dataKey="experimental" stroke={EXPERIMENTAL} strokeWidth={2} strokeDasharray="2 4" dot={false} connectNulls={false} isAnimationActive={false} />}
            <Line dataKey="predicted" stroke={PREDICTED} strokeWidth={2.5} strokeDasharray="7 4" dot={false} connectNulls={false} isAnimationActive={false} />
            <Line dataKey="ref" stroke="none" dot={{ r: 4.5, fill: "#fff", stroke: PREDICTED, strokeWidth: 2.5 }} activeDot={false} isAnimationActive={false} />
            {peak && !sameDay && (
              <ReferenceDot x={ts(peak.date)} y={peak.price} r={8} fill={BEST} stroke="#fff" strokeWidth={2.5} ifOverflow="visible"
                label={{ value: `${t("pfc.mark.best")} ${shortDate(peak.date)}`, position: "top", fill: BEST, fontSize: narrow ? 11 : 12.5, fontWeight: 700 }} />
            )}
            {planned && (
              <ReferenceDot x={ts(planned.date)} y={planned.price} r={8} fill={PLANNED} stroke="#fff" strokeWidth={2.5} ifOverflow="visible"
                label={{ value: `${t(sameDay ? "pfc.mark.plannedBest" : "pfc.mark.planned")} ${shortDate(planned.date)}`, position: sameDay ? "top" : "bottom",
                  fill: PLANNED, fontSize: narrow ? 11 : 12.5, fontWeight: 700 }} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <Legend t={t} showActual={model.showActual} showRange={showRange} hasBest={Boolean(peak)} showExperimental={showExp && experimentalRows.length > 0} hasValidated={predicted.length > 0} />
      {toggle}
      {expWarning}

      <div className="muted small pf-notes" data-testid="pf-notes">
        {rangeText && <p data-testid="pf-range">{rangeText}</p>}
        {!model.showActual && model.latestActual && (
          <p data-testid="pf-stale">{t("pfc.staleActual", { price: rupees(model.latestActual.price), date: fmtDate(model.latestActual.date) })}</p>
        )}
        {!model.latestActual && <p data-testid="pf-noactual">{t("pfc.noActual")}</p>}
        {win.unvalidated_days + win.unavailable_days > 0 && (
          <p data-testid="pf-missing">{t("pfc.missingDays", { n: win.unvalidated_days + win.unavailable_days })}</p>
        )}
      </div>
    </div>
  );
}
