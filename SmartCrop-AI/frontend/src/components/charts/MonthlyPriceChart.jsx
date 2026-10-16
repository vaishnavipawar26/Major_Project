import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { useNarrow } from "../../hooks/useNarrow";
import { useT } from "../../i18n/LanguageContext";
import { monthLabel, rupees } from "../../utils/format";

function PriceTooltip({ active, payload }) {
  const t = useT();
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="mb-1 font-semibold">{monthLabel(p.month)}</div>
      {p.actual != null && (
        <div className="t-row"><span className="swatch-line" style={{ borderColor: "var(--series-actual)" }} />
          {t("cr.chart.recorded")}:&nbsp;<strong>{rupees(p.actual)}</strong></div>
      )}
      {p.forecast != null && !p.isOrigin && (
        <>
          <div className="t-row"><span className="swatch-dash" style={{ borderColor: "var(--series-forecast)" }} />
            {t("cr.chart.estimate")}:&nbsp;<strong>{rupees(p.forecast)}</strong></div>
          {p.band && <div className="muted small">{t("price.chart.rangeTooltip", { low: rupees(p.band[0]), high: rupees(p.band[1]) })}</div>}
        </>
      )}
    </div>
  );
}

/**
 * One row per month: recorded price, projected price and its likely range. Months the API lists as
 * selling options but the price path does not reach are added with their projected price only.
 */
export function buildPriceRows(market, options = []) {
  const rows = new Map();
  const put = (month, patch) => rows.set(month, { month, ...(rows.get(month) || {}), ...patch });
  market.history.forEach((h) => put(h.month, { actual: h.price }));
  put(market.latest_month, { forecast: market.latest_price, band: [market.latest_price, market.latest_price], isOrigin: true });
  market.path.forEach((p) => put(p.month, { forecast: p.price, band: [p.low, p.high] }));
  options.forEach((o) => { if (!rows.has(o.month)) put(o.month, { forecast: o.price }); });
  return [...rows.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** Label drawn to the left of a dot so it can never run off the right edge of the chart. */
const dotLabel = (text, fill, position) => ({ value: text, position, fill, fontSize: 11, fontWeight: 700, offset: 10 });

/**
 * Monthly mandi prices (thin blue line) and the projection (dashed orange, shaded likely range).
 * Only two months are marked: the farmer's selling month (green) and the best month (orange).
 */
export default function MonthlyPriceChart({ market, rows, sellingMonth, bestMonth }) {
  const t = useT();
  const narrow = useNarrow();
  const sellPoint = rows.find((r) => r.month === sellingMonth);
  const bestPoint = bestMonth && bestMonth !== sellingMonth ? rows.find((r) => r.month === bestMonth) : null;

  return (
    <div>
      <div className="legend legend-compact mb-2">
        <span><span className="swatch-line" style={{ borderColor: "var(--series-actual)" }} />{t("cr.chart.legendPast")}</span>
        <span><span className="swatch-dash" style={{ borderColor: "var(--series-forecast)" }} />{t("cr.chart.legendProjected")}</span>
        <span><span className="swatch" style={{ background: "var(--series-forecast)", opacity: 0.25 }} />{t("cr.chart.legendRange")}</span>
      </div>
      <div style={{ width: "100%", height: narrow ? 240 : 300 }}>
        <ResponsiveContainer>
          <ComposedChart data={rows} margin={{ top: 24, right: narrow ? 16 : 28, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="var(--grid)" strokeOpacity={0.55} strokeWidth={0.75} vertical={false} />
            <XAxis dataKey="month" tickFormatter={monthLabel} stroke="var(--axis)" interval="preserveStartEnd"
              tick={{ fill: "var(--muted)", fontSize: narrow ? 11 : 12 }} minTickGap={narrow ? 32 : 24}
              tickLine={false} height={narrow ? 26 : 28} />
            <YAxis tickFormatter={(v) => `₹${Math.round(v)}`} stroke="var(--axis)" width={narrow ? 52 : 60}
              tick={{ fill: "var(--muted)", fontSize: narrow ? 11 : 12 }} domain={[0, "auto"]} tickLine={false} axisLine={false} />
            <Tooltip content={<PriceTooltip />} cursor={{ stroke: "var(--axis)", strokeWidth: 1 }} />
            <Area dataKey="band" stroke="none" fill="var(--series-forecast)" fillOpacity={0.12}
              connectNulls isAnimationActive={false} activeDot={false} />
            <Line dataKey="actual" stroke="var(--series-actual)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round"
              dot={false} connectNulls isAnimationActive={false} activeDot={{ r: 4 }} />
            <Line dataKey="forecast" stroke="var(--series-forecast)" strokeWidth={1.5} strokeDasharray="5 4"
              strokeLinejoin="round" strokeLinecap="round" dot={false} connectNulls isAnimationActive={false} activeDot={{ r: 4 }} />
            <ReferenceLine x={market.latest_month} stroke="var(--axis)" strokeDasharray="1 4" strokeWidth={1.5} />
            {sellPoint?.forecast != null && (
              <ReferenceDot x={sellingMonth} y={sellPoint.forecast} r={6} fill="var(--leaf)" stroke="#fff" strokeWidth={2}
                label={dotLabel(t(bestMonth === sellingMonth ? "cr.chart.sellIsBest" : "cr.chart.dotSell"), "var(--brand-strong)", "bottom")} />
            )}
            {bestPoint?.forecast != null && (
              <ReferenceDot x={bestMonth} y={bestPoint.forecast} r={6} fill="var(--series-forecast)" stroke="#fff" strokeWidth={2}
                label={dotLabel(t("cr.chart.dotBest"), "var(--text-2)", "left")} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Month-by-month prices, shown when the farmer opens "View monthly prices". */
export function MonthlyPriceTable({ rows, sellingMonth, bestMonth }) {
  const t = useT();
  const note = (m) => [m === sellingMonth && "crop.priceChart.tagSell", m === bestMonth && "cr.chart.dotBest"].filter(Boolean).map((k) => t(k)).join(", ");
  return (
    <div className="table-wrap mt-2 max-h-72 overflow-y-auto">
      <table>
        <thead><tr><th>{t("table.month")}</th><th className="num">{t("table.mandiPrice")}</th><th className="num">{t("table.projected")}</th>
          <th className="num">{t("table.likelyRange")}</th><th>{t("table.note")}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month}>
              <td>{monthLabel(r.month)}</td>
              <td className="num">{r.actual != null ? rupees(r.actual) : "—"}</td>
              <td className="num">{r.forecast != null && !r.isOrigin ? rupees(r.forecast) : "—"}</td>
              <td className="num">{r.band && !r.isOrigin ? `${rupees(r.band[0])} – ${rupees(r.band[1])}` : "—"}</td>
              <td className="small">{note(r.month)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
