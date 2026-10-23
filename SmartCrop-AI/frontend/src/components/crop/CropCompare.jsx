import { useMemo, useState } from "react";
import { IndianRupee } from "lucide-react";
import ChartIntro from "../ChartIntro";
import ProfitComparisonChart from "../charts/ProfitComparisonChart";
import { useT } from "../../i18n/LanguageContext";
import { chartNote, compareRows } from "../../utils/cropPlan";
import { monthLabel } from "../../utils/format";

/** Section 3 - every crop side by side as a clickable profit chart (clicking a bar picks the crop shown below). */
export default function CropCompare({ response, selected, onSelect }) {
  const t = useT();
  const [breakdown, setBreakdown] = useState(false);
  const rows = useMemo(() => compareRows(response.results, response, t), [response, t]);
  const month = monthLabel(response.selling_date);
  const note = useMemo(() => chartNote(response, t), [response, t]);

  return (
    <section className="card compare-section" aria-labelledby="compare-title">
      <h2 id="compare-title" className="sr-only">{t("cr.compare.title")}</h2>
      <ChartIntro icon={IndianRupee} title={t("cr.compare.chartTitle", { month })}>
        {t("cr.compare.chartDesc", { n: rows.length, area: response.area_acres })}
      </ChartIntro>
      <ProfitComparisonChart rows={rows} selected={selected} onSelect={onSelect} breakdown={breakdown} />

      {note && <p className="compare-note" data-testid="chart-note">{note}</p>}

      <button type="button" className="btn-link small mt-3" onClick={() => setBreakdown((s) => !s)} aria-pressed={breakdown}>
        {breakdown ? t("cr.chart.hideBreakdown") : t("cr.chart.showBreakdown")}
      </button>
    </section>
  );
}
