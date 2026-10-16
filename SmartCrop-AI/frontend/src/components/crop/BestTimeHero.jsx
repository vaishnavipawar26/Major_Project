import { Calendar, CircleCheck, TriangleAlert } from "lucide-react";
import { useT } from "../../i18n/LanguageContext";
import { bestSellTime, monthYear } from "../../utils/cropPlan";
import { monthLabel, rupees } from "../../utils/format";

/** "Best time to sell": the one thing a farmer needs first, with a one-line comparison to their own month. */
export default function BestTimeHero({ result, response, reliable }) {
  const t = useT();
  const b = bestSellTime(result, response);
  if (!b) return null;
  const args = {
    sell: monthLabel(response.selling_date), best: monthLabel(b.month), price: rupees(result.economics.selling_price),
    gain: rupees(Math.round(b.gain ?? 0)),
  };
  return (
    <div className="best-hero" aria-labelledby="best-hero-label">
      <span className="best-hero-icon"><Calendar size={22} aria-hidden="true" /></span>
      <div className="best-hero-main">
        <div className="best-hero-top">
          <div>
            <p id="best-hero-label" className="best-hero-label">{t("cr.hero.label")}</p>
            <p className="best-hero-month">{monthYear(b.month)}</p>
          </div>
          <div className="best-hero-price">
            <span className="best-hero-label">{t("cr.hero.expected")}</span>
            <strong className="num">{rupees(b.price)}</strong>
            <span className="best-hero-label">{t("unit.perQuintal")}</span>
          </div>
          <span className={`best-hero-badge ${reliable ? "is-ok" : "is-warn"}`}>
            {reliable ? <CircleCheck size={14} aria-hidden="true" /> : <TriangleAlert size={14} aria-hidden="true" />}
            {t(reliable ? "cr.hero.reliable" : "cr.hero.limited")}
          </span>
        </div>
        {b.kind === "best" ? (
          <p className="best-hero-line is-good"><CircleCheck size={16} aria-hidden="true" />{t("cr.hero.alreadyBest")}</p>
        ) : (
          <p className="best-hero-line">{t(`cr.hero.${b.kind}`, args)}</p>
        )}
        <p className="best-hero-note">{t("cr.hero.monthlyNote")}</p>
      </div>
    </div>
  );
}
