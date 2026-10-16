import { useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { PHOTOS } from "../CropArt";
import { useNarrow } from "../../hooks/useNarrow";
import { useT } from "../../i18n/LanguageContext";
import { compactRupees, rupees, signedRupees } from "../../utils/format";

const POS_INK = "#1f2937", NEG_INK = "#b91c1c";
const MARGIN = { top: 4, right: 72, bottom: 4, left: 4 };
const LABEL_PAD = 8;

/** Evenly spaced "nice" ticks that always include 0; the loss side gets 25% extra room for its label. */
function niceAxis(values) {
  const lo = Math.min(0, ...values) * 1.25, hi = Math.max(0, ...values);
  const raw = (hi - lo) / 6 || 1, mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const start = Math.floor(lo / step) * step, end = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v));
  return { domain: [start, end], ticks };
}
const axisRupees = (v) => (v === 0 ? "0" : compactRupees(v).replace("₹", ""));

function ProfitTooltip({ active, payload }) {
  const t = useT();
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tooltip" style={{ maxWidth: 290 }}>
      <div className="mb-1 font-semibold">{d.name}</div>
      {!d.feasible ? <div className="text-ink-2">{t(`cr.timing.${d.timing}`)}</div> : (
        <>
          <div className="t-row"><span className="swatch" style={{ background: "var(--series-actual)" }} />{t("cr.chart.sales")}:&nbsp;<strong>{rupees(d.revenue)}</strong></div>
          <div className="t-row"><span className="swatch" style={{ background: "var(--series-reference)" }} />{t("cr.chart.costs")}:&nbsp;<strong>{rupees(d.cost)}</strong></div>
          <div className="t-row"><span className="swatch" style={{ background: d.profit < 0 ? "var(--profit-neg)" : "var(--profit-pos)" }} />
            {d.profit < 0 ? t("cr.chart.loss") : t("cr.chart.profit")}:&nbsp;<strong>{signedRupees(d.profit)}</strong></div>
          <div className="muted small">{t("cr.chart.tipLine", { price: rupees(d.price), roi: `${d.roi > 0 ? "+" : ""}${Math.round(d.roi)}%` })}</div>
        </>
      )}
      <div className="muted small mt-1">{t("cr.chart.tipEstimate")}</div>
    </div>
  );
}

/**
 * Estimated net profit of every crop for the chosen selling month. Profit extends right, loss left of
 * the zero line; the optional breakdown adds total sales and total costs as separate bars.
 * Crops that cannot be sold in the chosen month have no bar (their profit would be meaningless).
 */
export default function ProfitComparisonChart({ rows, selected, onSelect }) {
  const t = useT();
  const narrow = useNarrow();
  const tiny = useNarrow(480);
  const [breakdown, setBreakdown] = useState(false);
  const data = rows.map((r) => ({
    crop: r.crop, name: r.name, feasible: r.feasible, timing: r.timing, price: r.price, roi: r.roi,
    revenue: r.feasible ? r.revenue : null, cost: r.feasible ? r.cost : null, profit: r.feasible ? r.profit : null,
    label: r.feasible ? r.name : `${r.name} ✕`,
  })).sort((a, b) => (b.profit ?? -Infinity) - (a.profit ?? -Infinity));
  const rowH = breakdown ? 74 : 44;
  const { domain, ticks } = niceAxis(data.map((d) => d.profit).filter((v) => v != null));
  const nameW = tiny ? 84 : narrow ? 104 : 110;
  const plotLeft = MARGIN.left + nameW;
  const select = (d) => d && onSelect?.(d.crop);

  const Tick = ({ x, y, payload }) => {
    const d = data.find((r) => r.label === payload.value);
    const src = d && PHOTOS[d.crop];
    const sel = d?.crop === selected;
    return (
      <g>
        {src && !tiny && <image href={src} x={x - nameW} y={y - 10} width={20} height={20} preserveAspectRatio="xMidYMid slice" />}
        <text x={x - 8} y={y} dy={4} textAnchor="end" fontSize={narrow ? 11 : 12.5} fontWeight={sel ? 700 : 500} fill="var(--text)">{payload.value}</text>
      </g>
    );
  };

  // One value label per bar: right of profit bars; for losses, left of the bar end inside the plot
  // area, or right of the zero line when the gap to the name column is too small.
  const ValueLabel = ({ x, y, width, height, value }) => {
    if (value == null) return null;
    const loss = value < 0, text = compactRupees(value), textW = text.length * 7.6;
    const left = Math.min(x, x + width), right = Math.max(x, x + width);
    let lx, anchor;
    if (!loss) { lx = right + LABEL_PAD; anchor = "start"; }
    else if (left - plotLeft >= textW + LABEL_PAD) { lx = left - LABEL_PAD; anchor = "end"; }
    else { lx = right + LABEL_PAD; anchor = "start"; }
    return (
      <text x={lx} y={y + height / 2} dy={4.5} textAnchor={anchor} fontSize={13} fontWeight={600} stroke="none"
        fill={loss ? NEG_INK : POS_INK} style={{ fontVariantNumeric: "tabular-nums" }}>{text}</text>
    );
  };

  return (
    <div>
      <div className="legend mb-2" aria-hidden="true">
        {breakdown && <>
          <span><span className="swatch" style={{ background: "var(--series-actual)" }} />{t("cr.chart.sales")}</span>
          <span><span className="swatch" style={{ background: "var(--series-reference)" }} />{t("cr.chart.costs")}</span>
        </>}
        <span><span className="swatch" style={{ background: "var(--profit-pos)" }} />{t("cr.chart.profit")}</span>
        <span><span className="swatch" style={{ background: "var(--profit-neg)" }} />{t("cr.chart.loss")}</span>
        <span className="text-ink-muted">{t("cr.chart.notPossible")}</span>
      </div>
      <div style={{ width: "100%", height: data.length * rowH + 44 }} role="img" aria-label={t("cr.chart.aria")}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ ...MARGIN, right: narrow ? 56 : MARGIN.right }}
            barCategoryGap={10} barGap={2} onClick={(e) => e?.activePayload && select(e.activePayload[0].payload)}>
            <CartesianGrid stroke="var(--grid)" horizontal={false} />
            <XAxis type="number" tickFormatter={axisRupees} stroke="var(--axis)" tick={{ fill: "var(--muted)", fontSize: narrow ? 11 : 12 }}
              domain={domain} ticks={ticks} interval={0} allowDataOverflow />
            <YAxis type="category" dataKey="label" width={nameW} stroke="var(--axis)" tick={<Tick />} />
            <Tooltip content={<ProfitTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
            <ReferenceLine x={0} stroke="#374151" strokeWidth={1.5} />
            {breakdown && <Bar dataKey="revenue" fill="var(--series-actual)" radius={3} maxBarSize={14} isAnimationActive={false} cursor="pointer" onClick={select} />}
            {breakdown && <Bar dataKey="cost" fill="var(--series-reference)" radius={3} maxBarSize={14} isAnimationActive={false} cursor="pointer" onClick={select} />}
            <Bar dataKey="profit" radius={3} maxBarSize={breakdown ? 14 : 22} isAnimationActive={false} cursor="pointer" onClick={select}>
              {data.map((d) => <Cell key={d.crop} fill={(d.profit ?? 0) < 0 ? "var(--profit-neg)" : "var(--profit-pos)"}
                stroke={d.crop === selected ? "var(--text)" : "none"} strokeWidth={2} />)}
              <LabelList dataKey="profit" content={<ValueLabel />} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <button type="button" className="btn-link small" onClick={() => setBreakdown((s) => !s)} aria-pressed={breakdown}>
        {breakdown ? t("cr.chart.hideBreakdown") : t("cr.chart.showBreakdown")}
      </button>
    </div>
  );
}
