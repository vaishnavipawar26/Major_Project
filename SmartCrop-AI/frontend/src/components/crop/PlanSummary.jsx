import { ArrowRight, CalendarClock, LandPlot, MapPin } from "lucide-react";
import { useT } from "../../i18n/LanguageContext";
import { cropName, monthLabel } from "../../utils/format";

/** Section 1 - the farmer's own plan in a few short lines. */
export default function PlanSummary({ response, crop }) {
  const t = useT();
  const tl = crop?.timeline;
  const months = tl && (tl.growth_months_min === tl.growth_months_max ? `${tl.growth_months_min}` : `${tl.growth_months_min}–${tl.growth_months_max}`);
  return (
    <section className="card plan-summary" aria-label={t("cr.plan.title")}>
      <p className="plan-place"><MapPin size={18} aria-hidden="true" />{cropName(t, response.city, "city")}, {cropName(t, response.state, "state")}</p>
      <p className="plan-dates">
        <span>{t("cr.plan.plant")} <strong>{monthLabel(response.planting_date)}</strong></span>
        <ArrowRight size={16} aria-hidden="true" />
        <span>{t("cr.plan.sell")} <strong>{monthLabel(response.selling_date)}</strong></span>
      </p>
      <p className="plan-meta">
        <span className="inline-icon"><LandPlot size={15} aria-hidden="true" />{t(response.area_acres === 1 ? "cr.plan.acre" : "cr.plan.acres", { n: response.area_acres })}</span>
        {months && <span className="inline-icon"><CalendarClock size={15} aria-hidden="true" />{t("cr.plan.growing", { crop: cropName(t, crop.crop_name), months })}</span>}
      </p>
    </section>
  );
}
