import { useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useNarrow } from "../../hooks/useNarrow";
import { useT } from "../../i18n/LanguageContext";
import { chartModel, isoOf, ts } from "../../utils/forecastWindow";
import { fmtDate, pct, rupees, shortDate, signedRupees } from "../../utils/format";
import { rangeView } from "../../utils/priceView";
import { activePlan } from "../../utils/storagePlan";
import HistoricalPriceChart from "./HistoricalPriceChart";
import { priceAxis } from "./SimplePriceChart";

const ACTUAL = "var(--series-actual)";
const PREDICTED = "var(--series-forecast)";
const PLANNED = "#6b3fa0";
const BEST = "#0f7b4f";
const RECOMMENDED = "#1d6fb8";
const LIMIT = "#b7791f";
const EXPERIMENTAL = "#8a6d3b";
const ESTIMATE = "#7a7a7a";

function Stat({ label, value, sub, testid }) {
  return (
    <div className="pf-stat" data-testid={testid}>
      <span className="pf-stat-label">{label}</span>
      <span className="pf-stat-value">{value}</span>
      {sub && <span className="pf-stat-sub">{sub}</span>}
    </div>
  );
}

/** The planned date's best available figure: the validated prediction, else the model's experimental estimate, else the historical estimate
 *  for a day the model does not reach. `kind` says which, so a card never presents an estimate as a validated prediction. */
export function plannedFigure(planned) {
  if (!planned) return null;
  if (planned.status === "validated") return { price: planned.price, kind: "validated" };
  if (planned.status === "not_validated" && Number.isFinite(planned.price)) return { price: planned.price, kind: "experimental" };
  if (Number.isFinite(planned.estimate?.price)) return { price: planned.estimate.price, kind: "historical" };
  return null;
}

/** The four summary cards. Validated figures when they exist; otherwise the API's estimates, each labelled as such; otherwise "Unavailable"
 *  and why (never a dash, never an invented value). */
function Stats({ win, forecast, t }) {
  const est = win.estimates;               // experimental figures, sent only when no day is validated
  const peak = win.highest || est?.highest;
  const change = win.change || est?.change;
  const tag = (validated) => (validated ? "" : ` · ${t("pfc.stat.estExp")}`);
  const why = t(win.validation?.mode === "context_only" ? "pfc.stat.whyPolicy" : "pfc.stat.whyNone");
  const planned = win.planned;
  const plannedWhy = planned.status === "unavailable" ? t("pfc.stat.whyNoDay") : t("pfc.stat.whyNone");
  const pf = plannedFigure(planned);
  const na = t("pfc.stat.unavailable");
  const r = win.reference;
  const startSub = win.reference_price == null ? why
    : r ? (r.adjusted ? t("pfc.stat.startAdjusted", { raw: Math.round(r.reported_price).toLocaleString("en-IN"), date: fmtDate(r.reported_date), market: r.market || forecast.series?.market, years: r.years, pct: r.adjustment_pct_per_year })
      : t("pfc.stat.startReported", { date: fmtDate(r.reported_date), market: r.market || forecast.series?.market }))
      : win.reference_date ? fmtDate(win.reference_date) : null;
  return (
    <div className="pf-stats">
      <Stat testid="pf-start" label={t("pfc.stat.start")} value={win.reference_price != null ? rupees(win.reference_price) : na} sub={startSub} />
      <Stat testid="pf-planned" label={t("pfc.stat.planned")} value={pf ? rupees(pf.price) : na}
        sub={!pf ? `${fmtDate(planned.date)} · ${plannedWhy}` : pf.kind === "validated" ? fmtDate(planned.date)
          : `${fmtDate(planned.date)} · ${t(pf.kind === "experimental" ? "pfc.stat.estExp" : "pfc.stat.estHist")}`} />
      <Stat testid="pf-high" label={t("pfc.stat.high")} value={peak ? rupees(peak.price) : na} sub={peak ? `${fmtDate(peak.date)}${tag(Boolean(win.highest))}` : why} />
      <Stat testid="pf-change" label={t("pfc.stat.change")} value={change ? pct(change.pct, 1) : na}
        sub={change ? t("pfc.stat.changeFrom", { from: shortDate(change.from_date), to: shortDate(change.to_date), abs: `${change.abs > 0 ? "+" : ""}${signedRupees(change.abs)}` }) + tag(Boolean(win.change)) : why} />
    </div>
  );
}

function Tip({ active, payload, t, crop, market }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  if (!r || (r.actual == null && r.predicted == null && r.experimental == null && r.estimate == null)) return null;
  const actual = r.actual != null;
  const exp = !actual && r.experimental != null && r.predicted == null;
  const est = !actual && !exp && r.estimate != null && r.predicted == null;
  const status = actual ? t("pfc.tip.actual") : exp ? t("pfc.tip.experimental") : est ? t("pfc.tip.estimate") : r.kind === "start" ? t("pfc.tip.start") : t("pfc.tip.forecast");
  return (
    <div className="chart-tooltip" data-testid="pf-tooltip">
      <strong>{fmtDate(r.date)}</strong><br />
      {rupees(actual ? r.actual : exp ? r.experimental : est ? r.estimate : r.predicted)} {t("unit.perQuintal")}<br />
      {r.range && <><span className="muted small">{t("pfc.tip.range", { low: rupees(r.range[0]), high: rupees(r.range[1]) })}</span><br /></>}
      <span className="muted small">{crop} · {market}</span><br />
      <span className="small" style={{ color: actual ? ACTUAL : exp ? EXPERIMENTAL : est ? ESTIMATE : PREDICTED, fontWeight: 700 }}>{status}</span>
    </div>
  );
}

const LABEL_GAP = 18;        // vertical distance between stacked labels
const LABEL_CLEAR = 12;      // a label below a marker keeps at least this far from the curve through it

/**
 * Text label for a chart marker (Recharts clones it with the marker's `viewBox`: for a dot x/y = centre - r, width = height = 2r; for a
 * vertical line its top and height). Placed above (`side="above"`, offset by `level` x LABEL_GAP) or below the marker; anchored "start" /
 * "end" near the plot edges and clamped inside them; moved up (or down) by its height + 4 px while it overlaps a label placed earlier in
 * the same render (`order` = placement order, so a repeated render of the same label never collides with itself); joined to its marker by
 * a thin leader line; drawn over a halo of the card colour so no line cuts through the text.
 */
function MarkerLabel({ viewBox, text, color, side = "above", level = 0, order, layout }) {
  if (!viewBox || !text) return null;
  const { placed, left, right, top, fontSize: fs } = layout;
  const w = text.length * fs * 0.6, h = fs + 4;
  const isLine = !viewBox.width;
  const ax = viewBox.x + (viewBox.width || 0) / 2;
  const r = isLine ? 0 : viewBox.height / 2;
  const ay = isLine ? viewBox.y : viewBox.y + r;
  const above = side === "above";
  let y = isLine ? ay + fs + 4 + level * LABEL_GAP
    : above ? ay - r - 8 - level * LABEL_GAP : ay + r + Math.max(20, LABEL_CLEAR + fs);
  let anchor = "middle", x = ax;
  if (ax - w / 2 < left) { anchor = "start"; x = Math.max(left, Math.min(ax - 8, right - w)); }
  else if (ax + w / 2 > right) { anchor = "end"; x = Math.min(right, Math.max(ax + 8, left + w)); }
  const x0 = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
  const box = () => ({ x0, x1: x0 + w, y0: y - fs, y1: y - fs + h });
  const hits = () => [...placed].some(([o, b]) => o < order && b.x0 < box().x1 && box().x0 < b.x1 && b.y0 < box().y1 && box().y0 < b.y1);
  for (let i = 0; i < 6 && hits(); i += 1) y += (above || isLine ? -1 : 1) * (h + 4);
  if (y - fs < top) {                                   // pushed past the top: go below the other labels instead
    y = top + fs;
    for (let i = 0; i < 6 && hits(); i += 1) y += h + 4;
  }
  placed.set(order, box());
  const b = box();
  const lx = Math.min(Math.max(ax, b.x0 + 4), b.x1 - 4);
  const ly = y - fs < ay ? b.y1 : b.y0;                 // the box edge facing the marker
  const my = isLine ? ly : (ly < ay ? ay - r : ay + r);
  return (
    <g className="pf-marker-label" data-testid="pf-marker-label" data-anchor={anchor}>
      {Math.abs(ly - my) > 4 && <line x1={ax} y1={my} x2={lx} y2={ly} stroke={color} strokeWidth={1} strokeOpacity={0.55} />}
      <text x={x} y={y} textAnchor={anchor} fill={color} fontSize={fs} fontWeight={700}
        stroke="var(--surface)" strokeWidth={4} strokeOpacity={0.85} strokeLinejoin="round" paintOrder="stroke">{text}</text>
    </g>
  );
}

function Legend({ t, hasPlanned, showActual, showRange, hasBest, showExperimental, hasEstimate, hasValidated, hasRec, hasExpRec, hasLimit }) {
  return (
    <div className="legend pf-legend" data-testid="pf-legend">
      {showActual && <span><span className="swatch-line" style={{ borderColor: ACTUAL, borderTopWidth: 3 }} />{t("pfc.legend.actual")}</span>}
      {hasValidated && <span><span className="swatch-dash" style={{ borderColor: PREDICTED, borderTopWidth: 3 }} />{t("pfc.legend.predicted")}</span>}
      {showExperimental && <span><span className="swatch-line" style={{ borderColor: EXPERIMENTAL, borderTopStyle: "dotted", borderTopWidth: 3 }} />{t("pfc.legend.experimental")}</span>}
      {hasEstimate && <span data-testid="pf-legend-estimate"><span className="swatch-line" style={{ borderColor: ESTIMATE, borderTopStyle: "dashed", borderTopWidth: 2 }} />{t("pfc.legend.estimate")}</span>}
      {showRange && <span><span className="swatch" style={{ background: PREDICTED, opacity: 0.22 }} />{t("pfc.legend.range")}</span>}
      {hasPlanned && <span><span className="pf-dot" style={{ background: PLANNED }} />{t("pfc.legend.planned")}</span>}
      {hasBest && <span><span className="pf-dot pf-star" style={{ background: BEST }} />{t("pfc.legend.best")}</span>}
      {hasRec && <span><span className="pf-dot" style={{ background: RECOMMENDED }} />{t("pfc.legend.recommended")}</span>}
      {hasExpRec && <span data-testid="pf-legend-exprec"><span className="pf-dot" style={{ background: "#fff", border: `2px solid ${RECOMMENDED}` }} />{t("pfc.legend.expRecommended")}</span>}
      {hasLimit && <span><span className="swatch-dash" style={{ borderColor: LIMIT, borderTopWidth: 2 }} />{t("pfc.legend.limit")}</span>}
    </div>
  );
}

/**
 * The daily price forecast for the next 60 days: real reported prices (solid, only when recent enough to share the axis), the model's
 * validated daily predictions (dashed), its experimental (not validated) estimates (dotted; shown by default, can be hidden), the historical
 * estimate for days the model does not reach (grey dashed), the farmer's planned date and the highest predicted date. `win` is the API's
 * `window`. A day with none of these is left as a gap; a recommendation is only ever built from validated days.
 */
export default function PriceForecastChart({ forecast, crop, market, storageKey = null }) {
  const t = useT();
  const narrow = useNarrow();
  const small = useNarrow(480);
  const [showExp, setShowExp] = useState(true);
  const [chartW, setChartW] = useState(0);
  const win = forecast.window;
  if (!win) return <p className="muted small" data-testid="pf-unavailable">{t("pfc.unavailable")}</p>;

  const range = rangeView(forecast);
  const showRange = range.kind === "measured" || range.kind === "unmeasured";
  const model = chartModel(win, forecast.observed, { showRange, showExperimental: showExp, showEstimates: true, tickDays: narrow ? 14 : 7 });
  const hasExperimental = win.entries.some((e) => e.status === "not_validated" && Number.isFinite(e.predicted_price));
  const experimentalRows = model.rows.filter((r) => r.experimental != null);
  const estimateRows = model.rows.filter((r) => r.estimate != null);
  const predicted = model.rows.filter((r) => r.predicted != null && r.kind !== "start");
  const hasRangeRows = model.rows.some((r) => r.range);
  const planned = win.planned.in_window && win.planned.status === "validated" ? win.planned : null;
  // the planned date is always marked inside the window: on the experimental curve when that is drawn, else as a vertical line (no price)
  const plannedExp = !planned && win.planned.in_window && showExp && win.planned.status === "not_validated" && Number.isFinite(win.planned.price) ? win.planned : null;
  const plannedLine = !planned && !plannedExp && win.planned.in_window ? win.planned.date : null;
  const peak = win.highest;
  // the recommended date and the storage limit of the farmer's chosen storage (the same plan the selling card shows)
  const plan = activePlan(win, storageKey);
  const cmp = plan ? plan.comparison : win.comparison;
  const rec = planned && cmp?.code === "alternative" ? { date: cmp.date, price: cmp.price } : null;
  // without a validated comparison, the API's provisional one on experimental estimates (same storage deadline), drawn only with that curve
  const expCmp = (plan ? plan.experimental : win.experimental)?.comparison;
  const expRec = !rec && plannedExp && expCmp?.code === "alternative" ? { date: expCmp.date, price: expCmp.price } : null;
  const plannedIsRec = Boolean(planned && cmp?.code === "planned_is_best");
  const limit = plan?.deadline && plan.deadline > win.start_date && plan.deadline < win.end_date && plan.hold_days > 0 ? plan.deadline : null;

  const toggle = hasExperimental && (
    <label className="pf-exp-toggle" data-testid="pf-exp-toggle">
      <input type="checkbox" checked={showExp} onChange={(e) => setShowExp(e.target.checked)} />
      <span>{t("pfc.exp.toggle")}</span>
    </label>
  );

  if (!predicted.length && !(showExp && experimentalRows.length) && !estimateRows.length) {
    const v = win.validation || {};
    return (
      <div data-testid="pf-chart">
        <Stats win={win} forecast={forecast} t={t} />
        <p className="pf-none" data-testid="pf-none"><strong>{t("pfc.none.title", { crop, market })}</strong> {t(v.mode === "context_only" ? "pfc.none.policy" : "pfc.none.generic", { crop })}</p>
        <HistoricalPriceChart observed={forecast.observed} crop={crop} market={market} />
        {!model.latestActual && <p className="muted small">{t("pfc.noActual")}</p>}
        {toggle}
      </div>
    );
  }

  const ys = model.rows.flatMap((r) => [r.actual, r.predicted, r.experimental, r.estimate]).filter((v) => v != null);
  const { domain: yDomain, ticks: yTicks } = priceAxis(Math.min(...ys), Math.max(...ys));
  const [x0, x1] = model.domain;
  const startTs = ts(win.start_date);
  const tickLabel = (v) => shortDate(isoOf(v));
  const sameDay = planned && peak && planned.date === peak.date;
  const peakIsRec = Boolean(rec && peak && rec.date === peak.date);
  const showPeak = peak && !sameDay && !peakIsRec;
  const margin = { top: 44, right: narrow ? 18 : 28, bottom: 4, left: 8 };
  const yAxisW = narrow ? 56 : 64;
  const layout = { placed: new Map(), left: margin.left + yAxisW, right: chartW ? chartW - margin.right : Infinity, top: 12,
    fontSize: small ? 10 : narrow ? 11 : 12.5 };
  // the long label, or on phones under 480 px its short form ("Suggested · 30 Oct")
  const say = (key, date, shortKey) => (small && shortKey ? `${t(shortKey)} · ${shortDate(date)}` : `${t(key)} ${shortDate(date)}`);
  let order = 0;
  const label = (text, color, opts = {}) => <MarkerLabel text={text} color={color} order={order++} layout={layout} {...opts} />;

  return (
    <div data-testid="pf-chart">
      <Stats win={win} forecast={forecast} t={t} />
      <p className="pf-axis-note muted small">{t("pfc.axisNote")}</p>

      <div style={{ width: "100%", height: narrow ? 260 : 340 }} role="img" aria-label={t("pfc.title")}>
        <ResponsiveContainer onResize={(w) => setChartW(w)}>
          <ComposedChart data={model.rows} margin={margin} style={{ overflow: "visible" }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="t" type="number" scale="time" domain={[x0, x1]} ticks={model.ticks} interval={0} tickLine={false}
              tickFormatter={tickLabel} stroke="var(--axis)" tick={{ fill: "var(--muted)", fontSize: narrow ? 11 : 12.5 }} height={26} />
            <YAxis domain={yDomain} ticks={yTicks} interval={0} allowDataOverflow width={yAxisW} tickLine={false} axisLine={false}
              tickFormatter={(v) => rupees(v)} tick={{ fill: "var(--muted)", fontSize: narrow ? 11 : 12.5 }} />
            <Tooltip content={<Tip t={t} crop={crop} market={market} />} />
            {model.showActual && model.firstActual != null && (
              <ReferenceArea x1={model.firstActual} x2={startTs} fill="var(--grid)" fillOpacity={0.45} strokeOpacity={0}
                label={narrow ? undefined : { value: t("pfc.area.history"), position: "insideTopLeft", fill: "var(--muted)", fontSize: 11 }} />
            )}
            <ReferenceLine x={startTs} stroke="var(--axis)" strokeDasharray="4 3"
              label={win.reference_price == null ? label(t("pfc.area.start"), "var(--muted)") : undefined} />
            {win.reference_price != null && (       // carries the label only; the starting-price dot is drawn by the "ref" line below
              <ReferenceDot x={startTs} y={win.reference_price} r={5} fill="none" stroke="none" ifOverflow="visible"
                label={label(small ? t("pfc.area.startShort") : t("pfc.area.start"), "var(--muted)", { level: 0 })} />
            )}
            {showRange && <Area dataKey="range" stroke="none" fill={PREDICTED} fillOpacity={0.16} connectNulls={false} isAnimationActive={false} activeDot={false} />}
            <Line dataKey="actual" stroke={ACTUAL} strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
            {showExp && <Line dataKey="experimental" stroke={EXPERIMENTAL} strokeWidth={2} strokeDasharray="2 4" dot={false} connectNulls={false} isAnimationActive={false} />}
            {estimateRows.length > 0 && <Line dataKey="estimate" stroke={ESTIMATE} strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls={false} isAnimationActive={false} />}
            <Line dataKey="predicted" stroke={PREDICTED} strokeWidth={2.5} strokeDasharray="7 4" dot={false} connectNulls={false} isAnimationActive={false} />
            <Line dataKey="ref" stroke="none" dot={{ r: 4.5, fill: "#fff", stroke: PREDICTED, strokeWidth: 2.5 }} activeDot={false} isAnimationActive={false} />
            {limit && (
              <ReferenceLine x={ts(limit)} stroke={LIMIT} strokeDasharray="5 4" strokeWidth={1.5}
                label={label(t("pfc.mark.limit"), LIMIT)} />
            )}
            {showPeak && (
              <ReferenceDot x={ts(peak.date)} y={peak.price} r={8} fill={BEST} stroke="#fff" strokeWidth={2.5} ifOverflow="visible"
                label={label(say("pfc.mark.best", peak.date), BEST)} />
            )}
            {rec && (
              <ReferenceDot x={ts(rec.date)} y={rec.price} r={8} fill={RECOMMENDED} stroke="#fff" strokeWidth={2.5} ifOverflow="visible"
                label={label(say(peakIsRec ? "pfc.mark.recommendedHigh" : "pfc.mark.recommended", rec.date), RECOMMENDED, { level: 1 })} />
            )}
            {plannedExp && (
              <ReferenceDot x={ts(plannedExp.date)} y={plannedExp.price} r={7} fill={PLANNED} stroke="#fff" strokeWidth={2.5} ifOverflow="visible"
                label={label(say("pfc.mark.plannedEst", plannedExp.date, "pfc.mark.plannedShort"), PLANNED, { side: "below" })} />
            )}
            {plannedLine && (
              <ReferenceLine x={ts(plannedLine)} stroke={PLANNED} strokeDasharray="3 3" strokeWidth={1.5}
                label={label(say("pfc.mark.planned", plannedLine, "pfc.mark.plannedShort"), PLANNED)} />
            )}
            {expRec && (
              <ReferenceDot x={ts(expRec.date)} y={expRec.price} r={7} fill="#fff" stroke={RECOMMENDED} strokeWidth={2.5} ifOverflow="visible"
                label={label(say("pfc.mark.expRecommended", expRec.date, "pfc.mark.expRecommendedShort"), RECOMMENDED, { level: 1 })} />
            )}
            {planned && (
              <ReferenceDot x={ts(planned.date)} y={planned.price} r={8} fill={PLANNED} stroke="#fff" strokeWidth={2.5} ifOverflow="visible"
                label={label(say(plannedIsRec ? (sameDay ? "pfc.mark.plannedRecHigh" : "pfc.mark.plannedRec") : sameDay ? "pfc.mark.plannedBest" : "pfc.mark.planned",
                  planned.date, "pfc.mark.plannedShort"), PLANNED, { side: sameDay ? "above" : "below" })} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <Legend t={t} hasPlanned={Boolean(planned || plannedExp || plannedLine)} showActual={model.showActual} showRange={showRange && hasRangeRows} hasBest={showPeak}
        hasRec={Boolean(rec)} hasExpRec={Boolean(expRec)} hasLimit={Boolean(limit)} showExperimental={showExp && experimentalRows.length > 0} hasEstimate={estimateRows.length > 0} hasValidated={predicted.length > 0} />
      {estimateRows.length > 0 && <p className="pf-exp-warn" data-testid="pf-estimate-note">{t("pfc.estimate.note", { n: estimateRows.length })}</p>}
      {toggle}
    </div>
  );
}
