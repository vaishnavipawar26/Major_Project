import { CircleCheck, CircleX, Hourglass, IndianRupee, Package, ShoppingBasket, Sprout, Star } from "lucide-react";
import { SHORT_MONTHS, compactRupees, monthLabel } from "../utils/format";

const idx = (ym) => { const [y, m] = ym.split("-").map(Number); return y * 12 + m - 1; };
const ymOf = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;

const PHASES = {
  plant: { label: "Planting", cls: "bg-brand text-white" },
  grow: { label: "Growing", cls: "bg-brand-soft text-brand-strong" },
  harvest: { label: "Harvest window", cls: "bg-[#c9e4d2] text-brand-strong" },
  store: { label: "Storage possible", cls: "bg-[repeating-linear-gradient(135deg,#eef0ea_0_6px,#dfe3d8_6px_12px)] text-ink-2" },
};

const STATUS = {
  fresh: { icon: CircleCheck, cls: "text-good", text: "Freshly harvested in your selling month" },
  stored: { icon: Package, cls: "text-ink-2", text: "Sold from storage" },
  not_ready: { icon: CircleX, cls: "text-bad", text: "Not ready by your selling month" },
  spoiled: { icon: CircleX, cls: "text-bad", text: "Would spoil before your selling month" },
};

/** Month strip: planting → growing → harvest window → storage, with selling & optimal month markers. */
export default function CropTimeline({ timeline: t, crop }) {
  const start = idx(t.planting);
  const ends = [t.harvest_end, t.selling, t.storage_until, t.optimal_selling].filter(Boolean).map(idx);
  const end = Math.max(...ends) + 1;
  const months = Array.from({ length: end - start + 1 }, (_, k) => start + k);
  const hs = idx(t.harvest_start), he = idx(t.harvest_end), su = t.storage_until ? idx(t.storage_until) : null;
  const sell = idx(t.selling), opt = t.optimal_selling ? idx(t.optimal_selling) : null;

  const phaseOf = (i) => (i === start ? "plant" : i < hs ? "grow" : i <= he ? "harvest" : su && i <= su ? "store" : null);
  const st = STATUS[t.status];

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-2">
        <span className="inline-icon"><Sprout size={15} aria-hidden="true" />Plant <strong>{monthLabel(t.planting)}</strong>{!t.planting_in_window && " (outside usual window)"}</span>
        <span className="inline-icon"><Hourglass size={15} aria-hidden="true" />Grows {t.growth_months_min === t.growth_months_max ? t.growth_months_min : `${t.growth_months_min}–${t.growth_months_max}`} months</span>
        <span className="inline-icon"><ShoppingBasket size={15} aria-hidden="true" />Harvest <strong>{monthLabel(t.harvest_start)} – {monthLabel(t.harvest_end)}</strong></span>
        {t.max_storage_months > 0 && <span className="inline-icon"><Package size={15} aria-hidden="true" />Store up to {t.max_storage_months} months</span>}
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="grid min-w-max gap-0.5" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(52px, 1fr))` }}>
          {months.map((i) => {
            const p = phaseOf(i);
            return (
              <div key={i} className="relative pt-6">
                {i === sell && (
                  <span className="absolute left-1/2 top-0 -translate-x-1/2 whitespace-nowrap rounded bg-ink px-1.5 py-0.5 text-[11px] font-bold text-white">Sell</span>
                )}
                {opt != null && i === opt && opt !== sell && (
                  <span className="absolute left-1/2 top-0 -translate-x-1/2 whitespace-nowrap rounded border border-forecast bg-white px-1.5 py-0.5 text-[11px] font-bold text-ink"><span className="inline-flex items-center gap-0.5"><Star size={10} fill="currentColor" aria-hidden="true" />Best</span></span>
                )}
                <div className={`flex h-9 items-center justify-center rounded text-[11px] font-semibold ${p ? PHASES[p].cls : "bg-[#f4f5f1] text-ink-muted"} ${i === sell ? "ring-2 ring-ink ring-offset-1" : ""}`}
                  title={`${monthLabel(ymOf(i))}${p ? ` — ${PHASES[p].label}` : ""}`}>
                  {i === start ? <Sprout size={15} aria-label="Planting" /> : i === sell ? <IndianRupee size={14} aria-label="Selling" /> : ""}
                </div>
                <div className="mt-1 text-center text-[11px] text-ink-muted">
                  {SHORT_MONTHS[i % 12]}{(i % 12 === 0 || i === start) && <><br />{Math.floor(i / 12)}</>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="legend mt-2">
        {Object.entries(PHASES).filter(([k]) => k !== "store" || t.max_storage_months > 0).map(([k, v]) => (
          <span key={k}><span className={`swatch ${v.cls}`} style={{ width: 14, height: 10 }} />{v.label}</span>
        ))}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-line p-3 text-sm">
          <div className="text-ink-muted">Your selling month</div>
          <div className="inline-icon font-semibold"><st.icon size={16} className={st.cls} aria-hidden="true" />{monthLabel(t.selling)} — {st.text}{t.status === "stored" ? ` (${t.months_stored} mo)` : ""}</div>
        </div>
        {t.optimal_selling && (
          <div className="rounded-lg border border-line p-3 text-sm">
            <div className="text-ink-muted">Most profitable month to sell {crop}</div>
            <div className="inline-icon font-semibold"><Star size={15} fill="currentColor" className="text-[var(--warning)]" aria-hidden="true" />
              {monthLabel(t.optimal_selling)} — profit ≈ {compactRupees(t.optimal_net_profit)}
              {t.optimal_selling === t.selling && " (your choice)"}</div>
          </div>
        )}
      </div>
    </div>
  );
}
