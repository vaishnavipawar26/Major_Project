import { Flower2, Info, Leaf, Salad, Shovel, ShoppingBasket, Sprout, Wheat } from "lucide-react";
import { useT } from "../../i18n/LanguageContext";
import { growthCycleFor, SOURCES, stageCalendar } from "../../data/cropGrowthCycle";
import { cropName, monthShort } from "../../utils/format";

const STAGE_ICON = {
  nursery: Sprout, sowing: Shovel, transplant: Shovel, establish: Sprout, emergence: Sprout,
  vegetative: Leaf, tillering: Leaf, flowering: Flower2, heading: Flower2, curd: Flower2, head: Salad,
  bulb: Sprout, tuber: Sprout, grainFill: Wheat, harvest: ShoppingBasket,
};

/** "Oct", "Oct – Jan", or "Year-round" when a stage covers a whole year. */
function monthsText(t, s) {
  if (s.span >= 12) return t("gc.yearRound");
  return s.span === 1 ? monthShort(s.start.month) : `${monthShort(s.start.month)} – ${monthShort(s.end.month)}`;
}

/**
 * B. The crop's typical biological growing calendar: each stage with its usual months, from the
 * crop's own stage durations and main planting season — not from the months the user picked.
 */
function OriginalTimeline({ cal, crop }) {
  const t = useT();
  return (
    <ol className="gc-stages" aria-label={t("gc.stagesAria", { crop })}>
      {cal.stages.map((s) => {
        const Icon = STAGE_ICON[s.key] || Leaf;
        const tone = s.key === "harvest" ? "is-harvest" : s.key === "nursery" || s.key === "sowing" || s.key === "transplant" ? "is-pre" : "";
        return (
          <li key={s.key} className={`gc-stage ${tone}`}>
            <span className="gc-dot" aria-hidden="true"><Icon size={16} /></span>
            <span className="gc-text">
              <span className="gc-label">{t(s.key === "harvest" && cal.repeated ? "gc.stage.picking" : `gc.stage.${s.key}`)}</span>
              <strong className="gc-value">{monthsText(t, s)}</strong>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** "Original Crop Growing Timeline": compact month-by-stage calendar of the crop's typical growth. */
export default function GrowthCycle({ result }) {
  const t = useT();
  const crop = cropName(t, result.crop_name);
  const cycle = growthCycleFor(result.crop_name);
  const cal = stageCalendar(cycle, result.timeline?.planting_months);
  const sources = cycle ? cycle.sources.map((k) => SOURCES[k].label).join("; ") : "";
  return (
    <div className="gc" aria-labelledby="gc-title">
      <div className="gc-head">
        <h3 id="gc-title" className="gc-title">{t("gc.title")}</h3>
        <span className="gc-chip" title={cal ? t("gc.estimateTip", { sources }) : undefined}>
          {cal ? t("gc.estimateSeason", { season: t(`gc.season.${cal.season}`) }) : t("gc.estimateChip")}
        </span>
      </div>
      {cal
        ? <OriginalTimeline cal={cal} crop={crop} />
        : <p className="tl-status is-warn"><Info size={17} aria-hidden="true" /><span>{t("gc.noData", { crop })}</span></p>}
    </div>
  );
}
