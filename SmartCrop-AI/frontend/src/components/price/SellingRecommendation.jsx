import { CalendarCheck, CircleCheck, Lightbulb, Scale, TriangleAlert, Warehouse } from "lucide-react";
import ServerText from "../ServerText";
import { useT } from "../../i18n/LanguageContext";
import { fmtDate, pct, rupees, shortDate, signedRupees } from "../../utils/format";
import { activePlan } from "../../utils/storagePlan";

const days = (t, n) => t(Math.abs(n) === 1 ? "unit.day" : "unit.days", { n });

function Cell({ label, tag, date, price, value, sub, tone, rec, testid }) {
  const t = useT();
  return (
    <div className={`sell-cell${rec ? " is-rec" : ""}${tone ? ` ${tone}` : ""}`} data-testid={testid}>
      <span className="sell-cell-label">{label}{tag && <span className="sell-rec-tag"><CircleCheck size={12} aria-hidden="true" />{tag}</span>}</span>
      {date !== undefined && <span className="sell-cell-date">{date ? fmtDate(date) : "—"}</span>}
      {price !== undefined && <span className="sell-cell-price">{price == null ? "—" : rupees(price)}{price != null && <span className="unit"> {t("unit.perQuintal")}</span>}</span>}
      {value !== undefined && <span className="sell-cell-value">{value}</span>}
      {sub && <span className="sell-cell-sub">{sub}</span>}
    </div>
  );
}

const cap = (x) => (x ? `${x[0].toUpperCase()}${x.slice(1)}` : "");

/** The green "Storage advice" panel, exactly two short lines from the API's storage plan for THIS crop: (1) what the crop keeps for under this
 *  storage, (2) whether the recommended wait fits, with one short precaution. Without a plan (older responses) only the crop's general note shows. */
function StorageAdvice({ t, crop, plan, storage, c, alt, best, hold, assumed }) {
  let fit;
  if (alt && c.wait_days < 0) fit = t("sa.fit.earlier");
  else if (alt) fit = t("sa.fit.within", { n: days(t, Math.abs(c.wait_days)) });
  else if (best && plan && hold === 0) fit = t("sa.fit.noHold");
  else if (best && c.beyond_storage) fit = t("sa.fit.beyond");
  else if (best) fit = t("sa.fit.noWait");
  else fit = t("sa.fit.noCompare");
  const keeps = plan ? (plan.range ? cap(plan.range) : t("sa.about", { days: days(t, hold) })) : t("sa.about", { days: days(t, storage?.farm_hold_days ?? storage?.max_hold_days ?? 0) });
  const facility = plan ? plan.facility_label.toLowerCase() : t("sa.ordinary");
  const approx = !plan || plan.approximate || plan.confidence === "low";
  const precaution = plan?.advice?.[0];
  return (
    <div className="sell-store sa-panel" data-testid="storage-advice">
      <h3><Warehouse size={16} aria-hidden="true" />{t("sa.title")}</h3>
      <p data-testid="sa-line1">{t("sa.line1", { crop, keeps, facility })}{assumed ? ` ${t("sa.assumed")}` : ""}{approx ? ` ${t("sa.approx")}` : ""}</p>
      <p data-testid="sa-line2">{fit}{precaution ? <> <ServerText>{precaution}</ServerText></> : null}</p>
    </div>
  );
}

/**
 * Smart Selling Recommendation, read from the API's 60-day `window` (the same daily predictions the chart draws). The recommended date is
 * the highest predicted price among the dates the crop can practically wait for: the storage deadline is the planned date plus the days
 * the crop keeps under the farmer's storage (window.storage.plans). The highest price of the whole window is shown separately.
 */
export default function SellingRecommendation({ win, storage, crop, storageKey = null }) {
  const t = useT();
  if (!win) return <p className="muted small" data-testid="sell-unavailable">{t("sw.unavailable")}</p>;
  const plan = activePlan(win, storageKey);
  const validatedCmp = plan ? plan.comparison : win.comparison;
  // Provisional: nothing can be compared on validated days, but the model's experimental estimates (same daily series, same storage deadline)
  // can. They are shown only when clearly labelled as unvalidated, never as a validated optimum.
  const exp = plan ? plan.experimental : win.experimental;
  const usable = (x) => x?.code === "alternative" || x?.code === "planned_is_best";
  const provisional = !usable(validatedCmp) && validatedCmp.code !== "outside_window" && usable(exp?.comparison) && exp?.planned?.price != null;
  const c = provisional ? exp.comparison : validatedCmp;
  const planned = provisional ? { ...win.planned, status: "validated", price: exp.planned.price } : win.planned;
  const alt = c.code === "alternative";
  const best = c.code === "planned_is_best";
  const earlier = alt && c.wait_days < 0;
  const hold = plan ? plan.hold_days : (storage.farm_hold_days ?? storage.max_hold_days);

  const overStorage = best && Boolean(c.beyond_storage);      // a higher price exists, but only after the crop's storage deadline
  const chip = provisional ? { Icon: TriangleAlert, tone: "warn", key: "provisional" } : alt ? { Icon: CalendarCheck, tone: "good", key: earlier ? "earlier" : "later" }
    : overStorage ? { Icon: TriangleAlert, tone: "warn", key: "storage" }
      : best ? { Icon: CircleCheck, tone: "good", key: "best" } : { Icon: Scale, tone: "neutral", key: "none" };

  let plannedNote = null;
  if (provisional) plannedNote = t("sw.prov.note");
  else if (planned.status === "unavailable") plannedNote = t("sw.planned.unavailable");
  else if (planned.status === "validated" && !planned.in_window) plannedNote = t("sw.planned.outside", { n: win.days });

  // "Why this date?": one short sentence that adds to (never repeats) the four cards
  let why;
  if (alt) {
    why = t(earlier ? "sw.why1.earlier" : "sw.why1.later", { date: shortDate(c.date), diff: rupees(Math.abs(c.diff)), pct: pct(Math.abs(c.diff_pct ?? 0), 1).replace("+", "") });
  } else if (best && plan && hold === 0) {
    why = t("sw.why1.noHold", { crop });
  } else if (best && c.beyond_storage) {
    why = t("sw.why1.beyond", { crop });
  } else if (best) why = t("sw.why1.best");
  else if (c.code === "outside_window") why = t("sw.why1.outside", { n: win.days });
  else why = t("sw.why1.none");
  if (provisional) why = t("sw.why1.prov", { text: why });

  const showCells = alt || best;
  return (
    <div className={`sell-card ${chip.tone}`} data-testid="sell-card" data-outcome={provisional ? "provisional" : c.code}>
      <div className="sell-badge" data-testid="sell-chip"><chip.Icon size={18} aria-hidden="true" />{t(`sw.chip.${chip.key}`)}</div>

      <div className="sell-summary ss-summary" data-testid="sell-four">
        <Cell testid="sw-planned" label={t("price.sell.planned")} date={planned.date}
          {...(planned.status === "validated" ? { price: planned.price } : { value: t("sw.unavailable.short") })} sub={plannedNote} />
        <Cell testid="sw-rec" label={t("ss.alt")} rec={showCells && !provisional} tag={showCells ? t(provisional ? "sw.prov.tag" : "price.sell.recTag") : null}
          {...(alt ? { date: c.date, price: c.price, sub: t(earlier ? "ss.rec.earlier" : "ss.rec.later", { n: days(t, Math.abs(c.wait_days)) }) }
            : best ? { date: planned.date, price: planned.price, sub: t("ss.rec.planned") }
              : { value: t("sw.unavailable.short"), sub: t(c.code === "outside_window" ? "sw.alt.outsideSub" : "sw.alt.unavailableSub") })} />
        <Cell testid="sw-diff" label={t("price.sell.diff")} tone={alt && c.diff > 0 ? "is-up" : ""}
          {...(alt ? { value: <>{c.diff > 0 ? "+" : ""}{signedRupees(c.diff)} <small>({pct(c.diff_pct, 1)})</small></>, sub: t("ss.diff.sub") }
            : best ? { value: t("ss.diff.zero"), sub: null } : { value: t("sw.unavailable.short"), sub: null })} />
        <Cell testid="sw-wait" label={t(earlier ? "price.sell.daysBefore" : "price.sell.waitTime")}
          value={alt ? days(t, Math.abs(c.wait_days)) : best ? days(t, 0) : t("sw.unavailable.short")} />
      </div>
      {
        <div className="sell-why">
          <h3><Lightbulb size={16} aria-hidden="true" />{t("price.sell.whyTitle")}</h3>
          <p data-testid="sell-why">{why}</p>
        </div>
      }

      <StorageAdvice t={t} crop={crop} plan={plan} storage={storage} c={c} alt={alt} best={best} hold={hold} assumed={storageKey == null} />
    </div>
  );
}
