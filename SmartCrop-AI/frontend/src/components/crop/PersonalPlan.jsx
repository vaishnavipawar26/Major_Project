import { Shield, ShieldAlert, ShieldCheck, Sparkles, TrendingDown, Wheat } from "lucide-react";
import CropArt from "../CropArt";
import { useT } from "../../i18n/LanguageContext";
import { planView } from "../../utils/personalPlan";

const RISK_ICON = { low: ShieldCheck, medium: Shield, high: ShieldAlert };
const RISK_TONE = { low: "good", medium: "warn", high: "bad" };

/** One small crop card: image, name, badge, cost against the budget, profit, profit at the low end, risk chip, supply note, one reason. */
function PlanCard({ c }) {
  const t = useT();
  const RiskIcon = RISK_ICON[c.risk];
  return (
    <li className={`pp-card${c.kind === "best" ? " is-best" : ""}`} data-testid={`plan-card-${c.crop}`}>
      <div className="pp-card-head">
        <CropArt crop={c.crop} size={44} decorative className="pp-art" />
        <div className="min-w-0">
          <strong className="pp-name">{c.name}</strong>
          <span className={`rank-chip pp-badge${c.kind === "best" ? "" : " is-alt"}`}>{c.badge}</span>
        </div>
      </div>
      <div className="pp-cost">
        <span className="pp-cost-text">{c.cost}</span>
        {c.costPct != null && <span className="pp-bar" role="img" aria-label={c.cost}><span style={{ width: `${c.costPct}%` }} /></span>}
      </div>
      <dl className="pp-facts">
        <div><dt>{t("cr.pp.profit")}</dt><dd className="num">{c.profit}</dd></div>
        <div><dt>{t("cr.pp.lowEnd")}</dt><dd className={`num${c.downsideLoss ? " is-loss" : ""}`}>{c.downside}</dd></div>
      </dl>
      <div className="pp-chips">
        <span className={`xp-status is-${RISK_TONE[c.risk]}`} data-testid="risk-chip"><RiskIcon size={14} aria-hidden="true" />{c.riskText}</span>
        {c.supply && <span className="xp-status is-warn" data-testid="supply-chip"><TrendingDown size={14} aria-hidden="true" />{c.supply.text}</span>}
      </div>
      {c.supply && <p className="xp-sub">{c.supply.note}</p>}
      <p className="pp-reason">{c.reason}</p>
    </li>
  );
}

/** "Your personalised plan": shown only when the farmer gave a budget, priority or risk level. Sits under the standard summary and changes nothing in it. */
export default function PersonalPlan({ response }) {
  const t = useT();
  const v = planView(response, t);
  if (!v) return null;
  return (
    <section className="card pp-section" aria-labelledby="pp-title" data-testid="personal-plan">
      <h2 id="pp-title" className="cr-h2"><Sparkles size={18} aria-hidden="true" /> {t("cr.pp.title")}</h2>
      <p className="pp-header" data-testid="plan-header">{v.header}</p>

      {v.noFit && <p className="pp-nofit" data-testid="plan-nofit"><Wheat size={16} aria-hidden="true" />{v.noFit}</p>}
      {v.matchLine && (
        <div className="pp-match" data-testid="plan-match">
          <strong>{v.matchLine.text}</strong>
          <p>{v.matchLine.reason}</p>
        </div>
      )}
      {!v.matchLine && v.cards.length > 0 && <ul className="pp-cards">{v.cards.map((c) => <PlanCard key={c.crop} c={c} />)}</ul>}

      {v.excluded.length > 0 && (
        <details className="pp-excluded small" data-testid="plan-excluded">
          <summary>{t("cr.pp.whyNot")}</summary>
          <ul>{v.excluded.map((x) => <li key={x.crop}>{x.text}</li>)}</ul>
        </details>
      )}
      <p className="xp-sub pp-foot">{t("cr.pp.footer")} {v.costNote}</p>
    </section>
  );
}
