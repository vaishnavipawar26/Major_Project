import { useMemo, useState } from "react";
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { monthLabel, rupees } from "../../utils/format";

function PriceTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="mb-1 font-semibold">{monthLabel(p.month)}</div>
      {p.actual != null && (
        <div className="t-row"><span className="swatch-line" style={{ borderColor: "var(--series-actual)" }} />
          Mandi price (monthly median):&nbsp;<strong>{rupees(p.actual)}</strong></div>
      )}
      {p.forecast != null && !p.isOrigin && (
        <>
          <div className="t-row"><span className="swatch-dash" style={{ borderColor: "var(--series-forecast)" }} />
            Projected price:&nbsp;<strong>{rupees(p.forecast)}</strong></div>
          <div className="muted small">Likely range: {rupees(p.band[0])} – {rupees(p.band[1])}</div>
        </>
      )}
      {p.tags.length > 0 && <div className="mt-1 text-xs font-semibold text-ink-2">{p.tags.join(" · ")}</div>}
    </div>
  );
}

/**
 * Monthly mandi prices (solid blue) and the XGBoost projection up to the selling month
 * (dashed orange + shaded 10–90% range). Peak, low and selling month are marked and labelled.
 */
export default function MonthlyPriceChart({ market, sellingMonth, optimalMonth }) {
  const [showTable, setShowTable] = useState(false);
  const { data, peak, trough, sellPoint } = useMemo(() => {
    const rows = new Map();
    const put = (month, patch) => rows.set(month, { month, tags: [], ...(rows.get(month) || {}), ...patch });
    market.history.forEach((h) => put(h.month, { actual: h.price }));
    put(market.latest_month, { forecast: market.latest_price, band: [market.latest_price, market.latest_price], isOrigin: true });
    market.path.forEach((p) => put(p.month, { forecast: p.price, band: [p.low, p.high] }));
    const all = [...rows.values()].sort((a, b) => a.month.localeCompare(b.month));
    const proj = all.filter((r) => r.forecast != null && !r.isOrigin);
    const pk = proj.reduce((m, r) => (!m || r.forecast > m.forecast ? r : m), null);
    const tr = proj.reduce((m, r) => (!m || r.forecast < m.forecast ? r : m), null);
    if (pk) pk.tags.push("Projected peak");
    if (tr && tr !== pk) tr.tags.push("Projected low");
    const sp = rows.get(sellingMonth);
    if (sp) sp.tags.push("Your selling month");
    if (optimalMonth && optimalMonth !== sellingMonth && rows.get(optimalMonth)) rows.get(optimalMonth).tags.push("Most profitable month");
    return { data: all, peak: pk, trough: tr, sellPoint: sp };
  }, [market, sellingMonth, optimalMonth]);

  return (
    <div>
      <div className="legend mb-2">
        <span><span className="swatch-line" style={{ borderColor: "var(--series-actual)" }} />Mandi price (history)</span>
        <span><span className="swatch-dash" style={{ borderColor: "var(--series-forecast)" }} />Projected price</span>
        <span><span className="swatch" style={{ background: "var(--series-forecast)", opacity: 0.25 }} />Likely range (10–90%)</span>
      </div>
      <div style={{ width: "100%", height: 320 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 28, right: 24, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="month" tickFormatter={monthLabel} stroke="var(--axis)" interval="preserveStartEnd"
              tick={{ fill: "var(--muted)", fontSize: 12 }} minTickGap={24} />
            <YAxis tickFormatter={(v) => `₹${Math.round(v)}`} stroke="var(--axis)" width={60}
              tick={{ fill: "var(--muted)", fontSize: 12 }} domain={[0, "auto"]} />
            <Tooltip content={<PriceTooltip />} cursor={{ stroke: "var(--axis)", strokeWidth: 1 }} />
            <Area dataKey="band" stroke="none" fill="var(--series-forecast)" fillOpacity={0.14}
              connectNulls isAnimationActive={false} activeDot={false} />
            <Line dataKey="actual" stroke="var(--series-actual)" strokeWidth={2} dot={false}
              connectNulls isAnimationActive={false} activeDot={{ r: 4 }} />
            <Line dataKey="forecast" stroke="var(--series-forecast)" strokeWidth={2} strokeDasharray="6 4"
              dot={false} connectNulls isAnimationActive={false} activeDot={{ r: 5 }} />
            <ReferenceLine x={market.latest_month} stroke="var(--text-2)" strokeDasharray="3 3"
              label={{ value: "Data ends", position: "insideTopLeft", fill: "var(--text-2)", fontSize: 11 }} />
            {sellPoint && (
              <ReferenceLine x={sellingMonth} stroke="var(--brand)" strokeWidth={2}
                label={{ value: "Sell", position: "top", fill: "var(--brand-strong)", fontSize: 12, fontWeight: 700 }} />
            )}
            {peak && <ReferenceDot x={peak.month} y={peak.forecast} r={5} fill="var(--series-forecast)" stroke="#fff" strokeWidth={2}
              label={{ value: `Peak ${rupees(peak.forecast)}`, position: "top", fill: "var(--text-2)", fontSize: 11 }} />}
            {trough && trough !== peak && <ReferenceDot x={trough.month} y={trough.forecast} r={5} fill="var(--series-forecast)" stroke="#fff" strokeWidth={2}
              label={{ value: `Low ${rupees(trough.forecast)}`, position: "bottom", fill: "var(--text-2)", fontSize: 11 }} />}
            {sellPoint?.forecast != null && <ReferenceDot x={sellingMonth} y={sellPoint.forecast} r={7} fill="var(--brand)" stroke="#fff" strokeWidth={2} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <button type="button" className="btn-link small" onClick={() => setShowTable((s) => !s)}>
        {showTable ? "Hide" : "Show"} monthly table
      </button>
      {showTable && (
        <div className="table-wrap mt-2 max-h-72 overflow-y-auto">
          <table>
            <thead><tr><th>Month</th><th className="num">Mandi price</th><th className="num">Projected</th><th className="num">Likely range</th><th>Note</th></tr></thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.month}>
                  <td>{monthLabel(r.month)}</td>
                  <td className="num">{r.actual != null ? rupees(r.actual) : "—"}</td>
                  <td className="num">{r.forecast != null && !r.isOrigin ? rupees(r.forecast) : "—"}</td>
                  <td className="num">{r.band && !r.isOrigin ? `${rupees(r.band[0])} – ${rupees(r.band[1])}` : "—"}</td>
                  <td className="small">{r.tags.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
