import { CalendarDays, ChartLine, Coins, Info, Sprout, TrendingUp } from "lucide-react";
import { useT } from "../../i18n/LanguageContext";
import { fitBand, fitSummary, keyPoints, monthYear } from "../../utils/cropPlan";
import { cropName, rupees, signedRupees } from "../../utils/format";

function Point({ icon: Icon, title, tone, children }) {
  return (
    <li className={`fit-point is-${tone}`}>
      <span className="fit-point-icon"><Icon size={18} aria-hidden="true" /></span>
      <div className="min-w-0">
        <h4>{title}</h4>
        <p>{children}</p>
      </div>
    </li>
  );
}

/** Section 3 - the score and the money at a glance, three short reasons, how the score works. */
export default function SuitabilitySection({ result, response, inputs }) {
  const t = useT();
  const w = response.weights, pctOf = (x) => Math.round(x * 100);
  const crop = cropName(t, result.crop_name);
  const band = fitBand(result);
  const e = result.economics;
  const month = monthYear(response.selling_date);
  const pts = keyPoints(result, response, inputs, t);
  const tip = t("cr.fit.tip");
  return (
    <section className="card" aria-labelledby="fit-title">
      <h2 id="fit-title" className="cr-h2">{t("cr.fit.title")}</h2>

      <div className={`fit-head is-${band}`}>
        <div className="fit-score">
          <span className="num">{Math.round(result.recommendation_score)}</span><span className="fit-out">/100</span>
          <span className="adv-tip" tabIndex={0} role="img" aria-label={tip} data-tip={tip}><Info size={15} aria-hidden="true" /></span>
        </div>
        <div className="min-w-0">
          <p className="fit-crop">{crop}</p>
          <p className="fit-band">{t(`cr.band.${band}`)}</p>
          <p className="fit-text">{fitSummary(result, inputs, t)}</p>
        </div>
      </div>

      <div className="fit-stats">
        <div className="fit-stat">
          <span className="fit-stat-label"><Coins size={15} aria-hidden="true" />{t("cr.stat.price")}</span>
          {e ? (
            <>
              <strong className="num">{rupees(e.selling_price)} <small>{t("unit.perQuintal")}</small></strong>
              <span className="fit-stat-sub">{t("cr.stat.period", { month })}</span>
            </>
          ) : <strong>{t("score.notAvailable")}</strong>}
        </div>
        <div className="fit-stat">
          <span className="fit-stat-label"><TrendingUp size={15} aria-hidden="true" />{t("cr.stat.profit")}</span>
          {e ? (
            <>
              <strong className={`num ${e.net_profit < 0 ? "is-neg" : ""}`}>{signedRupees(e.net_profit)}</strong>
              <span className="fit-stat-sub">{t("cr.stat.area", { area: e.area_acres, month })}</span>
            </>
          ) : <strong>{t("score.notAvailable")}</strong>}
        </div>
      </div>

      <h3 className="cr-h3">{t("cr.why.title")}</h3>
      <ul className="fit-points">
        <Point icon={ChartLine} title={t("cr.pt.profit")} tone={pts.profit.tone}>{pts.profit.text}</Point>
        <Point icon={Sprout} title={t("cr.pt.field")} tone={pts.field.tone}>{pts.field.text}</Point>
        <Point icon={CalendarDays} title={t("cr.pt.timing")} tone={pts.timing.tone}>{pts.timing.text}</Point>
      </ul>

      <div className="fit-how">
        <p>{t("cr.how.line1", { soil: pctOf(w.agronomic), timing: pctOf(w.timing), profit: pctOf(w.profit) })}</p>
      </div>
    </section>
  );
}
