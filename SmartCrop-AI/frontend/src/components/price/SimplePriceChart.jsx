import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useNarrow } from "../../hooks/useNarrow";
import { useT } from "../../i18n/LanguageContext";
import { fmtDate, rupees } from "../../utils/format";

const DAY = 86400000;
const GAP_DAYS = 10;   // a longer wait between two real reports is shown as a break, never as a joined line
// How much real history is drawn. 120 days took about four fifths of the width, leaving the expected price and the selling date squeezed
// into a thin strip at the right edge; 60 days still shows the recent trend.
export const SHOW_DAYS = 60;
const ts = (iso) => Date.parse(`${iso}T00:00:00Z`);
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * The time axis. Real dates stay in order, but when the forecast starts long after the last real report, the empty stretch in
 * between is drawn as one narrow, labelled "no price records" band instead of months of blank space. Nothing is drawn inside it.
 * Returns the mapping from a real timestamp to its position on the axis.
 */
export function makeScale(lastObs, nextStart) {
  if (lastObs == null || nextStart == null || nextStart - lastObs <= 30 * DAY) return { scale: (t) => t, gap: null };
  const width = 12 * DAY;   // drawn width of the band, in axis units
  return { scale: (t) => (t <= lastObs ? t : t >= nextStart ? t - nextStart + lastObs + width : lastObs + width / 2), gap: { from: lastObs, to: lastObs + width, nextStart } };
}

/**
 * Rows for the chart. `hist` = prices the market really reported; `exp` = the model's expected price (only passed in
 * when the crop's forecast is allowed); `sel` = the expected price on the farmer's selling date; `last` = the latest real report.
 * A null value means "no data here": lines break instead of joining across it. `x` is the axis position, `real` the true date.
 */
export function chartRows({ observed = [], expected = [], selected, targetDate, latest = true }) {
  const last = observed.length ? ts(observed.at(-1).date) : null;
  const hist = observed.filter((p) => last == null || ts(p.date) > last - SHOW_DAYS * DAY);
  const starts = [...expected.map((p) => ts(p.date)), ...(targetDate ? [ts(targetDate)] : [])];
  const nextStart = starts.length ? Math.min(...starts) : null;
  const { scale, gap } = makeScale(last, nextStart);
  const rows = [];
  const push = (real, extra) => rows.push({ real, x: scale(real), ...extra });
  hist.forEach((p, i) => {
    if (i > 0 && ts(p.date) - ts(hist[i - 1].date) > GAP_DAYS * DAY) push(ts(hist[i - 1].date) + DAY, { hist: null });
    push(ts(p.date), { hist: p.price, ...(latest && i === hist.length - 1 ? { last: p.price } : {}) });
  });
  expected.forEach((p) => push(ts(p.date), { exp: p.price }));
  if (selected != null && targetDate) push(ts(targetDate), { sel: selected });
  rows.sort((a, b) => a.x - b.x);
  rows.scale = scale;
  rows.gap = gap;
  return rows;
}

function Tip({ active, payload, t }) {
  if (!active || !payload?.length) return null;
  const p = payload.find((x) => x.value != null && x.dataKey !== "x");
  if (!p) return null;
  const kind = p.dataKey === "hist" || p.dataKey === "last" ? t("pc.tipActual") : t("pc.tipExpected");
  return (
    <div className="chart-tooltip">
      <strong>{fmtDate(iso(p.payload.real))}</strong><br />
      {rupees(p.value)} {t("unit.perQuintal")}<br />
      <span className="muted small">{kind}</span>
    </div>
  );
}

/**
 * Real dates to label on the axis, most important first: the selling date, the latest real report, then a few more across the history.
 * A date is labelled only if it is far enough from the labels already chosen, so labels never sit on top of each other.
 */
function axisTicks(rows, targetDate, narrow) {
  const hist = rows.filter((r) => r.hist != null);
  const span = Math.max(...rows.map((r) => r.x)) - Math.min(...rows.map((r) => r.x)) || 1;
  const pickN = narrow ? 2 : 4;
  const optional = hist.length <= pickN ? hist.map((r) => r.real) : Array.from({ length: pickN }, (_, i) => hist[Math.round((i * (hist.length - 1)) / (pickN - 1))].real);
  const candidates = [targetDate ? ts(targetDate) : null, hist.at(-1)?.real, ...optional].filter((v) => v != null);
  const minGap = span * (narrow ? 0.3 : 0.13);
  const kept = [];
  for (const real of candidates) {
    const x = rows.scale(real);
    if (kept.every((k) => Math.abs(k.x - x) >= minGap)) kept.push({ real, x });
  }
  return kept.sort((a, b) => a.x - b.x);
}

/**
 * Price axis: a range only slightly wider than the prices drawn (so the line fills the plot instead of floating in a wide padded band),
 * with evenly spaced round ticks (₹50, 100, 200, 250, 500 … apart) inside it.
 */
export function priceAxis(lo, hi) {
  const pad = Math.max((hi - lo) * 0.06, 10);
  const from = Math.max(0, Math.floor(lo - pad)), to = Math.ceil(hi + pad);
  const raw = (to - from) / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const steps = [0.5, 1, 2, 2.5, 5, 10].map((m) => m * mag);
  const at = (step) => { const out = []; for (let v = Math.ceil(from / step) * step; v <= to; v += step) out.push(Math.round(v)); return out; };
  let i = steps.findIndex((s) => s >= raw);
  while (i > 0 && at(steps[i]).length < 3) i -= 1;     // at least three labels
  return { domain: [from, to], ticks: at(steps[i]) };
}

/** "Expected ₹1,379" above the selling-date point: drawn only at the one row that has the selected price. */
function SelLabel({ x, y, value, text }) {
  if (value == null || x == null) return null;
  return <text x={x} y={y - 13} textAnchor="middle" fontSize={12.5} fontWeight={700} fill="var(--brand)" data-testid="expected-point-label">{text}</text>;
}

/** The expected price in words and numbers, above the graph: the API's own value for the selling date, or a plain "not available". */
function Headline({ t, show, selected, crop, date }) {
  return (
    <div className="g1-headline" data-testid="g1-headline">
      <span className="g1-headline-label">{t("pc.expectedTitle")}</span>
      {show ? (
        <>
          <span className="g1-headline-price" data-testid="g1-price">{rupees(selected.price)}<span className="unit"> {t("unit.perQuintal")}</span></span>
          <span className="g1-headline-text" data-testid="g1-sentence">{t("pc.expectedSentence", { crop, price: rupees(selected.price), date: fmtDate(date) })}</span>
        </>
      ) : (
        <>
          <span className="g1-headline-price is-none" data-testid="g1-price">{t("pc.expectedNone")}</span>
          <span className="g1-headline-text" data-testid="g1-sentence">{t("pc.expectedNoneSentence", { crop, date: fmtDate(date) })}</span>
        </>
      )}
    </div>
  );
}

/**
 * Graph 1: the expected price for the selling date in words, then real historical prices, the model's expected prices (only when the
 * forecast is allowed) and the farmer's selling date. `forecast` is the /trend or /predict response; nothing is drawn or written that the
 * response does not contain.
 */
export default function SimplePriceChart({ forecast, ctxOnly, selected, crop, market }) {
  const t = useT();
  const narrow = useNarrow();
  const observed = forecast.observed || [];
  const chartEnd = forecast.chart_end_date || forecast.target_date;
  const expected = ctxOnly ? [] : (forecast.chart_path || forecast.path || []).filter((p) => p.beats_baseline && p.date <= chartEnd)
    .map((p) => ({ date: p.date, price: p.predicted_price }));
  const showSel = !ctxOnly && selected?.source === "forecast";
  const rows = chartRows({ observed, expected, selected: showSel ? selected.price : null, targetDate: forecast.target_date });
  const latest = observed.at(-1);
  const headline = <Headline t={t} show={showSel} selected={selected} crop={crop} date={forecast.target_date} />;

  if (!observed.length && !expected.length) {
    return <>{headline}<p className="muted small" data-testid="no-history">{t("price.chart.noHistory", { crop, market })}</p></>;
  }
  const ticks = axisTicks(rows, forecast.target_date, narrow);
  const labels = new Map(ticks.map((tk) => [tk.x, fmtDate(iso(tk.real), { day: "numeric", month: "short", year: "2-digit" })]));
  const targetX = rows.scale(ts(forecast.target_date));
  const xs = rows.map((r) => r.x).concat(targetX);
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const pad = Math.max(2 * DAY, (hi - lo) * 0.03);
  const ys = rows.flatMap((r) => [r.hist, r.exp, r.sel]).filter((v) => v != null);
  const { domain: yDomain, ticks: yTicks } = priceAxis(Math.min(...ys), Math.max(...ys));
  const gap = rows.gap;
  const selText = showSel ? `${t("pc.expectedShort")} ${rupees(selected.price)}` : "";

  return (
    <div data-testid="simple-chart">
      {headline}
      <div className="legend g1-legend" data-testid="chart-legend">
        <span><span className="swatch-line" style={{ borderColor: "var(--text-2)" }} />{t("pc.legendHist")}</span>
        {expected.length > 0 && <span><span className="swatch-dash" style={{ borderColor: "var(--brand)" }} />{t("pc.legendExpected")}</span>}
      </div>
      <div className="g1-axis-caption" aria-hidden="true">{t("pc.axisPrice")}</div>
      <div style={{ width: "100%", height: narrow ? 210 : 240 }} role="img" aria-label={t("pc.title")}>
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: showSel ? 22 : 10, right: narrow ? 30 : 22, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="x" type="number" domain={[lo - pad, hi + pad]} ticks={ticks.map((tk) => tk.x)} interval={0} tickLine={false}
              tickFormatter={(v) => labels.get(v) ?? ""} stroke="var(--axis)" tick={{ fill: "var(--muted)", fontSize: 12 }} height={24} />
            <YAxis domain={yDomain} ticks={yTicks} interval={0} width={narrow ? 50 : 56} tickLine={false} axisLine={false}
              tickFormatter={(v) => rupees(v)} stroke="var(--axis)" tick={{ fill: "var(--muted)", fontSize: 12 }} />
            <Tooltip content={<Tip t={t} />} />
            {gap && <ReferenceArea x1={gap.from} x2={gap.to} fill="var(--grid)" fillOpacity={0.9} strokeOpacity={0}
              label={{ value: narrow ? "" : t("pc.gapLabel"), position: "insideBottom", fill: "var(--muted)", fontSize: 11 }} />}
            <ReferenceLine x={targetX} stroke="#b45309" strokeDasharray="3 3" label={showSel ? undefined : { value: t("pc.marker"), position: narrow ? "insideTopRight" : "insideTopLeft", fill: "#b45309", fontSize: 11, offset: 4 }} />
            <Line dataKey="hist" stroke="var(--text-2)" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
            <Line dataKey="exp" stroke="var(--brand)" strokeWidth={2.5} strokeDasharray="6 4" dot={false} connectNulls={false} isAnimationActive={false} />
            <Line dataKey="last" stroke="none" dot={{ r: 5, fill: "var(--text-2)", stroke: "#fff", strokeWidth: 2 }} activeDot={{ r: 6 }} isAnimationActive={false} />
            <Line dataKey="sel" stroke="none" dot={{ r: 7, fill: "var(--brand)", stroke: "#fff", strokeWidth: 2.5 }} activeDot={{ r: 8 }} isAnimationActive={false}
              label={(p) => <SelLabel {...p} text={selText} />} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="g1-axis-caption is-x" aria-hidden="true">{t("pc.axisDate")}</div>
      <div className="muted small" data-testid="chart-notes">
        {latest && <p style={{ margin: "6px 0 0" }} data-testid="latest-note">{t(forecast.input_date && latest.date < forecast.input_date ? "pc.latestOld" : "pc.latestToday", { price: rupees(latest.price), date: fmtDate(latest.date) })}</p>}
        {!latest && <p style={{ margin: "6px 0 0" }}>{t("pc.noHistory")}</p>}
        {ctxOnly && <p style={{ margin: "2px 0 0" }} data-testid="no-forecast-line">{t("price.chart.noForecastNotice", { crop })}</p>}
      </div>
    </div>
  );
}
