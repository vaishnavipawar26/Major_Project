import { useMemo, useState } from "react";
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useNarrow } from "../../hooks/useNarrow";
import { useT } from "../../i18n/LanguageContext";
import { addDays, daysBetween, fmtDate, rupees, shortDate } from "../../utils/format";
import { dailyCarried, smoothIfJagged, yDomain } from "../../utils/priceChart";

const ts = (iso) => Date.parse(`${iso}T00:00:00Z`);
const isoOf = (t) => new Date(t).toISOString().slice(0, 10);
const fmtTick = (t) => shortDate(isoOf(t));
export const CHART_AFTER_DAYS = 14;   // the chart runs this far past the selected date when the API gives no end date

export function TrendTooltip({ active, payload, originDate, pastLabel }) {
  const t = useT();
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const ahead = daysBetween(originDate, p.dateIso);
  const forecast = p.forecast ?? p.forecastWeak;
  return (
    <div className="chart-tooltip">
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        {fmtDate(p.dateIso)}
        {ahead > 0 && <span className="muted small"> · {t(ahead === 1 ? "price.chart.dayAhead" : "price.chart.daysAhead", { n: ahead })}</span>}
      </div>
      {forecast != null ? (
        <>
          <div className="t-row">
            <span className="swatch-dash" style={{ borderColor: p.forecast != null ? "var(--series-forecast)" : "var(--series-weak)" }} />
            {p.isOrigin ? t("price.chart.startingPrice") : p.forecast != null ? t("price.chart.predicted") : t("price.chart.predictedWeak")}:&nbsp;
            <strong>{rupees(forecast)}</strong>
          </div>
          {p.band && !p.isOrigin && (
            <div className="muted small">{t("price.chart.rangeLine", { low: rupees(p.band[0]), high: rupees(p.band[1]) })}</div>
          )}
        </>
      ) : p.past != null && (
        <div className="t-row">
          <span className="swatch-dotted" style={{ borderColor: "var(--series-reference)" }} />
          {pastLabel}:&nbsp;<strong>{rupees(p.past)}</strong>
        </div>
      )}
    </div>
  );
}

/**
 * One design for every crop. A dotted grey line: last year's price for the same dates (inflation adjusted, gaps carried
 * forward, smoothed when jagged), from the start date to the end of the chart. With a forecast: the orange dashed
 * expected price (lighter on days the API marks as less reliable) inside the API's likely-range band. Without one
 * (`forecast` false): no orange line, band or expected price, only the grey line. A dotted "Today" line, a green line
 * and dot on the selected date (`selected`: the one shared value, see utils/selectedPrice.js) and the start dot.
 * Every point uses the date returned by the API on a true time axis.
 */
export default function PriceTrendChart({
  historyIsReference, referenceRows, chartPath, originDate, inputDate, currentPrice, targetDate, chartEnd,
  forecast: forecastOn = true, selected, latest = null, caption = null,
}) {
  const t = useT();
  const narrow = useNarrow();
  const [showTable, setShowTable] = useState(false);
  const pastLabel = t(historyIsReference ? "price.chart.reference" : "price.chart.actual");
  const end = chartEnd || addDays(targetDate, CHART_AFTER_DAYS);
  const today = inputDate || originDate;

  const { data, hasWeak, hasBand, hasPast, prices } = useMemo(() => {
    const rows = new Map();
    const put = (iso, patch) => {
      const k = ts(iso);
      rows.set(k, { t: k, dateIso: iso, ...(rows.get(k) || {}), ...patch });
    };
    // grey line: last year's prices from the start date on, gaps carried forward, smoothed only when jagged
    const known = [{ date: originDate, price: currentPrice }, ...referenceRows.filter((r) => r.date > originDate && r.date <= end)];
    const daily = dailyCarried(known, end);
    const smooth = smoothIfJagged(daily.map((d) => d.price));
    daily.forEach((d, i) => put(d.date, { past: smooth[i] }));
    put(originDate, { past: currentPrice, isOrigin: true });
    put(end, {});
    // validated days go to "forecast", the others to "forecastWeak"; where the status changes the earlier point also gets the
    // other key so the two dashed lines join up. The band is the API's own low-to-high range per day.
    const pts = forecastOn ? [{ date: originDate, price: currentPrice, ok: true },
      ...chartPath.filter((f) => f.date <= end).map((f) => ({ date: f.date, price: f.predicted_price, ok: f.beats_baseline, f }))] : [];
    let weak = false, band = false;
    pts.forEach((p, i) => {
      const key = p.ok ? "forecast" : "forecastWeak";
      const patch = { [key]: p.price };
      if (p.f) { patch.band = [p.f.lower, p.f.upper]; band = true; }
      if (i > 0 && pts[i - 1].ok !== p.ok) put(pts[i - 1].date, { [key]: pts[i - 1].price });
      if (!p.ok) weak = true;
      put(p.date, patch);
    });
    const data = [...rows.values()].sort((a, b) => a.t - b.t);
    return { data, hasWeak: weak, hasBand: band, hasPast: daily.length > 1,
      prices: data.flatMap((r) => [r.past, r.forecast, r.forecastWeak, ...(r.band || [])]).filter((v) => v != null) };
  }, [referenceRows, chartPath, originDate, currentPrice, end, forecastOn]);

  const showToday = today >= originDate && today <= end;
  const reportDate = latest?.date;
  const reportInRange = reportDate && reportDate !== today && reportDate >= originDate && reportDate <= end;
  const startLabel = t("price.chart.latestPrice", { price: rupees(currentPrice) })
    + (reportDate && reportDate !== today && !reportInRange ? ` · ${fmtDate(reportDate)}` : "");
  const dotLabel = !selected ? null : forecastOn ? rupees(selected.price)
    : t(historyIsReference ? "price.chart.dayLabelBlocked" : "price.chart.dayLabelBlockedActual", { date: fmtDate(targetDate), price: rupees(selected.price) });

  return (
    <div>
      <div className="legend" style={{ marginBottom: 8 }} data-testid="chart-legend">
        {hasPast && <span><span className={historyIsReference ? "swatch-dotted" : "swatch-line"} style={{ borderColor: "var(--series-reference)" }} />{pastLabel}</span>}
        {forecastOn && <span><span className="swatch-dash" style={{ borderColor: "var(--series-forecast)" }} />{t("price.chart.predicted")}</span>}
        {forecastOn && hasWeak && <span><span className="swatch-dash" style={{ borderColor: "var(--series-weak)" }} />{t("price.chart.predictedWeak")}</span>}
        {forecastOn && hasBand && <span><span className="swatch" style={{ background: "var(--series-forecast)", opacity: 0.25 }} />{t("price.chart.rangeLegend")}</span>}
        <span><span className="swatch-vline" style={{ borderColor: "var(--brand-strong)" }} />{t("price.chart.selectedDate")}</span>
      </div>
      <div className="chart-box" data-testid="chart-box">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 24, right: narrow ? 8 : 20, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="t" type="number" scale="time" domain={[ts(originDate), ts(end)]} allowDataOverflow
              tickFormatter={fmtTick} stroke="var(--axis)" tick={{ fill: "var(--muted)", fontSize: narrow ? 11 : 12 }}
              minTickGap={narrow ? 36 : 24} />
            <YAxis tickFormatter={(v) => `₹${Math.round(v).toLocaleString("en-IN")}`} stroke="var(--axis)" width={narrow ? 58 : 70}
              tick={{ fill: "var(--muted)", fontSize: narrow ? 11 : 12 }} domain={yDomain(prices, currentPrice)}
              label={{ value: t("unit.rsPerQuintal"), angle: -90, position: "insideLeft", offset: 10, fill: "var(--muted)", fontSize: 12, dy: 40 }} />
            <Tooltip content={<TrendTooltip originDate={originDate} pastLabel={pastLabel} />} cursor={{ stroke: "var(--axis)", strokeWidth: 1 }} />
            {forecastOn && hasBand && <Area dataKey="band" stroke="none" fill="var(--series-forecast)" fillOpacity={0.16}
              connectNulls isAnimationActive={false} activeDot={false} />}
            <Line dataKey="past" stroke="var(--series-reference)" strokeWidth={2.5} strokeDasharray={historyIsReference ? "1 5" : undefined}
              strokeLinecap="round" dot={false} connectNulls isAnimationActive={false} activeDot={{ r: 4 }} />
            {forecastOn && <Line dataKey="forecast" stroke="var(--series-forecast)" strokeWidth={2.5} strokeDasharray="6 4" dot={false}
              connectNulls={false} isAnimationActive={false} activeDot={{ r: 5 }} />}
            {forecastOn && hasWeak && <Line dataKey="forecastWeak" stroke="var(--series-weak)" strokeWidth={2.5} strokeDasharray="2 4" dot={false}
              connectNulls={false} isAnimationActive={false} activeDot={{ r: 5 }} />}
            {showToday && <ReferenceLine x={ts(today)} stroke="var(--text-2)" strokeDasharray="3 3"
              label={{ value: t("price.chart.today"), position: "top", fill: "var(--text-2)", fontSize: 12 }} />}
            {reportInRange && <ReferenceLine x={ts(reportDate)} stroke="var(--text-2)" strokeDasharray="1 4"
              label={{ value: t("price.chart.latestReport", { date: fmtDate(reportDate) }), position: "insideTopLeft", fill: "var(--text-2)", fontSize: 11 }} />}
            <ReferenceDot x={ts(originDate)} y={currentPrice} r={6} fill="var(--text-2)" stroke="#fff" strokeWidth={2}
              label={{ value: startLabel, position: "bottom", offset: 10, fill: "var(--text-2)", fontSize: narrow ? 10 : 12, fontWeight: 700 }} />
            <ReferenceLine x={ts(targetDate)} stroke="var(--brand-strong)" strokeWidth={2}
              label={{ value: t("price.chart.yourDate"), position: "top", fill: "var(--brand-strong)", fontSize: 12, fontWeight: 700 }} />
            {selected && (
              <ReferenceDot x={ts(targetDate)} y={selected.price} r={7} fill="var(--brand-strong)" stroke="#fff" strokeWidth={2} ifOverflow="extendDomain"
                label={{ value: dotLabel, position: forecastOn ? "right" : "left", offset: 10, fill: "var(--brand-strong)", fontSize: narrow ? 10 : 12, fontWeight: 700 }} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {caption && <p className="muted small" style={{ marginTop: 6 }} data-testid="chart-caption">{caption}</p>}
      {forecastOn && (
        <button type="button" className="btn-link small" onClick={() => setShowTable((s) => !s)} aria-expanded={showTable}>
          {showTable ? t("price.chart.hideTable") : t("price.chart.showTable")}
        </button>
      )}
      {forecastOn && showTable && (
        <div className="table-wrap" style={{ marginTop: 8, maxHeight: 360 }}>
          <table>
            <thead>
              <tr><th>{t("table.date")}</th><th className="num">{t("table.daysAhead")}</th><th className="num">{t("table.predictedPrice")}</th>
                <th className="num">{t("table.range")}</th><th>{t("table.reliability")}</th></tr>
            </thead>
            <tbody>
              {chartPath.filter((f) => f.date <= end).map((f) => (
                <tr key={f.date} className={f.date === targetDate ? "row-highlight" : undefined}>
                  <td>{fmtDate(f.date)}{f.date === targetDate && <span className="badge badge-brand" style={{ marginLeft: 6 }}>{t("price.chart.yourDate")}</span>}</td>
                  <td className="num">{f.horizon_days}</td>
                  <td className="num">{rupees(f.predicted_price)}</td>
                  <td className="num">{rupees(f.lower)} – {rupees(f.upper)}</td>
                  <td>{f.beats_baseline ? "" : t("table.lessReliable")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
