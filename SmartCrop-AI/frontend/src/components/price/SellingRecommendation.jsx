import { CalendarCheck, CircleCheck, Lightbulb, Scale, Warehouse } from "lucide-react";
import ServerText from "../ServerText";
import { useT } from "../../i18n/LanguageContext";
import { fmtDate, pct, rupees, signedRupees } from "../../utils/format";
import { activePlan, planKey } from "../../utils/storagePlan";

const longDate = (d) => fmtDate(d, { day: "numeric", month: "long", year: "numeric" });
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

/**
 * "Where will you keep it?" (and, for onion and wheat, "Condition of the produce"): option buttons, each showing how long that choice holds the
 * crop, so the farmer sees what a facility changes. Ordinary farm storage is the default; nothing beyond it is assumed.
 */
function Option({ active, label, sub, testid, onClick }) {
  return (
    <button type="button" role="radio" aria-checked={active} data-testid={testid} className={`ss-opt${active ? " is-on" : ""}`} onClick={onClick}>
      <span className="ss-opt-check" aria-hidden="true">{active ? <CircleCheck size={16} /> : <span className="ss-opt-dot" />}</span>
      <span className="ss-opt-text"><span className="ss-opt-label">{label}</span>{sub && <span className="ss-opt-sub">{sub}</span>}</span>
    </button>
  );
}

function StoragePicker({ st, plan, onChange }) {
  const t = useT();
  const holds = (p) => (p.hold_days > 0 ? t("ss.opt.holds", { days: days(t, p.hold_days) }) : t("ss.survival.none")) + (p.fallback ? ` · ${t("ss.opt.same")}` : "");
  return (
    <div className="ss-picker" data-testid="ss-picker">
      <div className="ss-group">
        <p className="ss-group-title" id="ss-fac-title">{t("ss.pick.facility")}</p>
        <div className="ss-options" role="radiogroup" aria-labelledby="ss-fac-title" data-testid="ss-facility" data-value={plan.facility}>
          {st.facilities.map((f) => {
            const p = st.plans[planKey(f.key, plan.profile)];
            return <Option key={f.key} testid={`ss-facility-${f.key}`} active={plan.facility === f.key} label={f.label} sub={p ? holds(p) : null}
              onClick={() => onChange(planKey(f.key, plan.profile))} />;
          })}
        </div>
        <p className="muted small ss-hint">{t("ss.pick.hint")}</p>
      </div>
      {st.profiles.length > 1 && (
        <div className="ss-group">
          <p className="ss-group-title" id="ss-prof-title">{t("ss.pick.profile")}</p>
          <div className="ss-options" role="radiogroup" aria-labelledby="ss-prof-title" data-testid="ss-profile" data-value={plan.profile}>
            {st.profiles.map((p) => {
              const q = st.plans[planKey(plan.facility, p.key)];
              return <Option key={p.key} testid={`ss-profile-${p.key}`} active={plan.profile === p.key} label={p.label} sub={q ? holds(q) : null}
                onClick={() => onChange(planKey(plan.facility, p.key))} />;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Smart Selling Recommendation, read from the API's 30-day `window` (the same daily predictions the chart draws). The recommended date is
 * the highest predicted price among the dates the crop can practically wait for: the storage deadline is the planned date plus the days
 * the crop keeps under the farmer's storage (window.storage.plans). The highest price of the whole window is shown separately.
 */
export default function SellingRecommendation({ win, storage, crop, storageKey = null, onStorageChange = () => {} }) {
  const t = useT();
  if (!win) return <p className="muted small" data-testid="sell-unavailable">{t("sw.unavailable")}</p>;
  const plan = activePlan(win, storageKey);
  const st = win.storage;
  const base = plan ? plan.comparison : win.comparison;
  // only a validated comparison is ever shown: the model's unvalidated estimates are never turned into prices on this card
  const c = base;
  const planned = win.planned;
  const alt = c.code === "alternative";
  const best = c.code === "planned_is_best";
  const earlier = alt && c.wait_days < 0;
  const hold = plan ? plan.hold_days : (storage.farm_hold_days ?? storage.max_hold_days);
  const highest = c.highest || (win.highest ? { ...win.highest, within_storage: null } : null);
  const recDate = alt ? c.date : best ? planned.date : null;
  const recPrice = alt ? c.price : best ? planned.price : null;

  const chip = alt ? { Icon: CalendarCheck, tone: "good", key: earlier ? "earlier" : "later" }
    : best ? { Icon: CircleCheck, tone: "good", key: "best" } : { Icon: Scale, tone: "neutral", key: "none" };

  let plannedNote = null;
  if (planned.status === "unavailable") plannedNote = t("sw.planned.unavailable");
  else if (planned.status === "validated" && !planned.in_window) plannedNote = t("sw.planned.outside", { n: win.days });

  // why this date, from the two prices, the storage deadline and (if any) the higher price that is out of reach
  let why;
  const within = plan && c.deadline ? t("ss.why.within", { crop, facility: plan.facility_label, days: days(t, hold), deadline: longDate(c.deadline) }) : "";
  if (alt) {
    why = t(earlier ? "sw.why.earlier" : "sw.why.later", { date: longDate(c.date), diff: rupees(Math.abs(c.diff)), pct: pct(Math.abs(c.diff_pct ?? 0), 1).replace("+", "") });
    if (!earlier && within) why += ` ${within}`;
  } else if (best && plan && hold === 0) {
    why = t("ss.why.noHold", { crop, reason: plan.basis });
  } else if (best && c.beyond_storage && plan) {
    why = t("ss.why.beyond", { price: rupees(c.beyond_storage.price), date: longDate(c.beyond_storage.date),
      n: Math.max(0, Math.round((Date.parse(c.beyond_storage.date) - Date.parse(planned.date)) / 86400000)), crop, facility: plan.facility_label,
      days: days(t, hold), deadline: longDate(c.deadline) });
  } else if (best) why = t("sw.why.best");
  else if (c.code === "outside_window") why = t("sw.why.outside", { n: win.days });
  else if (win.validation?.mode === "context_only") why = null;      // no comparison for this crop and distance: nothing to explain here
  else why = t(c.reason === "planned_not_validated" ? "sw.why.noPlanned" : "sw.why.noDates");

  const showCells = alt || best;
  return (
    <div className={`sell-card ${chip.tone}`} data-testid="sell-card" data-outcome={c.code}>
      <div className="sell-badge" data-testid="sell-chip"><chip.Icon size={18} aria-hidden="true" />{t(`sw.chip.${chip.key}`)}</div>

      <div className="sell-summary ss-summary">
        <Cell testid="sw-planned" label={t("price.sell.planned")} date={planned.date} price={planned.status === "validated" ? planned.price : undefined} sub={plannedNote} />
        <Cell testid="sw-rec" label={t("ss.rec")} rec={showCells} tag={showCells ? t("price.sell.recTag") : null}
          {...(showCells ? (best ? { value: t("ss.rec.planned"), sub: fmtDate(planned.date) } : { date: c.date, sub: t(earlier ? "ss.rec.earlier" : "ss.rec.later", { n: days(t, Math.abs(c.wait_days)) }) })
            : { value: t("ss.rec.unavailable"), sub: t(c.code === "outside_window" ? "sw.alt.outsideSub" : "sw.alt.unavailableSub") })} />
        {showCells && <Cell testid="sw-price" label={t("ss.price")} price={recPrice} />}
        {showCells && <Cell testid="sw-high" label={t("ss.high")} price={highest ? highest.price : null}
          sub={highest ? [fmtDate(highest.date), highest.within_storage === false ? t("ss.high.beyond") : highest.date === recDate ? t("ss.high.same") : null].filter(Boolean).join(" · ") : t("ss.high.none")}
          tone={highest && highest.within_storage === false ? "is-warn" : ""} />}
        {showCells && <Cell testid="sw-diff" label={t("price.sell.diff")} tone={alt && c.diff > 0 ? "is-up" : ""}
          {...(alt ? { value: <>{c.diff > 0 ? "+" : ""}{signedRupees(c.diff)} <small>({pct(c.diff_pct, 1)})</small></>, sub: t("ss.diff.sub") }
            : { value: t("ss.diff.zero"), sub: null })} />}
        {showCells && <Cell testid="sw-wait" label={t(earlier ? "price.sell.daysBefore" : "price.sell.waitTime")}
          value={alt ? days(t, Math.abs(c.wait_days)) : days(t, 0)} />}
        <Cell testid="sw-survival" label={t("ss.survival")}
          value={plan ? (hold > 0 ? t("ss.survival.about", { days: days(t, hold) }) : t("ss.survival.none")) : days(t, hold)}
          sub={plan ? plan.facility_label : null} />
        {showCells && c.days_left != null && <Cell testid="sw-left" label={t("ss.left")} value={days(t, c.days_left)}
          sub={c.deadline ? t("ss.left.sub", { date: fmtDate(c.deadline) }) : null} />}
      </div>

      {(why || (showCells && highest && recDate && highest.date !== recDate)) && (
        <div className="sell-why">
          <h3><Lightbulb size={16} aria-hidden="true" />{t("price.sell.whyTitle")}</h3>
          {why && <p data-testid="sell-why">{why}</p>}
          {showCells && highest && recDate && highest.date !== recDate && (
            <p className="muted small" data-testid="sw-differs">{t(highest.within_storage === false ? "ss.differs.storage" : "ss.differs.other")}</p>
          )}
        </div>
      )}

      <div className="sell-store" data-testid="sell-store">
        <h3><Warehouse size={16} aria-hidden="true" />{t("price.sell.storageTitle")}</h3>
        {plan && st && <StoragePicker st={st} plan={plan} onChange={onStorageChange} />}
        {plan ? (
          <>
            <div className="ss-summary-box" data-testid="ss-estimate">
              <strong>{plan.profile_label}</strong>
              <span><ServerText>{plan.range ? `${plan.range[0].toUpperCase()}${plan.range.slice(1)}.` : ""}</ServerText>{" "}
                {t("ss.deadline", { days: days(t, hold), date: c.deadline ? longDate(c.deadline) : "—" })}</span>
            </div>
            {plan.fallback && <p className="sell-store-general" data-testid="ss-fallback">{t("ss.fallback", { crop, used: plan.facility_label })}</p>}
            <div className="ss-two">
              <p className="sell-store-general" data-testid="ss-conditions"><span className="sell-store-tag">{t("ss.conditions")}</span> <ServerText>{plan.conditions}</ServerText></p>
              <p className="sell-store-general" data-testid="ss-risks"><span className="sell-store-tag">{t("ss.risks")}</span> <ServerText>{plan.risks}</ServerText></p>
            </div>
            <ul className="ss-advice" data-testid="ss-advice">{plan.advice.map((a) => <li key={a}><ServerText>{a}</ServerText></li>)}</ul>
            <p className="muted small" data-testid="ss-uncertainty"><ServerText>{plan.uncertainty}</ServerText></p>
            {plan.sources?.length > 0 && (
              <p className="muted small" data-testid="ss-sources">{t("ss.sources")}{" "}
                {plan.sources.map((s, i) => <span key={s.id}>{i > 0 && "; "}<a href={s.url} target="_blank" rel="noreferrer">{s.publisher}</a></span>)}
              </p>
            )}
          </>
        ) : (
          <p className="sell-store-general">
            <ServerText>{storage.note}</ServerText>{" "}
            {t("price.advice.keepsFarm", { days: days(t, storage.farm_hold_days ?? storage.max_hold_days) })}
            {storage.max_hold_days > (storage.farm_hold_days ?? storage.max_hold_days) && <> {t("price.advice.keepsGood", { days: days(t, storage.max_hold_days) })}</>}
          </p>
        )}
        {c.beyond_storage && !plan && (
          <p className="sell-store-general" data-testid="sw-beyond">{t("sw.beyond", { crop, date: longDate(c.beyond_storage.date), price: rupees(c.beyond_storage.price), days: days(t, hold) })}</p>
        )}
      </div>
    </div>
  );
}
