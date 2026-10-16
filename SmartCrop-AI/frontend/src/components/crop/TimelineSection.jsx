import CropTimeline from "../CropTimeline";
import { useT } from "../../i18n/LanguageContext";
import { cropName } from "../../utils/format";

/** Section 5 - planting to selling, five stages. */
export default function TimelineSection({ result }) {
  const t = useT();
  return (
    <section className="card" aria-labelledby="timeline-title">
      <h2 id="timeline-title" className="cr-h2">{t("cr.timeline.title", { crop: cropName(t, result.crop_name) })}</h2>
      <CropTimeline timeline={result.timeline} />
    </section>
  );
}
