import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip,
  XAxis, YAxis,
} from "recharts";
import { useNarrow } from "../../hooks/useNarrow";

/**
 * Horizontal diverging bars for SHAP contributions.
 * Blue = pushes up / supports; red = pulls down / against. Every bar carries a signed value
 * label so the meaning never depends on colour alone.
 */
export default function DivergingBarChart({ items, valueKey, labelKey, format, tooltip, posLabel, negLabel, labelWidth = 220 }) {
  const data = items.map((d) => ({ ...d, _v: d[valueKey], _l: d[labelKey] }));
  const height = Math.max(160, data.length * 38 + 30);
  const narrow = useNarrow();
  const yWidth = narrow ? Math.min(labelWidth, 118) : labelWidth;
  // headroom on each side that has bars, so the outside value labels never hit the axis labels
  const lo = Math.min(0, ...data.map((d) => d._v)), hi = Math.max(0, ...data.map((d) => d._v));
  const pad = (hi - lo || 1) * (narrow ? 0.3 : 0.16);
  const domain = [lo < 0 ? lo - pad : 0, hi > 0 ? hi + pad : 0];
  const renderLabel = ({ x, y, width, height: h, value }) => {
    const left = Math.min(x, x + width), right = Math.max(x, x + width);
    const neg = value < 0;
    return (
      <text x={neg ? left - 4 : right + 4} y={y + h / 2} dy={4} textAnchor={neg ? "end" : "start"}
        fontSize={12} fill="var(--text-2)">{format(value)}</text>
    );
  };
  return (
    <div>
      <div className="legend" style={{ marginBottom: 6 }}>
        <span><span className="swatch" style={{ background: "var(--pos)" }} />{posLabel}</span>
        <span><span className="swatch" style={{ background: "var(--neg)" }} />{negLabel}</span>
      </div>
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 4 }} barCategoryGap={8}>
            <CartesianGrid stroke="var(--grid)" horizontal={false} />
            <XAxis type="number" tickFormatter={format} stroke="var(--axis)"
              tick={{ fill: "var(--muted)", fontSize: 12 }}
              domain={domain} allowDataOverflow tickCount={5} />
            <YAxis type="category" dataKey="_l" width={yWidth} stroke="var(--axis)"
              tick={{ fill: "var(--text-2)", fontSize: narrow ? 11 : 12 }} />
            <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }}
              content={({ active, payload }) => (active && payload?.length
                ? <div className="chart-tooltip" style={{ maxWidth: 320 }}>{tooltip(payload[0].payload)}</div>
                : null)} />
            <ReferenceLine x={0} stroke="var(--axis)" />
            <Bar dataKey="_v" radius={4} maxBarSize={22} isAnimationActive={false}>
              {data.map((d, i) => <Cell key={i} fill={d._v >= 0 ? "var(--pos)" : "var(--neg)"} />)}
              <LabelList dataKey="_v" content={renderLabel} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
