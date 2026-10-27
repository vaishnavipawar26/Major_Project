import CropTimeline from "../CropTimeline";
import GrowthCycle from "./GrowthCycle";
import { useT } from "../../i18n/LanguageContext";

/** Section 5 - planting to selling, five stages, then the crop's typical biological cycle compared with it. */
export default function TimelineSection({ result }) {
  const t = useT();
  return (
    <section className="card" aria-labelledby="timeline-title">
      <h2 id="timeline-title" className="cr-h2">{t("cr.timeline.pageTitle")}</h2>
      <CropTimeline timeline={result.timeline} />
      <GrowthCycle result={result} />
    </section>
  );
}
