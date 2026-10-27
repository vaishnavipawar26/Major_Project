import { CircleAlert, Landmark, Ruler, Shield, ShieldAlert, ShieldCheck, Sparkles, Wheat } from "lucide-react";
import CropArt from "../CropArt";
import { useT } from "../../i18n/LanguageContext";
import { planVisualView } from "../../utils/personalPlan";

const RISK_ICON = { low: ShieldCheck, medium: Shield, high: ShieldAlert };
const RISK_TONE = { low: "good", medium: "warn", high: "bad" };

function Tile({ icon: Icon, label, value }) {
  return (
    <div className="pv-tile">
      <span className="pv-tile-label"><Icon size={16} aria-hidden="true" />{label}</span>
      <strong className="pv-tile-value num">{value}</strong>
    </div>
  );
}

function Figure({ label, value, loss }) {
  return <div className="pv-fig"><dt>{label}</dt><dd className={`num${loss ? " is-loss" : ""}`}>{value}</dd></div>;
}

function CropHead({ crop, name, area }) {
  return (
    <div className="pv-crop">
      <CropArt crop={crop} size={52} decorative className="pp-art" />
      <div><strong className="pv-crop-name">{name}</strong><span className="pv-crop-sub">{area}</span></div>
    </div>
  );
}

/** "Your personalised plan": budget and field, the best crop for the whole field, what the budget really pays for, and a budget bar. */
export default function PersonalPlan({ response }) {
  const t = useT();
  const v = planVisualView(response, t);
  if (!v) return null;
  const { full, option, bar } = v;
  const RiskIcon = option ? RISK_ICON[option.risk] : null;
  // one box when the pick is also the best crop for the whole field; two when the budget changes the answer
  const showFull = full && (!option || v.partial || full.crop !== option.crop);

  return (
    <section className="card pp-section" aria-labelledby="pp-title" data-testid="personal-plan">
      <h2 id="pp-title" className="cr-h2"><Sparkles size={18} aria-hidden="true" /> {t("cr.pp.title")}</h2>
      <p className="pp-header" data-testid="plan-header">{v.header}</p>

      <div className="pv-tiles">
        {v.hasBudget && <Tile icon={Landmark} label={t("cr.pv.budget")} value={v.budget} />}
        <Tile icon={Ruler} label={t("cr.pv.farm")} value={v.area} />
      </div>

      {v.noFit && <p className="pp-nofit" data-testid="plan-nofit"><Wheat size={16} aria-hidden="true" />{v.noFit}</p>}

      <div className="pv-grid">
        {showFull && (
          <article className="pv-box" data-testid="plan-full">
            <h3 className="pv-box-title">{t("cr.pv.fullTitle")}</h3>
            <CropHead crop={full.crop} name={full.name} area={full.area} />
            <dl className="pv-figs">
              <Figure label={t("cr.pv.cost")} value={full.cost} />
              <Figure label={t("cr.pv.profit")} value={full.profit} loss={full.profitLoss} />
            </dl>
            {full.shortfall
              ? <p className="pv-chip is-bad" data-testid="plan-shortfall"><CircleAlert size={15} aria-hidden="true" />{t("cr.pv.short", { extra: full.shortfall })}</p>
              : v.hasBudget && <p className="pv-chip is-good">{t("cr.pv.fits")}</p>}
          </article>
        )}
        {option && (
          <article className="pv-box is-pick" data-testid="plan-option">
            <h3 className="pv-box-title">{v.partial ? t("cr.pv.partTitle") : t("cr.pv.bestTitle")}</h3>
            <CropHead crop={option.crop} name={option.name} area={option.area} />
            {v.partial && <p className="pv-grow" data-testid="plan-grow">{t("cr.pv.grow", { area: option.area })}</p>}
            <dl className="pv-figs">
              <Figure label={t("cr.pv.cost")} value={option.cost} />
              <Figure label={t("cr.pv.revenue")} value={option.revenue} />
              <Figure label={t("cr.pv.profit")} value={option.profit} loss={option.profitLoss} />
            </dl>
            <p className={`pv-chip is-${RISK_TONE[option.risk]}`}><RiskIcon size={15} aria-hidden="true" />{option.riskText}</p>
          </article>
        )}
      </div>

      {bar && (
        <div className="pv-budget" data-testid="budget-bar">
          <h3 className="pv-box-title">{t("cr.pv.barTitle")}</h3>
          <div className="pv-bar-row">
            <span>{t("cr.pv.money")}</span>
            <span className="pv-track" role="img" aria-label={`${t("cr.pv.money")} ${bar.money}`}><span className="is-money" style={{ width: `${bar.moneyPct}%` }} /></span>
            <strong className="num">{bar.money}</strong>
          </div>
          <div className="pv-bar-row">
            <span>{t("cr.pv.needed")}</span>
            <span className="pv-track" role="img" aria-label={`${t("cr.pv.needed")} ${bar.cost}`}><span className={bar.over ? "is-over" : "is-cost"} style={{ width: `${bar.costPct}%` }} /></span>
            <strong className="num">{bar.cost}</strong>
          </div>
          {bar.fullCost && (
            <div className="pv-bar-row is-faint">
              <span>{t("cr.pv.neededFull")}</span>
              <span className="pv-track"><span className="is-over" style={{ width: `${bar.fullPct}%` }} /></span>
              <strong className="num">{bar.fullCost}</strong>
            </div>
          )}
        </div>
      )}

      {v.compare.length > 1 && (
        <div className="pv-compare" data-testid="plan-compare">
          <h3 className="pv-box-title">{t("cr.pv.compareTitle", { area: v.compareArea })}</h3>
          <ul className="pv-compare-list">
            {v.compare.map((c) => (
              <li key={c.crop} className={c.isPick ? "is-pick" : ""}>
                <CropArt crop={c.crop} size={32} decorative className="pp-art" />
                <span className="pv-compare-name">{c.name}</span>
                <span className="pv-track"><span className="is-profit" style={{ width: `${c.pct}%` }} /></span>
                <span className="pv-compare-nums"><strong className="num">{c.profit}</strong><small>{t("cr.pv.costShort", { cost: c.cost })}</small></span>
              </li>
            ))}
          </ul>
        </div>
      )}

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
