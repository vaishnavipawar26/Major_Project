import { CalendarCheck, CircleCheck, Lightbulb, Scale, TriangleAlert, Warehouse } from "lucide-react";
import ServerText from "../ServerText";
import { useT } from "../../i18n/LanguageContext";
import { fmtDate, pct, rupees, signedRupees } from "../../utils/format";

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
 * Smart Selling Recommendation, read from the API's 30-day `window` (the same daily predictions the chart draws): the farmer's planned
 * date and its predicted price, the best other date with the difference, an explanation from those two figures, then storage advice.
 */
export default function SellingRecommendation({ win, storage, crop }) {
  const t = useT();
  if (!win) return <p className="muted small" data-testid="sell-unavailable">{t("sw.unavailable")}</p>;
  const { planned, comparison: c } = win;
  const alt = c.code === "alternative";
  const best = c.code === "planned_is_best";
  const farmDays = storage.farm_hold_days ?? storage.max_hold_days;
  const earlier = alt && c.wait_days < 0;

  const chip = alt ? { Icon: CalendarCheck, tone: "good", key: earlier ? "earlier" : "later" }
    : best ? { Icon: CircleCheck, tone: "good", key: "best" } : { Icon: Scale, tone: "neutral", key: "none" };

  let plannedNote = null;
  if (planned.status !== "validated") plannedNote = t(planned.status === "unavailable" ? "sw.planned.unavailable" : "sw.planned.notValidated");
  else if (!planned.in_window) plannedNote = t("sw.planned.outside", { n: win.days });

  let why;
  if (alt) why = t(earlier ? "sw.why.earlier" : "sw.why.later", { date: longDate(c.date), diff: rupees(Math.abs(c.diff)), pct: pct(Math.abs(c.diff_pct ?? 0), 1).replace("+", "") });
  else if (best) why = t("sw.why.best");
  else if (c.code === "outside_window") why = t("sw.why.outside", { n: win.days });
  else if (win.validation?.mode === "context_only") why = t("sw.why.policy", { crop, reason: win.validation.reasons?.[0] || "" });
  else why = t(c.reason === "planned_not_validated" ? "sw.why.noPlanned" : "sw.why.noDates");

  return (
    <div className={`sell-card ${chip.tone}`} data-testid="sell-card" data-outcome={c.code}>
      <div className="sell-badge" data-testid="sell-chip"><chip.Icon size={18} aria-hidden="true" />{t(`sw.chip.${chip.key}`)}</div>

      <div className="sell-summary">
        <Cell testid="sw-planned" label={t("price.sell.planned")} date={planned.date} price={planned.status === "validated" ? planned.price : null}
          sub={plannedNote} tag={best ? t("sw.bestTag") : null} rec={best} />
        {alt ? (
          <Cell testid="sw-alt" label={t("price.sell.alt")} date={c.date} price={c.price} rec tag={t("price.sell.recTag")} />
        ) : best ? (
          <Cell testid="sw-alt" label={t("price.sell.alt")} value={t("sw.alt.none")} sub={t("sw.alt.noneSub")} />
        ) : (
          <Cell testid="sw-alt" label={t("price.sell.alt")} value={t("sw.alt.unavailable")} sub={t(c.code === "outside_window" ? "sw.alt.outsideSub" : "sw.alt.unavailableSub")} />
        )}
        {alt ? (
          <Cell testid="sw-diff" label={t("price.sell.diff")} tone={c.diff > 0 ? "is-up" : ""} sub={t("price.sell.beforeCosts")}
            value={<>{c.diff > 0 ? "+" : ""}{signedRupees(c.diff)} <small>({pct(c.diff_pct, 1)})</small></>} />
        ) : <Cell testid="sw-diff" label={t("price.sell.diff")} value="—" />}
        {alt ? (
          <Cell testid="sw-wait" label={t(earlier ? "price.sell.daysBefore" : "price.sell.waitTime")} value={days(t, c.wait_days)} />
        ) : <Cell testid="sw-wait" label={t("price.sell.waitTime")} value="—" />}
      </div>

      <div className="sell-why">
        <h3><Lightbulb size={16} aria-hidden="true" />{t("price.sell.whyTitle")}</h3>
        <p data-testid="sell-why">{why}</p>
      </div>

      <div className="sell-store" data-testid="sell-store">
        <h3><Warehouse size={16} aria-hidden="true" />{t("price.sell.storageTitle")}</h3>
        <p className="sell-store-general">
          <ServerText>{storage.note}</ServerText>{" "}
          {t("price.advice.keepsFarm", { days: days(t, farmDays) })}
          {storage.max_hold_days > farmDays && <> {t("price.advice.keepsGood", { days: days(t, storage.max_hold_days) })}</>}
        </p>
        {c.beyond_storage && (
          <p className="sell-store-general" data-testid="sw-beyond">{t("sw.beyond", { crop, date: longDate(c.beyond_storage.date), price: rupees(c.beyond_storage.price), days: days(t, farmDays) })}</p>
        )}
      </div>

      <p className="sell-note" data-testid="sw-caution"><TriangleAlert size={15} aria-hidden="true" />{t("sw.caution")}</p>
    </div>
  );
}
