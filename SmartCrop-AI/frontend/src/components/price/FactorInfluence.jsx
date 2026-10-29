import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useNarrow } from "../../hooks/useNarrow";
import { useT } from "../../i18n/LanguageContext";
import { availability } from "../../utils/factorWeights";
import { rupees } from "../../utils/format";
import { modelContributions, scalePct, whyLines } from "./factorModel";

const UP = "#174D35", DOWN = "#C8642B", EMPTY_LINE = "#8a9a8a";
// farm-guidance columns: light green tint, green dashed border and green text (tokens in index.css)
const GUIDE = { fill: "var(--guide-fill)", line: "var(--guide-line)", text: "var(--guide-text)", text2: "var(--guide-text-2)" };
const MODEL = ["season", "crop_market"];
const GUIDANCE = ["temperature", "humidity", "soil", "ph", "location"];

/** X-axis label wrapped onto at most two lines (desktop); on phones the chart angles the full label instead. */
function Tick({ x, y, payload, index, rupee }) {
  const words = String(payload.value).split(" ");
  const mid = Math.ceil(words.length / 2);
  const lines = words.length > 1 ? [words.slice(0, mid).join(" "), words.slice(mid).join(" ")] : words;
  const money = rupee?.(index);
  return (
    <g>
      <text x={x} y={y + 12} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--text-2)">
        {lines.map((l, i) => <tspan key={i} x={x} dy={i === 0 ? 0 : 14}>{l}</tspan>)}
      </text>
      {money && <text x={x} y={y + 12 + lines.length * 14 + 2} textAnchor="middle" fontSize={11.5} fontWeight={700} fill={money.color}
        data-testid={`fi-rupee-${money.id}`}>{money.text}</text>}
    </g>
  );
}

/** Words of `text` packed into lines of at most `max` characters (a long word keeps its own line). */
function wrap(text, max) {
  const out = [];
  for (const word of String(text).split(" ")) {
    const last = out[out.length - 1];
    if (last && (last + " " + word).length <= max) out[out.length - 1] = `${last} ${word}`;
    else out.push(word);
  }
  return out;
}

/** Tooltip lines: for a model factor the same two lines as its "Why these factors matter" card ("In past years, Onion prices around this
 *  time of year were above average." + "So the model adds ₹53 per quintal."); a model factor whose share cannot be calculated, or a factor
 *  that is shown as farm guidance, says so in one line (a guidance value shown on its own scale says where it sits on that scale). */
export const effectLines = (t, d, ctx) => (d.kind === "model"
  ? whyLines(t, d.id, d.inr, ctx)
  : [t(d.kind === "unavailable" ? "fi.tip.unavailable" : d.scale != null ? "fi.tip.scale" : "fi.tip.guidance")]);
export const effectText = (t, d, ctx) => effectLines(t, d, ctx).join(" ");

function Tip({ active, payload, t, ctx }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tooltip inf-tip" data-testid="fi-tooltip">
      <p className="inf-tip-name">{d.label}</p>
      {effectLines(t, d, ctx).map((l, i) => <p key={i} className="inf-tip-text">{l}</p>)}
    </div>
  );
}

/**
 * "What Influences Your Predicted Price?": the seven factors in one column chart, in a fixed order. Season and crop/market are the price
 * model's own inputs: their bars are each one's SHARE of the model's total movement, |contribution| / (|season| + |crop/market|) x 100, from
 * the explanation's SHAP values in rupees per quintal (green when it pushes the price up, orange when it pulls it down). When either value is
 * missing or both are 0, no share is calculated and the two columns say "Contribution unavailable". Weather, soil and the growing location are
 * not model inputs: their columns are full-height light green frames (never sized by a value, never on the share axis) with the real
 * value inside and, where one is meaningful, where it sits on its own scale ("% of scale, not influence"); the values are also chips below,
 * labelled "Farm guidance".
 */
export default function FactorInfluence({ exp, crop, weather, soil, growing, market }) {
  const t = useT();
  const narrow = useNarrow();
  const av = availability({ weather, soil, growing, market });
  const mc = modelContributions(exp);
  const total = Math.abs(mc.season ?? 0) + Math.abs(mc.crop_market ?? 0);
  const shareOk = mc.season != null && mc.crop_market != null && total > 0;
  const w = weather?.data;
  // a guidance value's place on its own scale (humidity, pH, temperature between its historical min and max): shown as text only
  const scale = { temperature: av.temperature.ok ? scalePct("temperature", av.temperature.value, w) : null,
    humidity: av.humidity.ok ? scalePct("humidity", av.humidity.value) : null, ph: av.ph.ok ? scalePct("ph", av.ph.value) : null };
  const rows = [...MODEL, ...GUIDANCE].map((id) => {
    const label = t(`fi.f.${id}`);
    if (MODEL.includes(id) && shareOk) {
      const inr = Math.round(mc[id]);
      return { id, label, kind: "model", inr, share: Math.round((Math.abs(mc[id]) / total) * 100), value: (Math.abs(mc[id]) / total) * 100, empty: null };
    }
    return { id, label, kind: MODEL.includes(id) ? "unavailable" : "guidance", value: null, empty: 100, scale: scale[id] ?? null };
  });
  const ctx = { crop, market };
  const loading = weather?.state === "loading" || soil?.state === "loading";
  const fs = narrow ? 10.5 : 12;
  const wxSrc = w && w.status !== "unavailable" ? t(`wf.src.${w.status}`) : null;      // forecast / recorded / typical for this time of year
  // a number and its unit are joined by a no-break space, so wrapping inside the narrow column never splits "25.3 °C"
  const temp = av.temperature.ok && `${av.temperature.value} °C`;
  const guide = {
    temperature: [temp && (scale.temperature != null ? t("fi.scale.temperature", { value: temp, pct: scale.temperature }) : temp), wxSrc],
    humidity: [av.humidity.ok && `${av.humidity.value}%`, wxSrc],
    soil: [av.soil.ok && av.soil.value, t("fi.src.estimate")],
    ph: [av.ph.ok && t("fi.scale.ph", { value: String(av.ph.value), pct: scale.ph }), t("fi.src.estimate")],
    location: [av.location.value, t("fi.src.selection")],
  };
  const rupee = (i) => {          // the rupee value of a model column, drawn on its own line under the x-axis label
    const r = rows[i];
    return r?.kind === "model" ? { id: r.id, color: r.inr >= 0 ? UP : DOWN,
      text: t("fi.perQuintal", { amount: `${r.inr >= 0 ? "+" : "−"}${rupees(Math.abs(r.inr))}` }) } : null;
  };
  // the share sits directly ABOVE the bar, never on it; on desktop the rupee value is under the x-axis label instead (see Tick)
  const label = ({ x, y, width, index }) => {
    const r = rows[index];
    if (r.kind !== "model") return null;
    const cx = x + width / 2;
    const money = narrow ? rupee(index) : null;
    return (
      <g data-testid={`fi-label-${r.id}`}>
        <text x={cx} y={y - 6} textAnchor="middle" fontSize={fs + 1} fontWeight={800} fill="var(--text)" data-testid={`fi-share-${r.id}`}>{`${r.share}%`}</text>
        {money && <text x={cx} y={y - fs - 14} textAnchor="middle" fontSize={fs - 1} fontWeight={600} fill={money.color}
          data-testid={`fi-rupee-${r.id}`}>{money.text}</text>}
      </g>
    );
  };
  // inside a dashed column (never a model bar's column): the real value in bold, "% of scale, not influence" under a value shown on its own
  // scale, and the source line, wrapped to the column width; "Contribution unavailable" for a model column without a share. No value or
  // scale percentage ever sets any height.
  const emptyLabel = ({ x, y, width, height, index }) => {
    const r = rows[index];
    if (!r || r.kind === "model") return null;
    const cx = x + width / 2, cy = y + height / 2;
    const vfs = fs - 1, sfs = fs - 2.5;
    const max = (size) => Math.max(4, Math.floor((width - 6) / (size * 0.56)));
    if (r.kind === "unavailable") {
      const lines = wrap(t("fi.unavailable"), max(sfs));
      return (
        <text x={cx} y={cy} textAnchor="middle" fontSize={sfs} fill="var(--muted)" data-testid={`fi-empty-${r.id}`}>
          {lines.map((l, i) => <tspan key={i} x={cx} dy={i === 0 ? -((lines.length - 1) * sfs) / 2 : sfs + 2}>{l}</tspan>)}
        </text>
      );
    }
    const [value, source] = guide[r.id];
    const vLines = wrap(value || (loading ? "…" : t("fc.unavailable")), max(vfs));
    const nLines = value && r.scale != null ? wrap(t("fi.scale.note"), max(sfs)) : [];
    const sLines = value && source ? wrap(source, max(sfs)) : [];
    const h = vLines.length * (vfs + 2) + (nLines.length + sLines.length) * (sfs + 2);
    let dy = cy - h / 2 + vfs;
    return (
      <g data-testid={`fi-empty-${r.id}`}>
        <text textAnchor="middle" fontSize={vfs} fontWeight={700} fill={value ? GUIDE.text : GUIDE.text2} data-testid={`fi-value-${r.id}`}>
          {vLines.map((l, i) => { const ty = dy; dy += vfs + 2; return <tspan key={i} x={cx} y={ty}>{l}</tspan>; })}
        </text>
        {nLines.length > 0 && (
          <text textAnchor="middle" fontSize={sfs} fill={GUIDE.text2} data-testid={`fi-scale-${r.id}`}>
            {nLines.map((l, i) => { const ty = dy + 2; dy += sfs + 2; return <tspan key={i} x={cx} y={ty}>{l}</tspan>; })}
          </text>
        )}
        {sLines.length > 0 && (
          <text textAnchor="middle" fontSize={sfs} fill={GUIDE.text2} data-testid={`fi-source-${r.id}`}>
            {sLines.map((l, i) => { const ty = dy + 2; dy += sfs + 2; return <tspan key={i} x={cx} y={ty}>{l}</tspan>; })}
          </text>
        )}
      </g>
    );
  };
  const chips = [
    ["temperature", t("fc.temperature"), av.temperature.ok ? `${av.temperature.value} °C` : null],
    ["humidity", t("fc.humidity"), av.humidity.ok ? `${av.humidity.value}%` : null],
    ["soil", t("fc.soil"), av.soil.ok ? av.soil.value : null], ["ph", t("fc.ph"), av.ph.ok ? String(av.ph.value) : null],
    ["location", t("fc.location"), av.location.value],
  ];

  return (
    <div data-testid="factor-influence">
      <figure className="inf-chart inf-chart-compact" role="img" aria-label={t("fi.title")}>
        <div className="inf-plot inf-plot-compact" data-testid="fi-plot">
          <ResponsiveContainer>
            <BarChart data={rows} margin={{ top: narrow ? 42 : 26, right: 8, bottom: narrow ? 20 : 6, left: 0 }} barCategoryGap="16%">
              <CartesianGrid stroke="var(--grid)" vertical={false} strokeDasharray="3 4" />
              <XAxis dataKey="label" interval={0} stroke="var(--axis)" tickLine={false} axisLine={false} height={narrow ? 84 : 58}
                angle={narrow ? -45 : 0} textAnchor={narrow ? "end" : "middle"}
                tick={narrow ? { fill: "var(--text-2)", fontSize: 11 } : <Tick rupee={rupee} />} />
              <YAxis stroke="var(--axis)" tickLine={false} axisLine={false} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} interval={0}
                width={narrow ? 38 : 64} tickFormatter={(v) => `${v}%`} tick={{ fill: "var(--muted)", fontSize: 11 }}
                label={narrow ? undefined : { value: t("fi.yLabel"), angle: -90, position: "insideLeft", offset: 6, style: { textAnchor: "middle", fill: "var(--muted)", fontSize: 12 } }} />
              <Tooltip cursor={{ fill: "rgba(23,77,53,0.05)" }} content={<Tip t={t} ctx={ctx} />} />
              {/* one column per factor: the share bar for a model input, else a full-height dashed frame (same x position, stacked): light green
                  for a farm-guidance factor, empty grey for a model factor without a share */}
              <Bar dataKey="value" stackId="f" radius={[6, 6, 0, 0]} maxBarSize={44} isAnimationActive={false}>
                {rows.map((r) => <Cell key={r.id} fill={r.kind === "model" ? (r.inr >= 0 ? UP : DOWN) : "none"} data-testid={`fi-bar-${r.id}`} />)}
                <LabelList dataKey="value" content={label} />
              </Bar>
              <Bar dataKey="empty" stackId="f" maxBarSize={44} isAnimationActive={false} strokeDasharray="4 3">
                {rows.map((r) => (r.kind === "guidance"
                  ? <Cell key={r.id} fill={GUIDE.fill} stroke={GUIDE.line} strokeOpacity={0.8} />
                  : <Cell key={r.id} fill="none" stroke={EMPTY_LINE} strokeOpacity={0.6} />))}
                <LabelList dataKey="empty" content={emptyLabel} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {narrow && <figcaption className="inf-cap">{t("fi.yLabel")}</figcaption>}
        <ul className="sr-only" data-testid="fi-effects">{rows.map((r) => <li key={r.id} data-testid={`fi-effect-${r.id}`}>{effectText(t, r, ctx)}</li>)}</ul>
      </figure>
      {shareOk && mc.experimental && <p className="muted small fi-line" data-testid="fi-exp-note">{t("wf.contrib.exp")}</p>}

      <ul className="fi-chips" data-testid="fi-chips">
        {chips.map(([id, name, value]) => (
          <li key={id} className={value ? "" : "is-missing"} data-testid={`fi-chip-${id}`}>
            <span className="fi-chip-name">{name} <em>· {t("wf.s.guidance")}</em></span>
            <span className="fi-chip-value">{value ?? (loading ? "…" : t("fc.unavailable"))}
              {value && (id === "soil" || id === "ph") && <em> {t("fi.estimate")}</em>}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
