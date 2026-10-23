import { Boxes, CalendarDays, LineChart, MapPin, Minus, ShieldCheck, TrendingDown, TrendingUp } from "lucide-react";
import CropArt from "../CropArt";
import ServerText from "../ServerText";
import { Step } from "../crop/FarmExplanation";
import { useT } from "../../i18n/LanguageContext";
import { cropName, rupees } from "../../utils/format";
import { STATE_MARKET } from "../../utils/constants";
import { buildStory } from "../../utils/priceStory";

const STEP_ICON = { season: CalendarDays, prices: LineChart, market: MapPin, supply: Boxes, trust: ShieldCheck };
const CHIP = { higher: { icon: TrendingUp, tone: "good" }, lower: { icon: TrendingDown, tone: "bad" }, little: { icon: Minus, tone: null } };

/** Status chip taken from the RECORDS (not from the model): points higher / lower / little effect. Icon plus words. */
function Chip({ kind, t }) {
  const { icon: Icon, tone } = CHIP[kind];
  return <span className={`xp-status${tone ? ` is-${tone}` : ""}`} data-testid="step-chip"><Icon size={14} aria-hidden="true" />{t(`pe.chip.${kind}`)}</span>;
}

/** Translated group title when the dictionary has it, else the backend's English title. */
const groupTitle = (t, c, isState) => {
  const key = c.group === "market" && isState ? "price.v3.group.marketState" : `price.v3.group.${c.group}`;
  const v = t(key);
  return v === key ? c.title : v;
};

/** Collapsed reference material: every rupee effect, the market against Maharashtra, how the tests were made. */
function Technical({ v, story, isState }) {
  const t = useT();
  const tr = v.trust;
  const other = v.other_factors;
  const mkt = v.market_breakdown;
  return (
    <details className="kid-about xai-tech" data-testid="v3-technical">
      <summary>{t("pe.tech.title")}</summary>
      {!story.ctxOnly && v.cards.length > 0 && (<>
        <h3 className="xai-h">{t("pe.tech.effects")}</h3>
        <div className="xai-table-wrap"><table className="xai-table">
          <thead><tr><th scope="col">{t("price.expl.colGroup")}</th><th scope="col">{t("pe.tech.effect")}</th></tr></thead>
          <tbody>
            {v.cards.map((c) => <tr key={c.group}><td>{groupTitle(t, c, isState)}</td><td>{c.inr_effect >= 0 ? "+" : "−"}{rupees(Math.abs(c.inr_effect))}</td></tr>)}
            {other && other.parts.map((p) => <tr key={p.label}><td><ServerText>{p.label}</ServerText></td><td>{p.inr >= 0 ? "+" : "−"}{rupees(Math.abs(p.inr))}</td></tr>)}
          </tbody>
        </table></div>
        <p className="small muted">{t("pe.tech.effectsNote")}</p>
      </>)}
      <h3 className="xai-h">{t("price.v3.marketTitle")}</h3>
      <p className="small" style={{ margin: 0 }} data-testid="v3-market"><ServerText>{mkt.text}</ServerText></p>
      {mkt.evidence && <p className="small muted" style={{ margin: "0.2rem 0 0" }}><ServerText>{mkt.evidence}</ServerText></p>}
      {mkt.note && <p className="small xai-caution"><ServerText>{mkt.note}</ServerText></p>}
      <h3 className="xai-h">{t("pe.tech.tests")}</h3>
      <ul className="xai-limits">
        {tr.available && <li>{t("pe.tech.cases", { n: tr.n.toLocaleString(), band: v.headline.band })}</li>}
        {tr.available && <li>{t("pe.tech.baseline", { name: tr.baseline })}</li>}
        {tr.available && tr.direction_acc_pct != null && <li>{t("pe.tech.direction", { pct: Math.round(tr.direction_acc_pct), n: tr.n_meaningful_moves.toLocaleString() })}</li>}
        {tr.available && <li>{t("pe.tech.wape", { pct: Math.round(tr.wape_pct) })}</li>}
        {story.horizon && <li data-testid="v3-horizon">{story.horizon}</li>}
        <li>{t("pe.tech.rule")}</li>
        {tr.warnings.map((w) => <li key={w}><ServerText>{w}</ServerText></li>)}
      </ul>
    </details>
  );
}

/**
 * The price explanation in the same shape as the crop explanation: a summary card, numbered "Topic — value" steps with status
 * chips, the AI's final explanation, and collapsed technical details. Content comes from utils/priceStory.js.
 */
export default function ExplanationV3({ exp, explain }) {
  const t = useT();
  const v = exp.v3;
  const isState = explain.series.market === STATE_MARKET;
  const crop = cropName(t, explain.series.commodity);
  const market = isState ? t("price.form.allMarkets") : explain.series.market;
  const story = buildStory(exp, explain, t, crop, market);
  return (
    <div className="crop-result">
      <div className="stack">
        <section className="card xp-hero pe-hero" aria-labelledby="pe-summary" data-testid="v3-verdict">
          <h2 id="pe-summary" className="sr-only">{t("price.expl.predictedTitle")}</h2>
          <div className="best-head">
            <CropArt crop={explain.series.commodity} size={72} className="best-photo" />
            <div className="min-w-0">
              <p className="best-name">{crop} · {market}</p>
              <p className={`pe-headline is-${story.tone}`} data-testid="v3-headline">{story.headline}</p>
              {story.sub && <p className="xp-sub pe-sub" data-testid="v3-sub">{story.sub}</p>}
            </div>
            {story.badge && (
              <div className="xp-score" role="group" aria-label={t("pe.badge.label")} data-testid="trust-badge">
                <span className={`xp-score-num pe-badge is-${story.badge}`}>{t(`pe.trust.${story.badge}`)}</span>
                <span className="xp-score-label">{t("pe.badge.label")}</span>
              </div>
            )}
          </div>
          <dl className="xp-facts pe-facts">
            {story.tiles.map((x) => (
              <div key={x.key} className="xp-fact" data-testid={`tile-${x.key}`}><dt>{x.label}</dt><dd>{x.value}{x.sub && <span className="muted small"> {x.sub}</span>}</dd></div>
            ))}
          </dl>
        </section>
        {story.notice && <p className="xp-sub pe-notice" data-testid="v3-notice">{story.notice}</p>}

        <section className="card xp-section" aria-labelledby="pe-why">
          <h2 id="pe-why" className="cr-h2">{story.ctxOnly ? t("pe.why.ctxTitle") : t("pe.why.title")}</h2>
          <p className="xp-intro">{story.ctxOnly ? t("pe.why.ctxIntro") : t("pe.why.intro")}</p>
          <ol className="xp-steps" data-testid="steps">
            {story.steps.map((s, i) => (
              <Step key={s.key} n={i + 1} id={`pe-${s.key}`} icon={STEP_ICON[s.key]} title={s.title} headline={s.headline} tone={s.tone}>
                {s.chip && <div><Chip kind={s.chip} t={t} /></div>}
                <p className="xp-text">{s.text}</p>
                {s.push && (
                  <p className="xp-sub" data-testid="step-push">
                    {s.push.kind === "none" ? t("pe.push.none") : t(s.push.kind === "up" ? "pe.push.up" : "pe.push.down", { amount: s.push.amount })}
                    {s.against && <> <strong>{t("pe.against")}</strong></>}
                  </p>
                )}
              </Step>
            ))}
          </ol>
          <aside className="xp-summary" aria-labelledby="pe-final" data-testid="final-explanation">
            <h3 id="pe-final">{t("pe.final.title")}</h3>
            <p>{story.final}</p>
            <p className="xp-disclaimer">{t("price.expl.note")}</p>
          </aside>
        </section>
        <Technical v={v} story={story} isState={isState} />
      </div>
    </div>
  );
}
