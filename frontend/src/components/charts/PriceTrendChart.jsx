import { useMemo, useState } from "react";
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { daysBetween, fmtDate, rupees, shortDate } from "../../utils/format";

const ts = (iso) => Date.parse(`${iso}T00:00:00Z`);
const isoOf = (t) => new Date(t).toISOString().slice(0, 10);
const fmtTick = (t) => shortDate(isoOf(t));

function TrendTooltip({ active, payload, originDate, pastLabel }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const ahead = daysBetween(originDate, p.dateIso);
  const forecast = p.forecast ?? p.forecastWeak;
  return (
    <div className="chart-tooltip">
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        {fmtDate(p.dateIso)}
        {ahead > 0 && <span className="muted small"> · {ahead} day{ahead === 1 ? "" : "s"} ahead</span>}
        {p.isTarget && <span className="badge badge-brand" style={{ marginLeft: 6 }}>Your date</span>}
      </div>
      {p.past != null && !p.isOrigin && (
        <div className="t-row">
          <span className="swatch-line" style={{ borderColor: "var(--series-actual)" }} />
          {pastLabel}:&nbsp;<strong>{rupees(p.past)}</strong>
        </div>
      )}
      {p.actualAfter != null && (
        <div className="t-row">
          <span className="swatch-line" style={{ borderColor: "var(--series-actual)" }} />
          Actual price (known later):&nbsp;<strong>{rupees(p.actualAfter)}</strong>
        </div>
      )}
      {forecast != null && (
        <div className="t-row">
          <span className="swatch-dash" style={{ borderColor: p.isOrigin || p.forecast != null ? "var(--series-forecast)" : "var(--series-weak)" }} />
          {p.isOrigin ? "Starting price" : p.forecast != null ? "Predicted price" : "Predicted price (less reliable)"}:&nbsp;
          <strong>{rupees(forecast)}</strong>
        </div>
      )}
      {p.band && !p.isOrigin && (
        <div className="muted small">Likely range: {rupees(p.band[0])} – {rupees(p.band[1])} per quintal</div>
      )}
    </div>
  );
}

/**
 * Past prices (solid blue), the model's daily forecast (dashed orange, grey where the model was
 * not validated as better than "no change") with its likely range, and markers for today, the
 * farmer's selected date and the recommended selling date. Every point uses the date returned
 * by the API on a true time axis.
 */
export default function PriceTrendChart({
  history, historyIsReference, actualAfter, path, originDate, currentPrice, targetDate, recommendedDate,
}) {
  const [showTable, setShowTable] = useState(false);
  const pastLabel = historyIsReference ? "Last year, same week (+inflation)" : "Actual price";

  const { data, target, recommended, hasWeak } = useMemo(() => {
    const rows = new Map();
    const put = (iso, patch) => {
      const t = ts(iso);
      rows.set(t, { t, dateIso: iso, ...(rows.get(t) || {}), ...patch });
    };
    history.forEach((h) => put(h.date, { past: h.price }));
    actualAfter.forEach((a) => put(a.date, { actualAfter: a.price }));
    put(originDate, { past: currentPrice, band: [currentPrice, currentPrice], isOrigin: true });
    // validated dates go to "forecast", the others to "forecastWeak"; where the status changes,
    // the earlier point also gets the other key so the two dashed lines join up
    const pts = [{ date: originDate, price: currentPrice, ok: true },
      ...path.map((f) => ({ date: f.date, price: f.predicted_price, ok: f.beats_baseline, f }))];
    let weak = false;
    pts.forEach((p, i) => {
      const key = p.ok ? "forecast" : "forecastWeak";
      const patch = { [key]: p.price };
      if (p.f) Object.assign(patch, { band: [p.f.lower, p.f.upper], isTarget: p.date === targetDate });
      if (i > 0 && pts[i - 1].ok !== p.ok) put(pts[i - 1].date, { [key]: pts[i - 1].price });
      if (!p.ok) weak = true;
      put(p.date, patch);
    });
    const byDate = Object.fromEntries(path.map((f) => [f.date, f]));
    return {
      data: [...rows.values()].sort((a, b) => a.t - b.t),
      target: byDate[targetDate],
      recommended: recommendedDate && recommendedDate !== targetDate ? byDate[recommendedDate] : null,
      hasWeak: weak,
    };
  }, [history, actualAfter, path, originDate, currentPrice, targetDate, recommendedDate]);

  return (
    <div>
      <div className="legend" style={{ marginBottom: 8 }}>
        <span><span className="swatch-line" style={{ borderColor: "var(--series-actual)" }} />{pastLabel}</span>
        <span><span className="swatch-dash" style={{ borderColor: "var(--series-forecast)" }} />Predicted price</span>
        {hasWeak && <span><span className="swatch-dash" style={{ borderColor: "var(--series-weak)" }} />Less reliable prediction</span>}
        <span><span className="swatch" style={{ background: "var(--series-forecast)", opacity: 0.25 }} />Likely range</span>
        <span><span className="swatch-vline" style={{ borderColor: "var(--brand)" }} />Your selected date</span>
        {recommended && <span><span className="swatch-dot" style={{ background: "var(--good)" }} />Suggested selling date</span>}
      </div>
      <div className="chart-box">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 24, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="var(--grid)" />
            <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]}
              tickFormatter={fmtTick} stroke="var(--axis)" tick={{ fill: "var(--muted)", fontSize: 12 }} minTickGap={24} />
            <YAxis tickFormatter={(v) => `₹${Math.round(v).toLocaleString("en-IN")}`} stroke="var(--axis)" width={70}
              tick={{ fill: "var(--muted)", fontSize: 12 }} domain={["auto", "auto"]}
              label={{ value: "₹ per quintal", angle: -90, position: "insideLeft", offset: 10, fill: "var(--muted)", fontSize: 12, dy: 40 }} />
            <Tooltip content={<TrendTooltip originDate={originDate} pastLabel={pastLabel} />}
              cursor={{ stroke: "var(--axis)", strokeWidth: 1 }} />
            <Area dataKey="band" stroke="none" fill="var(--series-forecast)" fillOpacity={0.14}
              connectNulls isAnimationActive={false} activeDot={false} />
            <Line dataKey="past" stroke="var(--series-actual)" strokeWidth={2} dot={false}
              connectNulls isAnimationActive={false} activeDot={{ r: 4 }} />
            <Line dataKey="actualAfter" stroke="var(--series-actual)" strokeWidth={2} strokeOpacity={0.55} dot={false}
              connectNulls isAnimationActive={false} activeDot={{ r: 4 }} />
            <Line dataKey="forecast" stroke="var(--series-forecast)" strokeWidth={2.5} strokeDasharray="6 4" dot={false}
              connectNulls={false} isAnimationActive={false} activeDot={{ r: 5 }} />
            <Line dataKey="forecastWeak" stroke="var(--series-weak)" strokeWidth={2} strokeDasharray="2 4" dot={false}
              connectNulls={false} isAnimationActive={false} activeDot={{ r: 5 }} />
            <ReferenceLine x={ts(originDate)} stroke="var(--text-2)" strokeDasharray="3 3"
              label={{ value: "Today", position: "top", fill: "var(--text-2)", fontSize: 12 }} />
            {target && (
              <ReferenceLine x={ts(target.date)} stroke="var(--brand)" strokeWidth={2}
                label={{ value: "Your date", position: "top", fill: "var(--brand)", fontSize: 12, fontWeight: 700 }} />
            )}
            {target && (
              <ReferenceDot x={ts(target.date)} y={target.predicted_price} r={7} fill="var(--brand)" stroke="#fff" strokeWidth={2}
                label={{ value: rupees(target.predicted_price), position: "right", fill: "var(--brand-strong)", fontSize: 12, fontWeight: 700 }} />
            )}
            {recommended && (
              <ReferenceDot x={ts(recommended.date)} y={recommended.predicted_price} r={7} fill="var(--good)" stroke="#fff" strokeWidth={2}
                label={{ value: "Suggested", position: "top", fill: "var(--good-text)", fontSize: 12, fontWeight: 700 }} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {actualAfter.length > 0 && (
        <p className="muted small" style={{ marginTop: 6 }}>
          The lighter blue line after today shows prices that actually happened (this forecast starts inside the
          dataset), so you can compare the model with reality.
        </p>
      )}
      <button type="button" className="btn-link small" onClick={() => setShowTable((s) => !s)}>
        {showTable ? "Hide" : "Show"} daily forecast table
      </button>
      {showTable && (
        <div className="table-wrap" style={{ marginTop: 8, maxHeight: 360 }}>
          <table>
            <thead>
              <tr><th>Date</th><th className="num">Days ahead</th><th className="num">Predicted price</th>
                <th className="num">Likely range</th><th>Reliability</th>
                {actualAfter.length > 0 && <th className="num">Actual</th>}</tr>
            </thead>
            <tbody>
              {path.map((f) => (
                <tr key={f.date} className={f.date === targetDate ? "row-highlight" : undefined}>
                  <td>{fmtDate(f.date)}{f.date === targetDate && <span className="badge badge-brand" style={{ marginLeft: 6 }}>Your date</span>}</td>
                  <td className="num">{f.horizon_days}</td>
                  <td className="num">{rupees(f.predicted_price)}</td>
                  <td className="num">{rupees(f.lower)} – {rupees(f.upper)}</td>
                  <td>{f.beats_baseline ? "Validated" : "Less reliable"}</td>
                  {actualAfter.length > 0 && <td className="num">{f.actual_price == null ? "—" : rupees(f.actual_price)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
