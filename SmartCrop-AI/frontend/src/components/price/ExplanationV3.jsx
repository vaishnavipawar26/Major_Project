import { CircleCheck, Info, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";
import Alert from "../Alert";
import ServerText from "../ServerText";
import { useT } from "../../i18n/LanguageContext";
import { cropName, fmtDate, rupees } from "../../utils/format";
import { STATE_MARKET } from "../../utils/constants";

/** Translated group title when the dictionary has it, else the backend's English title. */
const groupTitle = (t, c, isState) => {
  const key = c.group === "market" && isState ? "price.v3.group.marketState" : `price.v3.group.${c.group}`;
  const v = t(key);
  return v === key ? c.title : v;
};

const FLAG_ICON = { agree: CircleCheck, disagree: TriangleAlert };

/** One reason: group, ₹ effect, the dated records, what usually follows (only if supported), and whether records and model agree. */
function ReasonCard({ c, isState }) {
  const t = useT();
  const context = c.inr_effect == null;          // crops where the model is not used to claim a direction
  const up = c.direction === "up";
  const none = !context && Math.abs(c.inr_effect) < 5;
  const Icon = up ? TrendingUp : TrendingDown;
  const flag = c.agreement?.flag;
  const FlagIcon = FLAG_ICON[flag] || Info;
  return (
    <li className={`factor-card xai-card ${context || none ? "push-small" : up ? "push-up" : "push-down"}`} data-testid={`reason-${c.group}`}>
      <strong className="factor-name">{groupTitle(t, c, isState)}</strong>
      <span className="factor-push">
        {!none && !context && <Icon size={15} aria-hidden="true" />}
        {context ? t("price.v3.contextBadge") : none ? t("price.v3.noEffect") : t(up ? "price.v3.pushedUp" : "price.v3.pushedDown", { amount: rupees(Math.abs(c.inr_effect_rounded)) })}
      </span>
      <dl className="xai-parts">
        <dt>{t("price.v3.recordsLabel")}</dt>
        <dd><ServerText>{c.evidence}</ServerText></dd>
        {c.mechanism && (<><dt>{t("price.v3.mechanismLabel")}</dt><dd><ServerText>{c.mechanism}</ServerText></dd></>)}
        {!context && (<>
          <dt>{t("price.v3.agreementLabel")}</dt>
          <dd className={`v3-flag v3-flag-${flag}`}>
            <FlagIcon size={14} aria-hidden="true" /> <strong>{t(`price.v3.flag.${flag === "no_reading" ? "noReading" : flag === "no_evidence" ? "noEvidence" : flag}`)}</strong>{" "}
            <ServerText>{c.agreement.text}</ServerText>
          </dd>
        </>)}
      </dl>
    </li>
  );
}

/** The evidence-first explanation (backend `v3` block): verdict, reasons in rupees, market vs Maharashtra, trust. */
export default function ExplanationV3({ exp, explain }) {
  const t = useT();
  const v = exp.v3;
  const h = v.headline;
  const crop = cropName(t, explain.series.commodity);
  const isState = explain.series.market === STATE_MARKET;
  const market = isState ? t("price.form.allMarkets") : explain.series.market;
  const proj = explain.projection;
  const ctxOnly = v.context_only === true || h.predicted_price == null;
  const sign = (h.change_inr ?? 0) >= 0 ? "+" : "−";
  const verdictClass = h.code === "rise" || h.code === "fall" ? "" : "xai-caution";
  const mkt = v.market_breakdown;
  const other = v.other_factors;
  return (
    <>
      {v.banner && (
        <Alert type="warn">
          <strong><ServerText>{v.banner.text}</ServerText></strong>
          <div className="small"><ServerText>{v.banner.detail}</ServerText></div>
        </Alert>
      )}

      <section className="xai-overall" aria-labelledby="v3-verdict" data-testid="v3-verdict">
        <h2 id="v3-verdict" className="xai-h">{t("price.expl.predictedTitle")}</h2>
        <dl className="kv">
          <dt>{t("hist.col.crop")} · {t("hist.col.market")}</dt><dd><strong>{crop}</strong> · {market}</dd>
          <dt>{proj ? t("price.v3.startEstimated") : t("price.v3.startLatest")}</dt>
          <dd>{rupees(h.start_price)} <span className="muted small">{t("price.expl.perQuintal")} · {proj
            ? t("price.v3.startBasedOn", { date: fmtDate(proj.reference_origin_date) })
            : t("price.v3.startReported", { date: fmtDate(explain.forecast_origin_date) })}</span></dd>
          {!ctxOnly && (<>
            <dt>{t("price.expl.expectedPrice")}</dt>
            <dd><strong>{rupees(h.predicted_price)}</strong> <span className="muted small">{t("price.expl.perQuintal")} · {fmtDate(h.target_date)}</span></dd>
            <dt>{t("price.expl.expectedChange")}</dt><dd>{sign}{rupees(Math.abs(h.change_inr))} ({sign}{Math.abs(h.change_pct).toFixed(1)}%)</dd>
          </>)}
          {h.range && (<><dt>{t("price.v3.rangeLabel")}</dt>
            <dd data-testid="v3-range">{rupees(h.range[0])} – {rupees(h.range[1])} <span className="muted small">{t("price.expl.perQuintal")}</span>
              <div className="muted small">{h.range_coverage_pct != null
                ? t("price.v3.rangeMeasured", { pct: Math.round(h.range_coverage_pct) })
                : t("price.v3.rangeUnmeasured")}</div></dd></>)}
          {h.range_hidden && (<><dt>{t("price.v3.rangeLabel")}</dt><dd data-testid="v3-range-hidden">{t("price.result.rangeHidden")}</dd></>)}
        </dl>
        <p className={`xai-line ${verdictClass}`} data-testid="v3-headline" style={{ fontSize: "1.05rem" }}>
          {verdictClass && <TriangleAlert size={16} aria-hidden="true" />}<ServerText>{h.text}</ServerText>
        </p>
      </section>

      <section aria-labelledby="v3-why">
        <h2 id="v3-why" className="xai-h">{ctxOnly ? t("price.v3.contextTitle") : t("price.v3.whyTitle")}</h2>
        <p className="muted small">{ctxOnly ? t("price.v3.contextHint") : t("price.v3.whyHint")}</p>
        <ul className="factor-cards v3-cards">
          {v.cards.map((c) => <ReasonCard key={c.group} c={c} isState={isState} />)}
        </ul>
        {other && <div className="xai-overall v3-other" data-testid="v3-other">
          <strong>{t("price.v3.otherTitle", { amount: `${other.inr_total >= 0 ? "+" : "−"}${rupees(Math.abs(other.inr_total_rounded))}` })}</strong>
          <p className="small muted" style={{ margin: "0.2rem 0 0" }}>{t("price.v3.otherHint")}</p>
          <details className="small">
            <summary>{t("price.v3.otherDetails")}</summary>
            <ul className="xai-limits">
              {other.parts.map((p) => <li key={p.label}><ServerText>{p.label}</ServerText>: {p.inr >= 0 ? "+" : "−"}{rupees(Math.abs(p.inr))}</li>)}
              {other.swing_evidence && <li><ServerText>{other.swing_evidence}</ServerText></li>}
            </ul>
          </details>
        </div>}
        {v.evidence_not_used_by_model.length > 0 && (
          <details className="small" data-testid="v3-unused">
            <summary>{t("price.v3.notUsedTitle")}</summary>
            <ul className="xai-limits">
              {v.evidence_not_used_by_model.map((u) => <li key={u.group}><strong>{u.title}:</strong> <ServerText>{u.evidence}</ServerText></li>)}
            </ul>
          </details>
        )}
      </section>

      <section aria-labelledby="v3-market" data-testid="v3-market">
        <h2 id="v3-market" className="xai-h">{t("price.v3.marketTitle")}</h2>
        <p style={{ margin: 0 }}><ServerText>{mkt.text}</ServerText></p>
        {mkt.evidence && <p className="small muted" style={{ margin: "0.2rem 0 0" }}><ServerText>{mkt.evidence}</ServerText></p>}
        {mkt.note && <p className="small xai-caution"><ServerText>{mkt.note}</ServerText></p>}
      </section>

      <section aria-labelledby="v3-trust" data-testid="v3-trust">
        <h2 id="v3-trust" className="xai-h">{t("price.v3.trustTitle")}</h2>
        <ul className="xai-limits">
          {v.trust.lines.map((l) => <li key={l}><ServerText>{l}</ServerText></li>)}
          {v.trust.warnings.map((w) => <li key={w} className="xai-caution"><ServerText>{w}</ServerText></li>)}
        </ul>
      </section>
    </>
  );
}
