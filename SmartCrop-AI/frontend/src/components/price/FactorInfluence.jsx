import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useNarrow } from "../../hooks/useNarrow";
import { useT } from "../../i18n/LanguageContext";
import { FACTOR_WEIGHTS, WEIGHT_TOTAL, availability, topFactors } from "../../utils/factorWeights";

const TOP = "#174D35", BASE = "#6FAE88", MISSING = "#EEF2EE", MISSING_LINE = "#8a9a8a";

/** X-axis label wrapped onto at most two lines (desktop); on phones the chart angles the full label instead. */
function Tick({ x, y, payload }) {
  const words = String(payload.value).split(" ");
  const mid = Math.ceil(words.length / 2);
  const lines = words.length > 1 ? [words.slice(0, mid).join(" "), words.slice(mid).join(" ")] : words;
  return (
    <text x={x} y={y + 12} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--text-2)">
      {lines.map((l, i) => <tspan key={i} x={x} dy={i === 0 ? 0 : 14}>{l}</tspan>)}
    </text>
  );
}

function Tip({ active, payload, t }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tooltip inf-tip" data-testid="fi-tooltip">
      <p className="inf-tip-name">{d.label}</p>
      <dl>
        <div><dt>{t("fi.tip.weight")}</dt><dd>{d.weight}%</dd></div>
        <div><dt>{t("fi.tip.data")}</dt><dd>{d.ok ? (d.valueText || t("fi.tip.fromRequest")) : t("fc.unavailable")}</dd></div>
      </dl>
      <p className="inf-tip-text">{t(d.ok ? "fi.tip.note" : "fi.tip.noteMissing")}</p>
    </div>
  );
}

/**
 * "What Influences Your Predicted Price?": ONE vertical bar chart of the eight factors' TARGET importance weights (a design setting, in %),
 * all on one 0-30 % axis, then one row of chips with the location's values. The weights are not model output: the deployed price model uses
 * season and crop/market but not weather or soil, and nothing here says a factor moved the price. A factor whose data cannot be found is
 * marked unavailable; its weight is neither hidden nor given to another factor.
 */
export default function FactorInfluence({ weather, soil, growing, market }) {
  const t = useT();
  const narrow = useNarrow();
  const av = availability({ weather, soil, growing, market });
  const tied = topFactors();
  const valueText = {
    temperature: av.temperature.ok ? `${av.temperature.value} °C` : null, rainfall: av.rainfall.ok ? `${av.rainfall.value} mm` : null,
    humidity: av.humidity.ok ? `${av.humidity.value}%` : null, soil: av.soil.ok ? av.soil.value : null, ph: av.ph.ok ? String(av.ph.value) : null,
    market: av.market.value, location: av.location.value,
  };
  const rows = FACTOR_WEIGHTS.map((f) => ({ ...f, ok: av[f.id].ok, top: tied.ids.includes(f.id), valueText: valueText[f.id] }));
  const names = tied.ids.map((id) => FACTOR_WEIGHTS.find((f) => f.id === id).label);
  const loading = weather?.state === "loading" || soil?.state === "loading";
  const label = ({ x, y, width, index }) => (
    <text x={x + width / 2} y={y - 5} textAnchor="middle" fontSize={narrow ? 10.5 : 12} fontWeight={700} fill="var(--text-2)">{rows[index].weight}%</text>
  );
  const chips = [
    ["temperature", t("fc.temperature"), valueText.temperature], ["rainfall", t("fc.rainfall"), valueText.rainfall],
    ["humidity", t("fc.humidity"), valueText.humidity], ["soil", t("fc.soil"), valueText.soil], ["ph", t("fc.ph"), valueText.ph],
    ["market", t("fi.chip.market"), valueText.market], ["location", t("fc.location"), valueText.location],
  ];

  return (
    <div data-testid="factor-influence">
      <figure className="inf-chart inf-chart-compact" role="img" aria-label={t("fi.title")}>
        <div className="inf-legend">
          <span><i style={{ background: TOP }} />{t("fi.legend.top")}</span>
          <span><i style={{ background: BASE }} />{t("fi.legend.target")}</span>
          <span><i style={{ background: MISSING, border: `1px dashed ${MISSING_LINE}` }} />{t("fi.legend.missing")}</span>
        </div>
        <div className="inf-plot inf-plot-compact" data-testid="fi-plot">
          <ResponsiveContainer>
            <BarChart data={rows} margin={{ top: 20, right: 8, bottom: narrow ? 20 : 6, left: 0 }} barCategoryGap="16%">
              <CartesianGrid stroke="var(--grid)" vertical={false} strokeDasharray="3 4" />
              <XAxis dataKey="label" interval={0} stroke="var(--axis)" tickLine={false} axisLine={false} height={narrow ? 84 : 40}
                angle={narrow ? -45 : 0} textAnchor={narrow ? "end" : "middle"}
                tick={narrow ? { fill: "var(--text-2)", fontSize: 11 } : <Tick />} />
              <YAxis stroke="var(--axis)" tickLine={false} axisLine={false} domain={[0, 30]} ticks={[0, 5, 10, 15, 20, 25, 30]} interval={0}
                width={narrow ? 38 : 64} tickFormatter={(v) => `${v}%`} tick={{ fill: "var(--muted)", fontSize: 11 }}
                label={narrow ? undefined : { value: t("fi.yLabel"), angle: -90, position: "insideLeft", offset: 6, style: { textAnchor: "middle", fill: "var(--muted)", fontSize: 12 } }} />
              <Tooltip cursor={{ fill: "rgba(23,77,53,0.05)" }} content={<Tip t={t} />} />
              <Bar dataKey="weight" radius={[6, 6, 0, 0]} maxBarSize={44} isAnimationActive={false}>
                {rows.map((r) => (r.ok
                  ? <Cell key={r.id} fill={r.top ? TOP : BASE} />
                  : <Cell key={r.id} fill={MISSING} stroke={MISSING_LINE} strokeDasharray="4 3" strokeWidth={1.25} />))}
                <LabelList dataKey="weight" content={label} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {narrow && <figcaption className="inf-cap">{t("fi.yLabel")}</figcaption>}
        <figcaption className="inf-cap" data-testid="fi-sum">{t("fi.sum", { total: WEIGHT_TOTAL })}</figcaption>
      </figure>

      <p className="fi-top-line" data-testid="fi-top">
        <strong data-testid="fi-top-name">{tied.ids.length > 1
          ? t("fi.topLineTie", { names: names.join(` ${t("fi.and")} `), weight: tied.weight })
          : t("fi.topLineOne", { name: names[0], weight: tied.weight })}</strong>
      </p>
      <p className="muted small fi-line" data-testid="fi-weights-note">{t("fi.weightsNote")}</p>

      <ul className="fi-chips" data-testid="fi-chips">
        {chips.map(([id, name, value]) => (
          <li key={id} className={value ? "" : "is-missing"} data-testid={`fi-chip-${id}`}>
            <span className="fi-chip-name">{name}</span>
            <span className="fi-chip-value">{value ?? (loading ? "…" : t("fc.unavailable"))}
              {value && (id === "soil" || id === "ph") && <em> {t("fi.estimate")}</em>}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
