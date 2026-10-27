import { Sparkles } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useNarrow } from "../../hooks/useNarrow";
import { useT } from "../../i18n/LanguageContext";

// dark green = the factor that decided the ranking, mid green = supports, amber = limits; the pale remainder is what the crop could not earn
const TOP = "#174D35", SUPPORT = "#6FAE88", PARTIAL = "#B9CF8A", LIMIT = "#E0A94A", MISSED = "#EEF2EE";
const colourOf = (d, topKey) => (d.key === topKey ? TOP : d.status === "limits" ? LIMIT : d.status === "mixed" ? PARTIAL : SUPPORT);
const pts = (v) => v.toFixed(1);

/** The one histogram: short factor names on X, weighted score points earned on Y (pale part = points not earned). */
function FactorChart({ inf, topKey }) {
  const t = useT();
  const narrow = useNarrow();
  const data = inf.bars;
  const v = { crop: inf.crop, ref: inf.ref };
  const top = Math.max(...data.map((d) => d.max));
  const label = ({ x, y, width, index }) => (
    <text x={x + width / 2} y={y - 5} textAnchor="middle" fontSize={narrow ? 10 : 12} fontWeight={600} fill="var(--text-2)">{pts(data[index].earned)}</text>
  );
  return (
    <figure className="inf-chart" role="img" aria-label={`${t("cr.inf.title")}. ${t("cr.inf.chartAlt")}`}>
      <div className="inf-legend">
        {topKey && <span><i style={{ background: TOP }} />{t("cr.inf.legendTop")}</span>}
        <span><i style={{ background: SUPPORT }} />{t("cr.inf.legendPos", v)}</span>
        <span><i style={{ background: LIMIT }} />{t("cr.inf.legendNeg", v)}</span>
        <span><i className="is-ghost" />{t("cr.inf.legendMissed")}</span>
      </div>
      <div className="inf-plot">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 22, right: 8, bottom: narrow ? 30 : 6, left: 0 }} barCategoryGap="16%">
            <CartesianGrid stroke="var(--grid)" vertical={false} strokeDasharray="3 4" />
            <XAxis dataKey="short" interval={0} stroke="var(--axis)" tickLine={false} height={narrow ? 54 : 32}
              angle={narrow ? -45 : 0} textAnchor={narrow ? "end" : "middle"} tick={{ fill: "var(--text-2)", fontSize: narrow ? 11 : 13 }} />
            <YAxis stroke="var(--axis)" tickLine={false} axisLine={false} domain={[0, Math.ceil(top / 5) * 5]} tickCount={6} width={narrow ? 30 : 64}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              label={narrow ? undefined : { value: inf.yLabel, angle: -90, position: "insideLeft", offset: 14, style: { textAnchor: "middle", fill: "var(--muted)", fontSize: 12 } }} />
            <Tooltip cursor={{ fill: "rgba(23,77,53,0.05)" }} content={({ active, payload }) => {
              const d = active && payload?.[0]?.payload;
              return d ? <FactorTip d={d} inf={inf} /> : null;
            }} />
            <Bar dataKey="earned" stackId="s" isAnimationActive={false} maxBarSize={44}>
              {data.map((d) => <Cell key={d.key} fill={colourOf(d, topKey)} />)}
            </Bar>
            <Bar dataKey="missed" stackId="s" radius={[6, 6, 0, 0]} isAnimationActive={false} maxBarSize={44}>
              {data.map((d) => <Cell key={d.key} fill={MISSED} stroke={d.missed > 0 ? "#C9D3C9" : "none"} strokeDasharray="3 3" />)}
              <LabelList dataKey="earned" content={label} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {narrow && <figcaption className="inf-cap">{inf.yLabel}</figcaption>}
      <figcaption className="inf-cap">{t("cr.inf.chartHint", v)}</figcaption>
    </figure>
  );
}

function FactorTip({ d, inf }) {
  const t = useT();
  const rows = [
    [t("cr.inf.tip.value"), d.input],
    d.range && [t("cr.inf.tip.range", { crop: inf.crop }), d.range],
    [t("cr.inf.tip.influence"), t("cr.inf.tip.earned", { earned: pts(d.earned), max: pts(d.max) })],
    [t("cr.inf.tip.pts", { ref: inf.ref }), `${d.advantage > 0 ? "+" : d.advantage < 0 ? "−" : ""}${pts(Math.abs(d.advantage))}`],
    [t("cr.inf.tip.status"), t(`cr.inf.status.${d.status}`)],
    d.model && [t("cr.inf.tip.model"), t(`cr.inf.model.${d.model}`)],
    ...d.extras,
  ].filter(Boolean);
  return (
    <div className="chart-tooltip inf-tip">
      <p className="inf-tip-name">{d.name}</p>
      <dl>{rows.map(([k, val]) => <div key={k}><dt>{k}</dt><dd>{val}</dd></div>)}</dl>
      <p className="inf-tip-text">{d.text}</p>
    </div>
  );
}

/** Strongest-influence card and the single histogram (`afterChart` is rendered directly below it). `inf` comes from buildInfluence. */
export default function InfluencePanel({ inf, afterChart = null }) {
  const t = useT();
  const card = inf.mainCard;
  const v = { crop: inf.crop, ref: inf.ref };

  return (
    <>
      <section className="card inf-card" aria-labelledby="inf-title">
        <h2 id="inf-title" className="inf-title">{t("cr.inf.title")}</h2>
        <p className="inf-sub">{t("cr.inf.subtitle")}</p>
        {inf.noRival ? <p className="inf-sub">{t("cr.inf.noRival")}</p> : (
          <>
            {inf.isBest && <div className="inf-top" role="group" aria-label={t("cr.inf.mostCard")}>
              <span className="inf-top-icon" aria-hidden="true"><Sparkles size={22} /></span>
              <div className="min-w-0">
                <p className="inf-top-label">{t(inf.isBest ? "cr.inf.mostCard" : "cr.inf.mostCardOther")}</p>
                <p className="inf-top-name">{card ? card.name : t("cr.inf.none")}</p>
                <p className="inf-top-text">{card ? card.text : t("cr.inf.noneBody", v)}</p>
                {card?.tie && <p className="inf-top-tie">{t("cr.inf.tie", { list: card.others.join(", ") })}</p>}
              </div>
              {card && (
                <dl className="inf-top-stats">
                  <div><dt>{t("cr.inf.tip.value")}</dt><dd className="num">{card.value}</dd></div>
                  <div><dt>{t("cr.inf.tip.influence")}</dt><dd className="num">{card.influence}</dd></div>
                </dl>
              )}
            </div>}
            <FactorChart inf={inf} topKey={inf.isBest ? card?.key : undefined} />
          </>
        )}
      </section>

      {afterChart}
    </>
  );
}
