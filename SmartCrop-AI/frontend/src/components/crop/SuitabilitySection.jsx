import { ArrowDown, ArrowUp, CalendarDays, ChartLine, CircleAlert, CircleCheck, CloudSun, Minus, Sprout } from "lucide-react";
import ScoreBar from "../ScoreBar";
import { useT } from "../../i18n/LanguageContext";
import { WEATHER, SOIL, indicatorRows, marketFacts, plantingFacts } from "../../utils/cropPlan";
import { cropName } from "../../utils/format";

const TONE = {
  up: { Icon: ArrowUp, cls: "is-up", label: "cr.tone.up" },
  down: { Icon: ArrowDown, cls: "is-down", label: "cr.tone.down" },
  flat: { Icon: Minus, cls: "is-flat", label: "cr.tone.flat" },
};

function FactList({ items }) {
  const t = useT();
  return (
    <ul className="why-list">
      {items.map((it, i) => {
        const { Icon, cls, label } = TONE[it.tone];
        return (
          <li key={i}>
            <span className={`tone-dot ${cls}`}><Icon size={14} aria-hidden="true" /><span className="sr-only">{t(label)}: </span></span>
            <span>{it.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Indicators({ rows }) {
  return (
    <ul className="ind-list">
      {rows.map((r) => (
        <li key={r.feature} className={r.ok ? "is-ok" : "is-warn"}>
          {r.ok ? <CircleCheck size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}
          <span className="ind-name">{r.label}</span>
          <strong className="ind-value num">{r.value}</strong>
          <span className="ind-status">{r.status}<small>{r.range}</small></span>
        </li>
      ))}
    </ul>
  );
}

function Card({ icon: Icon, title, children }) {
  return (
    <div className="why-group">
      <h4 className="why-group-title"><Icon size={17} aria-hidden="true" />{title}</h4>
      {children}
    </div>
  );
}

/** Section 3 - score with its three parts, then four compact cards on why the crop suits the plan. */
export default function SuitabilitySection({ result, response, inputs }) {
  const t = useT();
  const w = response.weights, pctOf = (x) => Math.round(x * 100);
  return (
    <section className="card" aria-labelledby="fit-title">
      <h2 id="fit-title" className="cr-h2">{t("cr.fit.title")}</h2>
      <div className="score-step">
        <div className="score-big">
          <span className="num">{Math.round(result.recommendation_score)}</span><span className="muted">/100</span>
          <span className="small text-2 block">{t("cr.fit.overall", { crop: cropName(t, result.crop_name) })}</span>
        </div>
        <div className="grid flex-1 min-w-0 gap-3">
          <ScoreBar label={t("cr.fit.soilWeather")} value={result.agronomic_score} note={t("cr.fit.weight", { pct: pctOf(w.agronomic) })} />
          <ScoreBar label={t("cr.fit.timing")} value={result.timing_score} note={t("cr.fit.weight", { pct: pctOf(w.timing) })} />
          <ScoreBar label={t("cr.fit.profit")} value={result.profit_score} note={t("cr.fit.weight", { pct: pctOf(w.profit) })} />
        </div>
      </div>
      <p className="muted small mt-2">{t("cr.fit.explain")}</p>

      <h3 className="cr-h3">{t("cr.why.title")}</h3>
      <div className="why-grid">
        <Card icon={ChartLine} title={t("cr.group.market")}><FactList items={marketFacts(result, response, t)} /></Card>
        <Card icon={Sprout} title={t("cr.group.soil")}><Indicators rows={indicatorRows(result, SOIL, inputs, t)} /></Card>
        <Card icon={CloudSun} title={t("cr.group.weather")}><Indicators rows={indicatorRows(result, WEATHER, inputs, t)} /></Card>
        <Card icon={CalendarDays} title={t("cr.group.timing")}><FactList items={plantingFacts(result, t)} /></Card>
      </div>
    </section>
  );
}
