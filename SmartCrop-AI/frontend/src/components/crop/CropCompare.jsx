import { useMemo, useState } from "react";
import { CircleCheck, CircleHelp, CircleX, IndianRupee, TriangleAlert } from "lucide-react";
import ChartIntro from "../ChartIntro";
import CropArt from "../CropArt";
import ProfitComparisonChart from "../charts/ProfitComparisonChart";
import RankingCompare from "./RankingCompare";
import { useT } from "../../i18n/LanguageContext";
import { compareRows } from "../../utils/cropPlan";
import { compactRupees, monthLabel, rupees, signedRupees } from "../../utils/format";

const TONE_ICON = { good: CircleCheck, warn: TriangleAlert, bad: CircleX, neutral: CircleHelp };

function Fit({ part }) {
  const t = useT();
  const all = part.within === part.total;
  const Icon = all ? CircleCheck : part.within >= part.total / 2 ? TriangleAlert : CircleX;
  return (
    <span className={`fit ${all ? "is-good" : part.within >= part.total / 2 ? "is-warn" : "is-bad"}`}>
      <Icon size={14} aria-hidden="true" />{t("cr.table.fit", { n: part.within, total: part.total })}
    </span>
  );
}

/** Section 3 - every crop side by side: clickable profit chart, then a table with the exact numbers. */
export default function CropCompare({ response, selected, onSelect }) {
  const t = useT();
  const [breakdown, setBreakdown] = useState(false);
  const rows = useMemo(() => compareRows(response.results, response, t), [response, t]);
  const month = monthLabel(response.selling_date);

  return (
    <section className="card compare-section" aria-labelledby="compare-title">
      <h2 id="compare-title" className="cr-h2">{t("cr.compare.title")}</h2>
      <ChartIntro icon={IndianRupee} title={t("cr.compare.chartTitle", { month })}>
        {t("cr.compare.chartDesc", { n: rows.length, area: response.area_acres })}
      </ChartIntro>
      <ProfitComparisonChart rows={rows} selected={selected} onSelect={onSelect} breakdown={breakdown} />

      <RankingCompare response={response} />

      <button type="button" className="btn-link small mt-3" onClick={() => setBreakdown((s) => !s)} aria-pressed={breakdown}>
        {breakdown ? t("cr.chart.hideBreakdown") : t("cr.chart.showBreakdown")}
      </button>

      <div className="table-wrap mt-3">
        <table className="compare-table">
          <caption className="sr-only">{t("cr.table.caption")}</caption>
          <thead>
            <tr>
              <th scope="col" className="num">{t("cr.table.rank")}</th>
              <th scope="col">{t("table.crop")}</th>
              <th scope="col" className="num">{t("cr.table.price", { month })}</th>
              <th scope="col" className="num">{t("cr.table.costs")}</th>
              <th scope="col" className="num">{t("cr.table.profit")}</th>
              <th scope="col" className="num">{t("cr.table.roi")}</th>
              <th scope="col" className="num">{t("cr.table.profitRank")}</th>
              <th scope="col">{t("cr.table.soil")}</th>
              <th scope="col">{t("cr.table.weather")}</th>
              <th scope="col">{t("cr.table.timing")}</th>
              <th scope="col">{t("cr.table.forecast")}</th>
              <th scope="col">{t("cr.table.status")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const Icon = TONE_ICON[r.status.tone];
              const priceOk = r.feasible && r.price != null;
              return (
                <tr key={r.crop} className={r.crop === selected ? "is-selected" : ""}>
                  <td className="num">#{r.rank}</td>
                  <th scope="row">
                    <button type="button" className="crop-cell" onClick={() => onSelect(r.crop)} aria-pressed={r.crop === selected}>
                      <CropArt crop={r.crop} size={30} decorative />{r.name}
                    </button>
                  </th>
                  <td className="num">{r.price != null ? rupees(r.price) : "—"}</td>
                  <td className="num">{priceOk ? compactRupees(r.cost) : "—"}</td>
                  <td className={`num font-bold ${priceOk && r.profit < 0 ? "text-neg" : ""}`}>{priceOk ? signedRupees(r.profit) : "—"}</td>
                  <td className="num">{priceOk ? `${r.roi > 0 ? "+" : ""}${Math.round(r.roi)}%` : "—"}</td>
                  <td className="num">{priceOk && r.profitRank ? `#${r.profitRank}` : "—"}</td>
                  <td><Fit part={r.soil} /></td>
                  <td><Fit part={r.weather} /></td>
                  <td>{t(`cr.timing.${r.timing}`)}</td>
                  <td>{t(`cr.rel.${r.reliability}`)}</td>
                  <td><span className={`status-pill is-${r.status.tone}`}><Icon size={13} aria-hidden="true" />{t(`cr.status.${r.status.key}`)}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small !mb-0 mt-2">{t("cr.table.note")} {t("cr.table.sortNote")}</p>
    </section>
  );
}
