import { Award, CalendarCheck, Coins, Gauge, ShieldCheck, TrendingUp } from "lucide-react";
import Alert from "../Alert";
import CropArt from "../CropArt";
import { useT } from "../../i18n/LanguageContext";
import { harvestSpan, monthYear, reliabilityOf } from "../../utils/cropPlan";
import { compactRupees, cropName, monthLabel, rupees, signedRupees } from "../../utils/format";

function Stat({ icon: Icon, label, value, sub, tone, big }) {
  return (
    <div className={`best-stat ${big ? "is-key" : ""}`}>
      <span className="best-stat-label"><Icon size={15} aria-hidden="true" />{label}</span>
      <span className={`best-stat-value num ${tone === "neg" ? "is-neg" : ""}`}>{value}</span>
      {[].concat(sub || []).filter(Boolean).map((x) => <span key={x} className="best-stat-sub">{x}</span>)}
    </div>
  );
}

/** Section 2a - the recommended crop with its key facts (a price-forecast fact only when no forecast could be made). */
export default function BestCropCard({ response, onSelect }) {
  const t = useT();
  const best = response.results.find((r) => r.crop_name === response.best_overall);
  const top = response.results.find((r) => r.crop_name === response.highest_profit);

  if (!best) {
    return (
      <section className="card best-card" aria-labelledby="best-title">
        <h2 id="best-title" className="cr-h2">{t("cr.best.title")}</h2>
        <Alert type="info">{t("cr.best.none")}</Alert>
        {top && (
          <p className="mt-3 text-2">{t("cr.best.noneTop", { crop: cropName(t, top.crop_name), profit: compactRupees(top.economics.net_profit) })}{" "}
            <button type="button" className="btn-link" onClick={() => onSelect(top.crop_name)}>{t("cr.best.viewDetails")}</button></p>
        )}
      </section>
    );
  }

  const e = best.economics, tl = best.timeline, rel = reliabilityOf(best);
  return (
    <section className="card best-card" aria-labelledby="best-title">
      <h2 id="best-title" className="sr-only">{t("cr.best.title")}</h2>
      <div className="best-head">
        <CropArt crop={best.crop_name} size={60} className="best-photo" />
        <div className="min-w-0">
          <span className="rank-chip"><Award size={14} aria-hidden="true" />{t("cr.best.badge")}</span>
          <p className="best-name">{cropName(t, best.crop_name)}</p>
        </div>
      </div>

      <div className="best-stats">
        <Stat big icon={TrendingUp} label={t("cr.best.profit")} value={signedRupees(e.net_profit)} tone={e.net_profit < 0 ? "neg" : null}
          sub={t("cr.best.profitSub", { cost: compactRupees(e.total_cost) })} />
        <Stat icon={Coins} label={t("cr.best.priceLabel")} value={rupees(e.selling_price)}
          sub={[t("cr.best.priceSub"), monthYear(response.selling_date)]} />
        <Stat icon={Gauge} label={t("cr.best.score")} value={`${Math.round(best.recommendation_score)}/100`}
          sub={[t("cr.best.rankValue", { rank: best.rank, total: response.results.length }),
            best.profit_rank ? t("cr.best.profitRankValue", { rank: best.profit_rank }) : null]} />
        <Stat icon={CalendarCheck} label={t("cr.best.harvestLabel")} value={harvestSpan(tl)} sub={t("cr.best.plantSub", { month: monthLabel(tl.planting) })} />
        {rel === "unavailable" && (
          <Stat icon={ShieldCheck} label={t("cr.best.reliabilityLabel")} value={t(`cr.rel.${rel}`)} sub={t(`cr.rel.${rel}Sub`)} />
        )}
      </div>
    </section>
  );
}
