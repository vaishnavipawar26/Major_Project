import { useState } from "react";
import {
  Bar, BarChart, CartesianGrid, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { compactRupees, rupees, signedRupees } from "../../utils/format";

function ProfitTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tooltip" style={{ maxWidth: 300 }}>
      <div className="mb-1 font-semibold">{d.crop}{d.recommended ? " (recommended)" : ""}</div>
      {!d.feasible ? <div className="text-ink-2">Not feasible for this selling month ({d.statusText}).</div> : null}
      <div className="t-row"><span className="swatch" style={{ background: "var(--series-actual)" }} />Revenue:&nbsp;<strong>{rupees(d.revenue)}</strong></div>
      <div className="t-row"><span className="swatch" style={{ background: "var(--series-forecast)" }} />Net profit:&nbsp;<strong>{signedRupees(d.profit)}</strong></div>
      <div className="muted small">Total cost {rupees(d.cost)} · ROI {d.roi > 0 ? "+" : ""}{d.roi}%</div>
      <div className="muted small">Price {rupees(d.price)}/q · likely profit {signedRupees(d.low)} to {signedRupees(d.high)}</div>
    </div>
  );
}

const STATUS_TEXT = { not_ready: "not ready yet", spoiled: "would spoil before then", fresh: "harvest-ready", stored: "sold from storage" };

/**
 * Revenue vs net profit for every crop at the chosen selling month (one ₹ axis, both bars
 * share it). Profit bars carry signed value labels, so a loss is never shown by colour alone.
 */
export default function ProfitComparisonChart({ results, selected, onSelect }) {
  const [showTable, setShowTable] = useState(false);
  const data = results.filter((r) => r.economics).map((r) => ({
    crop: r.crop_name, label: `${r.crop_name}${r.recommended ? " *" : ""}${r.feasible ? "" : " (n/a)"}`,
    revenue: r.economics.gross_revenue, profit: r.economics.net_profit, cost: r.economics.total_cost,
    roi: r.economics.roi_pct, price: r.economics.selling_price, low: r.economics.net_profit_low,
    high: r.economics.net_profit_high, feasible: r.feasible, recommended: r.recommended,
    statusText: STATUS_TEXT[r.economics.status],
  })).sort((a, b) => b.profit - a.profit);

  return (
    <div>
      <div className="legend mb-2">
        <span><span className="swatch" style={{ background: "var(--series-actual)" }} />Gross revenue</span>
        <span><span className="swatch" style={{ background: "var(--series-forecast)" }} />Net profit (after all costs)</span>
        <span className="text-ink-muted">* recommended · (n/a) can't be sold that month</span>
      </div>
      <div style={{ width: "100%", height: data.length * 58 + 40 }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 4 }}
            barCategoryGap={10} barGap={2} onClick={(e) => e?.activePayload && onSelect?.(e.activePayload[0].payload.crop)}>
            <CartesianGrid stroke="var(--grid)" horizontal={false} />
            <XAxis type="number" tickFormatter={compactRupees} stroke="var(--axis)" tick={{ fill: "var(--muted)", fontSize: 12 }}
              domain={[(min) => Math.min(min, 0), "auto"]} />
            <YAxis type="category" dataKey="label" width={118} stroke="var(--axis)"
              tick={({ x, y, payload }) => (
                <text x={x - 4} y={y} dy={4} textAnchor="end" fontSize={12}
                  fontWeight={data.find((d) => d.label === payload.value)?.crop === selected ? 700 : 400}
                  fill="var(--text-2)">{payload.value}</text>
              )} />
            <Tooltip content={<ProfitTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
            <ReferenceLine x={0} stroke="var(--axis)" />
            <Bar dataKey="revenue" fill="var(--series-actual)" radius={4} maxBarSize={16} isAnimationActive={false} cursor="pointer" />
            <Bar dataKey="profit" fill="var(--series-forecast)" radius={4} maxBarSize={16} isAnimationActive={false} cursor="pointer">
              <LabelList dataKey="profit" position="right" formatter={compactRupees} style={{ fill: "var(--text-2)", fontSize: 12, fontWeight: 600 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <button type="button" className="btn-link small" onClick={() => setShowTable((s) => !s)}>
        {showTable ? "Hide" : "Show"} comparison table
      </button>
      {showTable && (
        <div className="table-wrap mt-2">
          <table>
            <thead><tr><th>Crop</th><th className="num">Price /q</th><th className="num">Revenue</th>
              <th className="num">Total cost</th><th className="num">Net profit</th><th className="num">ROI</th><th>Timing</th></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.crop}>
                  <td>{d.label}</td><td className="num">{rupees(d.price)}</td><td className="num">{rupees(d.revenue)}</td>
                  <td className="num">{rupees(d.cost)}</td><td className="num">{signedRupees(d.profit)}</td>
                  <td className="num">{d.roi > 0 ? "+" : ""}{d.roi}%</td><td>{d.statusText}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
