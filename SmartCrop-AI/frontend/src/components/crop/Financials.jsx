import { useMemo, useState } from "react";
import { ArrowRight, ChartLine, TriangleAlert } from "lucide-react";
import Alert from "../Alert";
import ChartIntro from "../ChartIntro";
import MonthlyPriceChart, { MonthlyPriceTable, buildPriceRows } from "../charts/MonthlyPriceChart";
import BestTimeHero from "./BestTimeHero";
import { useT } from "../../i18n/LanguageContext";
import { bestSellTime, reliabilityOf } from "../../utils/cropPlan";
import { cropName, monthLabel, rupees, signedRupees } from "../../utils/format";

/** Sales → costs → money left: the profit arithmetic in three boxes, profit first in size. */
function ProfitFlow({ e }) {
  const t = useT();
  const loss = e.net_profit < 0;
  return (
    <div className="flow" role="group" aria-label={t("cr.fin.flowAria")}>
      <div className="flow-box">
        <span className="flow-label">{t("cr.fin.sales")}</span>
        <strong className="num">{rupees(e.gross_revenue)}</strong>
      </div>
      <ArrowRight className="flow-arrow" size={20} aria-hidden="true" />
      <div className="flow-box">
        <span className="flow-label">{t("cr.fin.costs")}</span>
        <strong className="num">− {rupees(e.total_cost)}</strong>
      </div>
      <ArrowRight className="flow-arrow" size={20} aria-hidden="true" />
      <div className={`flow-box flow-result ${loss ? "is-loss" : ""}`}>
        <span className="flow-label">{loss ? t("cr.fin.netLoss") : t("cr.fin.net")}</span>
        <strong className="num">{signedRupees(e.net_profit)}</strong>
        <span className="flow-sub">{t("cr.fin.netRange", { low: signedRupees(e.net_profit_low), high: signedRupees(e.net_profit_high) })}</span>
      </div>
    </div>
  );
}

/** Section 4 - when to sell, how much it may earn, the price graph and a short money summary. */
export default function Financials({ result, response }) {
  const t = useT();
  const [showTable, setShowTable] = useState(false);
  const e = result.economics, m = result.market;
  const crop = cropName(t, result.crop_name);
  const rel = reliabilityOf(result);
  const month = monthLabel(response.selling_date);
  const ok = e && result.feasible;
  const best = ok && m ? bestSellTime(result, response) : null;
  const rows = useMemo(() => (m ? buildPriceRows(m, result.selling_options) : []), [m, result.selling_options]);

  return (
    <section className="card" aria-labelledby="fin-title">
      <h2 id="fin-title" className="cr-h2">{t("cr.fin.title", { crop })}</h2>
      {!result.feasible && <Alert type="warn">{t(`cr.fin.${e?.status === "spoiled" ? "spoiled" : "notReady"}`, { crop })}</Alert>}
      {best && <BestTimeHero result={result} response={response} reliable={rel === "tested"} />}
      {ok && <ProfitFlow e={e} />}
      {m && rel !== "tested" && (
        <p className="fin-warn" role="status"><TriangleAlert size={16} aria-hidden="true" />
          {t(m.beyond_model_horizon ? "cr.fin.beyondWarning" : "cr.fin.limitedWarning")}</p>
      )}

      <div className="fin-grid">
        <div className="min-w-0">
          {m ? (
            <>
              <ChartIntro icon={ChartLine} title={t("cr.fin.chartTitle")} />
              <MonthlyPriceChart market={m} rows={rows} sellingMonth={response.selling_date} bestMonth={best?.month} />
            </>
          ) : <Alert type="info">{t("cr.fin.noForecast")}</Alert>}
        </div>

        {ok && (
          <div className="min-w-0">
            <h3 className="section-title">{t("cr.fin.summary")}</h3>
            <dl className="money">
              <dt>{t("cr.fin.price", { month })}</dt><dd className="num"><strong>{rupees(e.selling_price)}</strong> {t("unit.perQuintal")}</dd>
              <dt>{t("cr.fin.range")}</dt><dd className="num">{rupees(e.price_low)} – {rupees(e.price_high)}</dd>
              <dt>{t("cr.fin.harvest")}</dt><dd className="num">{t("cr.fin.harvestValue", { q: e.effective_yield_q })}</dd>
              <dt>{t("cr.fin.breakEven")}<span className="money-hint">{t("cr.fin.breakEvenHint")}</span></dt>
              <dd className="num">{rupees(e.break_even_price)} {t("unit.perQuintal")}</dd>
            </dl>
          </div>
        )}
      </div>

      {m && (
        <>
          <div className="fin-foot">
            <p>{t("cr.fin.footNote", { dataEnd: monthLabel(m.latest_month) })}</p>
            <button type="button" className="btn-link small" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable}>
              {t(showTable ? "cr.chart.hideMonthly" : "cr.chart.viewMonthly")} <ArrowRight size={14} aria-hidden="true" />
            </button>
          </div>
          {showTable && <MonthlyPriceTable rows={rows} sellingMonth={response.selling_date} bestMonth={best?.month} />}
        </>
      )}
    </section>
  );
}
