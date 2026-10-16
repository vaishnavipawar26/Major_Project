import { CircleCheck, CircleX, Hourglass, IndianRupee, Package, ShoppingBasket, Sprout, TriangleAlert } from "lucide-react";
import { useT } from "../i18n/LanguageContext";
import { monthLabel } from "../utils/format";

const STATUS = {
  fresh: { icon: CircleCheck, tone: "is-good" },
  stored: { icon: TriangleAlert, tone: "is-warn" },
  not_ready: { icon: CircleX, tone: "is-bad" },
  spoiled: { icon: CircleX, tone: "is-bad" },
};

function Stage({ kind, icon: Icon, label, value, sub, muted }) {
  return (
    <li className={`tl-stage tl-${kind} ${muted ? "is-muted" : ""}`}>
      <span className="tl-dot" aria-hidden="true"><Icon size={16} /></span>
      <span className="tl-text">
        <span className="tl-label">{label}</span>
        <strong className="tl-value">{value}</strong>
        {sub && <span className="tl-sub">{sub}</span>}
      </span>
    </li>
  );
}

/**
 * Planting → growing → harvest → possible storage → selling. Horizontal on wide screens, vertical on
 * phones. A one-line conclusion says whether the selling month fits the crop cycle.
 */
export default function CropTimeline({ timeline: t }) {
  const tr = useT();
  const st = STATUS[t.status];
  const grow = t.growth_months_min === t.growth_months_max ? `${t.growth_months_min}` : `${t.growth_months_min}–${t.growth_months_max}`;
  const harvest = t.harvest_start === t.harvest_end ? monthLabel(t.harvest_start) : `${monthLabel(t.harvest_start)} – ${monthLabel(t.harvest_end)}`;
  const canStore = t.storable && t.max_storage_months > 0;
  const args = { n: t.months_stored, sell: monthLabel(t.selling), harvest, max: t.max_storage_months };

  return (
    <div>
      <ol className="tl-stages" aria-label={tr("cr.timeline.sub")}>
        <Stage kind="plant" icon={Sprout} label={tr("timeline.phase.plant")} value={monthLabel(t.planting)}
          sub={t.planting_in_window ? tr("timeline.inWindow") : tr("timeline.outsideWindow")} />
        <Stage kind="grow" icon={Hourglass} label={tr("timeline.phase.grow")} value={tr("timeline.growsValue", { n: grow })} />
        <Stage kind="harvest" icon={ShoppingBasket} label={tr("timeline.harvest")} value={harvest} />
        <Stage kind="store" icon={Package} label={tr("timeline.storageLabel")} muted={!canStore}
          value={canStore ? tr("timeline.storeUpTo", { n: t.max_storage_months }) : tr("timeline.noStorage")} />
        <Stage kind="sell" icon={IndianRupee} label={tr("timeline.selling")} value={monthLabel(t.selling)} />
      </ol>

      <p className={`tl-status ${st.tone}`}>
        <st.icon size={17} aria-hidden="true" /><span>{tr(`timeline.concl.${t.status}`, args)}</span>
      </p>
      {canStore && <p className="muted small !mb-0">{tr("timeline.storageGeneral")}</p>}
    </div>
  );
}
