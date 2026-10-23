import { CalendarClock, MapPin } from "lucide-react";
import { useT } from "../../i18n/LanguageContext";
import { fieldSizeText } from "../../utils/fieldSize";
import { cropName, monthLabel } from "../../utils/format";

/** Section 1 - the farmer's own plan in a few short lines. */
export default function PlanSummary({ response, crop }) {
  const t = useT();
  const tl = crop?.timeline;
  const months = tl && (tl.growth_months_min === tl.growth_months_max ? `${tl.growth_months_min}` : `${tl.growth_months_min}–${tl.growth_months_max}`);
  return (
    <section className="card plan-summary" aria-label={t("cr.plan.title")}>
      <p className="plan-place"><MapPin size={20} aria-hidden="true" />{cropName(t, response.city, "city")}, {cropName(t, response.state, "state")}</p>
      <dl className="plan-facts">
        <div><dt>{t("cr.plan.plantLabel")}</dt><dd>{monthLabel(response.planting_date)}</dd></div>
        <div><dt>{t("cr.plan.sellLabel")}</dt><dd>{monthLabel(response.selling_date)}</dd></div>
        <div><dt>{t("cr.plan.sizeLabel")}</dt><dd>{fieldSizeText(t, response.area_acres)}</dd></div>
      </dl>
      {months && <p className="plan-meta"><span className="inline-icon"><CalendarClock size={15} aria-hidden="true" />{t("cr.plan.growing", { crop: cropName(t, crop.crop_name), months })}</span></p>}
    </section>
  );
}
