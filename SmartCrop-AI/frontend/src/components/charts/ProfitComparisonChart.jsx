import { useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ChartSummary } from "../ChartIntro";
import { useNarrow } from "../../hooks/useNarrow";
import { useT } from "../../i18n/LanguageContext";
import { compactRupees, cropName, rupees, signedRupees } from "../../utils/format";

function ProfitTooltip({ active, payload }) {
  const t = useT();
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tooltip" style={{ maxWidth: 300 }}>
      <div className="mb-1 font-semibold">{d.name}{d.recommended ? ` (${t("crop.profitChart.recommended")})` : ""}</div>
      {!d.feasible ? <div className="text-ink-2">{t("crop.profitChart.notFeasible", { status: t(d.statusKey) })}</div> : null}
      <div className="t-row"><span className="swatch" style={{ background: "var(--series-actual)" }} />{t("crop.profitChart.revenue")}:&nbsp;<strong>{rupees(d.revenue)}</strong></div>
      <div className="t-row"><span className="swatch" style={{ background: "var(--series-forecast)" }} />{t("crop.profitChart.profit")}:&nbsp;<strong>{signedRupees(d.profit)}</strong></div>
      <div className="muted small">{t("crop.profitChart.costLine", { cost: rupees(d.cost), roi: `${d.roi > 0 ? "+" : ""}${d.roi}%` })}</div>
      <div className="muted small">{t("crop.profitChart.priceLine", { price: rupees(d.price), low: signedRupees(d.low), high: signedRupees(d.high) })}</div>
    </div>
  );
}

const STATUS_KEY = { not_ready: "crop.status.notReady", spoiled: "crop.status.spoiled", fresh: "crop.status.fresh", stored: "crop.status.stored" };

/**
 * Revenue vs net profit for every crop at the chosen selling month (one ₹ axis, both bars
 * share it). Profit bars carry signed value labels, so a loss is never shown by colour alone.
 */
export default function ProfitComparisonChart({ results, selected, onSelect }) {
  const t = useT();
  const narrow = useNarrow();
  const [showTable, setShowTable] = useState(false);
  // ★ marks a recommended crop, ✕ a crop that cannot be sold in the chosen month (explained in the legend)
  const data = results.filter((r) => r.economics).map((r) => ({
    crop: r.crop_name, name: cropName(t, r.crop_name), label: `${cropName(t, r.crop_name)}${r.recommended ? " ★" : ""}${r.feasible ? "" : " ✕"}`,
    revenue: r.economics.gross_revenue, profit: r.economics.net_profit, cost: r.economics.total_cost,
    roi: r.economics.roi_pct, price: r.economics.selling_price, low: r.economics.net_profit_low,
    high: r.economics.net_profit_high, feasible: r.feasible, recommended: r.recommended,
    statusKey: STATUS_KEY[r.economics.status],
  })).sort((a, b) => b.profit - a.profit);
  const best = data[0];
  const losses = data.filter((d) => d.profit < 0).length;

  return (
    <div>
      <div className="legend mb-2">
        <span><span className="swatch" style={{ background: "var(--series-actual)" }} />{t("crop.profitChart.revenueLegend")}</span>
        <span><span className="swatch" style={{ background: "var(--profit-pos)" }} />{t("crop.profitChart.profitLegend")}</span>
        <span><span className="swatch" style={{ background: "var(--profit-neg)" }} />{t("crop.profitChart.lossLegend")}</span>
        <span className="text-ink-muted">{t("crop.profitChart.marks")}</span>
      </div>
      <div style={{ width: "100%", height: data.length * 58 + 40 }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: narrow ? 52 : 64, bottom: 4, left: 4 }}
            barCategoryGap={10} barGap={2} onClick={(e) => e?.activePayload && onSelect?.(e.activePayload[0].payload.crop)}>
            <CartesianGrid stroke="var(--grid)" horizontal={false} />
            <XAxis type="number" tickFormatter={compactRupees} stroke="var(--axis)" tick={{ fill: "var(--muted)", fontSize: narrow ? 11 : 12 }}
              domain={[(min) => Math.min(min, 0), "auto"]} />
            <YAxis type="category" dataKey="label" width={narrow ? 100 : 118} stroke="var(--axis)"
              tick={({ x, y, payload }) => (
                <text x={x - 4} y={y} dy={4} textAnchor="end" fontSize={narrow ? 11 : 12}
                  fontWeight={data.find((d) => d.label === payload.value)?.crop === selected ? 700 : 400}
                  fill="var(--text-2)">{payload.value}</text>
              )} />
            <Tooltip content={<ProfitTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
            <ReferenceLine x={0} stroke="var(--axis)" />
            <Bar dataKey="revenue" fill="var(--series-actual)" radius={4} maxBarSize={16} isAnimationActive={false} cursor="pointer" />
            <Bar dataKey="profit" fill="var(--profit-pos)" radius={4} maxBarSize={16} isAnimationActive={false} cursor="pointer">
              {/* green = expected profit, red = expected loss; the signed value label says the same in text */}
              {data.map((d) => <Cell key={d.crop} fill={d.profit < 0 ? "var(--profit-neg)" : "var(--profit-pos)"} />)}
              <LabelList dataKey="profit" position="right" formatter={compactRupees} style={{ fill: "var(--text-2)", fontSize: 12, fontWeight: 600 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {best && (
        <ChartSummary>
          {t("crop.profitChart.summaryBest", { crop: best.name, profit: signedRupees(best.profit) })}{" "}
          {losses ? t("crop.profitChart.summaryLosses", { n: losses, total: data.length }) : t("crop.profitChart.summaryNoLoss")}
        </ChartSummary>
      )}
      <button type="button" className="btn-link small" onClick={() => setShowTable((s) => !s)} aria-expanded={showTable}>
        {showTable ? t("crop.profitChart.hideTable") : t("crop.profitChart.showTable")}
      </button>
      {showTable && (
        <div className="table-wrap mt-2">
          <table>
            <thead><tr><th>{t("table.crop")}</th><th className="num">{t("table.pricePerQ")}</th><th className="num">{t("table.revenue")}</th>
              <th className="num">{t("table.totalCost")}</th><th className="num">{t("table.netProfit")}</th>
              <th className="num">{t("table.returnOnCost")}</th><th>{t("table.timing")}</th></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.crop}>
                  <td>{d.label}</td><td className="num">{rupees(d.price)}</td><td className="num">{rupees(d.revenue)}</td>
                  <td className="num">{rupees(d.cost)}</td><td className="num">{signedRupees(d.profit)}</td>
                  <td className="num">{d.roi > 0 ? "+" : ""}{d.roi}%</td><td>{t(d.statusKey)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
