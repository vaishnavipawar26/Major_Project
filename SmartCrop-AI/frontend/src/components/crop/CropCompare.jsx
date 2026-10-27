import { useMemo, useState } from "react";
import { IndianRupee } from "lucide-react";
import ChartIntro from "../ChartIntro";
import ProfitComparisonChart from "../charts/ProfitComparisonChart";
import { useT } from "../../i18n/LanguageContext";
import { areaBasis, compareRows, sellableSummary, whySelected } from "../../utils/cropPlan";
import { fieldSizeText } from "../../utils/fieldSize";
import { monthLabel } from "../../utils/format";

/** Section 3 - every crop side by side as a clickable profit chart (clicking a bar picks the crop shown below). */
export default function CropCompare({ response, selected, onSelect }) {
  const t = useT();
  const [breakdown, setBreakdown] = useState(false);
  const rows = useMemo(() => compareRows(response.results, response, t), [response, t]);
  const month = monthLabel(response.selling_date);
  const why = useMemo(() => whySelected(response, t), [response, t]);
  const basis = areaBasis(response);

  return (
    <section className="card compare-section" aria-labelledby="compare-title">
      <h2 id="compare-title" className="sr-only">{t("cr.compare.title")}</h2>
      <ChartIntro icon={IndianRupee} title={t("cr.compare.chartTitle", { month })}>
        {t("cr.compare.chartDesc", { size: fieldSizeText(t, basis.acres), summary: sellableSummary(response, t).text })}
      </ChartIntro>
      <ProfitComparisonChart rows={rows} selected={selected} onSelect={onSelect} breakdown={breakdown} />

      {why && (
        <div className="compare-why" data-testid="chart-note">
          <h3 className="compare-why-title">{why.title}</h3>
          {why.lines.map((l) => <p key={l}>{l}</p>)}
        </div>
      )}

      <button type="button" className="btn-link small mt-3" onClick={() => setBreakdown((s) => !s)} aria-pressed={breakdown}>
        {breakdown ? t("cr.chart.hideBreakdown") : t("cr.chart.showBreakdown")}
      </button>
    </section>
  );
}
