import { useMemo, useState } from "react";
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { ChartSummary } from "../ChartIntro";
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
          {t("crop.priceChart.tooltipActual")}:&nbsp;<strong>{rupees(p.actual)}</strong></div>
      )}
      {p.forecast != null && !p.isOrigin && (
        <>
          <div className="t-row"><span className="swatch-dash" style={{ borderColor: "var(--series-forecast)" }} />
            {t("crop.priceChart.projected")}:&nbsp;<strong>{rupees(p.forecast)}</strong></div>
          <div className="muted small">{t("price.chart.rangeTooltip", { low: rupees(p.band[0]), high: rupees(p.band[1]) })}</div>
        </>
      )}
      {p.tags.length > 0 && <div className="mt-1 text-xs font-semibold text-ink-2">{p.tags.map((k) => t(k)).join(" · ")}</div>}
    </div>
  );
}

/**
 * Monthly mandi prices (solid blue) and the XGBoost projection up to the selling month
 * (dashed orange + shaded 10–90% range). Peak, low and selling month are marked and labelled.
 */
export default function MonthlyPriceChart({ market, sellingMonth, optimalMonth }) {
  const t = useT();
  const narrow = useNarrow();
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
    // tags hold dictionary keys; they are translated where they are shown
    if (pk) pk.tags.push("crop.priceChart.tagPeak");
    if (tr && tr !== pk) tr.tags.push("crop.priceChart.tagLow");
    const sp = rows.get(sellingMonth);
    if (sp) sp.tags.push("crop.priceChart.tagSell");
    if (optimalMonth && optimalMonth !== sellingMonth && rows.get(optimalMonth)) rows.get(optimalMonth).tags.push("crop.priceChart.tagBest");
    return { data: all, peak: pk, trough: tr, sellPoint: sp };
  }, [market, sellingMonth, optimalMonth]);

  return (
    <div>
      <div className="legend mb-2">
        <span><span className="swatch-line" style={{ borderColor: "var(--series-actual)" }} />{t("crop.priceChart.actual")}</span>
        <span><span className="swatch-dash" style={{ borderColor: "var(--series-forecast)" }} />{t("crop.priceChart.projected")}</span>
        <span><span className="swatch" style={{ background: "var(--series-forecast)", opacity: 0.25 }} />{t("crop.priceChart.range")}</span>
      </div>
      <div style={{ width: "100%", height: narrow ? 280 : 320 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 28, right: narrow ? 12 : 24, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="month" tickFormatter={monthLabel} stroke="var(--axis)" interval="preserveStartEnd"
              tick={{ fill: "var(--muted)", fontSize: narrow ? 11 : 12 }} minTickGap={narrow ? 32 : 24} />
            <YAxis tickFormatter={(v) => `₹${Math.round(v)}`} stroke="var(--axis)" width={narrow ? 56 : 66}
              tick={{ fill: "var(--muted)", fontSize: narrow ? 11 : 12 }} domain={[0, "auto"]}
              label={{ value: t("unit.rsPerQuintal"), angle: -90, position: "insideLeft", offset: 8, fill: "var(--muted)", fontSize: 12, dy: 40 }} />
            <Tooltip content={<PriceTooltip />} cursor={{ stroke: "var(--axis)", strokeWidth: 1 }} />
            <Area dataKey="band" stroke="none" fill="var(--series-forecast)" fillOpacity={0.14}
              connectNulls isAnimationActive={false} activeDot={false} />
            <Line dataKey="actual" stroke="var(--series-actual)" strokeWidth={2} dot={false}
              connectNulls isAnimationActive={false} activeDot={{ r: 4 }} />
            <Line dataKey="forecast" stroke="var(--series-forecast)" strokeWidth={2} strokeDasharray="6 4"
              dot={false} connectNulls isAnimationActive={false} activeDot={{ r: 5 }} />
            <ReferenceLine x={market.latest_month} stroke="var(--text-2)" strokeDasharray="3 3"
              label={{ value: t("crop.priceChart.dataEnds"), position: "insideTopLeft", fill: "var(--text-2)", fontSize: 11 }} />
            {sellPoint && (
              <ReferenceLine x={sellingMonth} stroke="var(--brand)" strokeWidth={2}
                label={{ value: t("crop.priceChart.sell"), position: "top", fill: "var(--brand-strong)", fontSize: 12, fontWeight: 700 }} />
            )}
            {/* on phones the peak/low dots keep their colour but drop the text labels to avoid overlap */}
            {peak && <ReferenceDot x={peak.month} y={peak.forecast} r={5} fill="var(--series-forecast)" stroke="#fff" strokeWidth={2}
              label={narrow ? undefined : { value: t("crop.priceChart.peakLabel", { price: rupees(peak.forecast) }), position: "top", fill: "var(--text-2)", fontSize: 11 }} />}
            {trough && trough !== peak && <ReferenceDot x={trough.month} y={trough.forecast} r={5} fill="var(--series-forecast)" stroke="#fff" strokeWidth={2}
              label={narrow ? undefined : { value: t("crop.priceChart.lowLabel", { price: rupees(trough.forecast) }), position: "bottom", fill: "var(--text-2)", fontSize: 11 }} />}
            {sellPoint?.forecast != null && <ReferenceDot x={sellingMonth} y={sellPoint.forecast} r={7} fill="var(--brand)" stroke="#fff" strokeWidth={2} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {sellPoint?.forecast != null && !sellPoint.isOrigin && (
        <ChartSummary>
          {t("crop.priceChart.summary", {
            month: monthLabel(sellingMonth), price: rupees(sellPoint.forecast),
            low: rupees(sellPoint.band[0]), high: rupees(sellPoint.band[1]), dataEnd: monthLabel(market.latest_month),
          })}
          {peak && peak !== sellPoint && <> {t("crop.priceChart.summaryPeak", { price: rupees(peak.forecast), month: monthLabel(peak.month) })}</>}
        </ChartSummary>
      )}
      <button type="button" className="btn-link small" onClick={() => setShowTable((s) => !s)} aria-expanded={showTable}>
        {showTable ? t("crop.priceChart.hideTable") : t("crop.priceChart.showTable")}
      </button>
      {showTable && (
        <div className="table-wrap mt-2 max-h-72 overflow-y-auto">
          <table>
            <thead><tr><th>{t("table.month")}</th><th className="num">{t("table.mandiPrice")}</th><th className="num">{t("table.projected")}</th>
              <th className="num">{t("table.likelyRange")}</th><th>{t("table.note")}</th></tr></thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.month}>
                  <td>{monthLabel(r.month)}</td>
                  <td className="num">{r.actual != null ? rupees(r.actual) : "—"}</td>
                  <td className="num">{r.forecast != null && !r.isOrigin ? rupees(r.forecast) : "—"}</td>
                  <td className="num">{r.band && !r.isOrigin ? `${rupees(r.band[0])} – ${rupees(r.band[1])}` : "—"}</td>
                  <td className="small">{r.tags.map((k) => t(k)).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
