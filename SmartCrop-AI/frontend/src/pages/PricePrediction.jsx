import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, ShoppingBasket } from "lucide-react";
import Alert from "../components/Alert";
import FormField from "../components/FormField";
import Loader from "../components/Loader";
import PageHero from "../components/PageHero";
import SproutSpinner from "../components/SproutSpinner";
import marketPhoto from "../assets/photos/market.webp";
import { useAsync } from "../hooks/useAsync";
import { useT } from "../i18n/LanguageContext";
import { errorMessage } from "../services/api";
import { priceService } from "../services/priceService";
import { addDays, cropName, dayRanges, daysBetween, fmtDate } from "../utils/format";

export const LAST_PRICE_REQUEST_KEY = "smartcrop_last_price_request";
const DEFAULT_TARGET_DAYS = 10;
const FIELD_ORDER = ["commodity", "market", "target_date"];

/** Move keyboard focus (and the screen) to the first field with an error. */
const focusFirstError = (errs) => {
  const first = FIELD_ORDER.find((k) => errs[k]);
  const el = first && document.getElementById(first);
  if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: "center", behavior: "smooth" }); }
};

export default function PricePrediction() {
  const t = useT();
  const navigate = useNavigate();
  const { data: opts, loading, error, reload } = useAsync(() => priceService.options(), []);
  const [form, setForm] = useState({ commodity: "", market: "", target_date: "" });
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const commodity = useMemo(() => opts?.commodities.find((c) => c.commodity === form.commodity), [opts, form.commodity]);
  const market = useMemo(() => commodity?.markets.find((m) => m.market === form.market), [commodity, form.market]);
  const minTarget = opts ? addDays(opts.today, 1) : "";
  const maxTarget = opts ? addDays(opts.today, opts.max_horizon_days) : "";
  const projected = opts && opts.today > opts.data_end;

  // sensible defaults once options load: first crop, its state-wide series, a date 10 days ahead
  useEffect(() => {
    if (!opts || form.commodity) return;
    const c = opts.commodities[0];
    setForm({ commodity: c.commodity, market: c.markets[0].market, target_date: addDays(opts.today, DEFAULT_TARGET_DAYS) });
  }, [opts, form.commodity]);

  const onCommodity = (e) => {
    const c = opts.commodities.find((x) => x.commodity === e.target.value);
    setForm((f) => ({ ...f, commodity: c.commodity, market: c.markets[0].market }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.commodity) errs.commodity = t("price.form.errCrop");
    if (!form.market) errs.market = t("price.form.errMarket");
    if (!form.target_date) errs.target_date = t("price.form.errDate");
    else if (form.target_date < minTarget || form.target_date > maxTarget)
      errs.target_date = t("price.form.errDateRange", { min: fmtDate(minTarget), max: fmtDate(maxTarget) });
    setErrors(errs);
    if (Object.keys(errs).length) { focusFirstError(errs); return; }

    const req = {
      state: commodity.states[0] || "Maharashtra", market: form.market, commodity: form.commodity,
      variety: market.default_variety, target_date: form.target_date,
    };
    setSubmitting(true);
    setApiError(null);
    try {
      const prediction = await priceService.predict(req);
      // later re-opens of this result must use the same start date, not a new "today"
      const saved = { ...req, as_of: prediction.input_date };
      try { sessionStorage.setItem(LAST_PRICE_REQUEST_KEY, JSON.stringify({ req: saved, prediction })); } catch { /* ignore */ }
      navigate("/price-prediction/result", { state: { req: saved, prediction } });
    } catch (err) {
      setApiError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Loader label={t("price.form.loading")} />;
  if (error) {
    return <Alert type="error" action={<button type="button" className="btn btn-secondary" onClick={reload}>{t("common.retry")}</button>}>{error}</Alert>;
  }

  const validated = commodity?.validated_horizons ?? [];
  const days = form.target_date ? daysBetween(opts.today, form.target_date) : null;
  const errorCount = Object.keys(errors).length;

  return (
    <>
      <PageHero image={marketPhoto} alt={t("art.marketAlt")} title={t("price.form.title")}>{t("price.form.subtitle")}</PageHero>

      <form className="card form-card" style={{ marginTop: "1rem" }} onSubmit={submit} noValidate>
        {apiError && <div style={{ marginBottom: "1rem" }}><Alert type="error">{apiError}</Alert></div>}
        {errorCount > 0 && <div style={{ marginBottom: "1rem" }}><Alert type="error">{t("form.fixErrors", { n: errorCount })}</Alert></div>}
        <p className="required-note">{t("form.requiredNote")}</p>

        <div className="form-section">
          <h2 className="section-title form-step"><ShoppingBasket size={19} aria-hidden="true" />{t("price.form.stepWhat")}</h2>
          <div className="form-grid">
            <FormField id="commodity" label={t("price.form.crop")} required error={errors.commodity}
              help={t("price.form.cropHelp")}>
              <select id="commodity" value={form.commodity} onChange={onCommodity}>
                {opts.commodities.map((c) => <option key={c.commodity} value={c.commodity}>{cropName(t, c.commodity)}</option>)}
              </select>
            </FormField>
            <FormField id="market" label={t("price.form.market")} required error={errors.market}
              help={t("price.form.marketHelp")}
              hint={market?.is_state_aggregate ? t("price.form.marketHintAll")
                : t("price.form.marketHintDates", { from: fmtDate(market?.first_date), to: fmtDate(market?.last_date) })}>
              <select id="market" value={form.market} onChange={(e) => setForm((f) => ({ ...f, market: e.target.value }))}>
                {commodity?.markets.map((m) => (
                  <option key={m.market} value={m.market}>{m.is_state_aggregate ? t("price.form.allMarkets") : m.market}</option>
                ))}
              </select>
            </FormField>
            <FormField id="state" label={t("price.form.state")} hint={t("price.form.stateHint")}>
              <select id="state" value={commodity?.states[0] || "Maharashtra"} disabled>
                <option value={commodity?.states[0] || "Maharashtra"}>{cropName(t, commodity?.states[0] || "Maharashtra", "state")}</option>
              </select>
            </FormField>
          </div>
        </div>

        <div className="form-section">
          <h2 className="section-title form-step"><CalendarDays size={19} aria-hidden="true" />{t("price.form.stepWhen")}</h2>
          <div className="form-grid">
            <FormField id="target_date" label={t("price.form.date")} required error={errors.target_date}
              help={t("price.form.dateHelp", { n: opts.max_horizon_days })}
              hint={days != null && days > 0
                ? t(days === 1 ? "price.form.dateHintDay" : "price.form.dateHintDays", { n: days })
                : undefined}>
              <input id="target_date" type="date" min={minTarget} max={maxTarget}
                value={form.target_date} onChange={(e) => setForm((f) => ({ ...f, target_date: e.target.value }))} />
            </FormField>
            <div className="forecast-start">
              <span className="stat-label">{t("price.form.startsFrom")}</span>
              <strong>{t("price.form.today", { date: fmtDate(opts.today) })}</strong>
              <span className="muted small">{t("price.form.autoData")}</span>
            </div>
          </div>

          {days != null && days > 0 && !validated.includes(days) && (
            <div style={{ marginTop: "0.9rem" }}>
              <Alert type="warn" title={t("price.form.roughTitle")}>
                {t("price.form.roughBody", { crop: cropName(t, form.commodity), n: days })}
                {validated.length > 0 && <> {t("price.form.roughValidated", { crop: cropName(t, form.commodity), days: dayRanges(validated) })}</>}
              </Alert>
            </div>
          )}
          {projected && (
            <p className="muted small" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
              {t("price.form.projectedNote", { date: fmtDate(opts.data_end), inflation: opts.inflation_annual_pct })}
            </p>
          )}
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary btn-lg" disabled={submitting}>
            {submitting && <SproutSpinner inButton />}{submitting ? t("price.form.submitting") : t("price.form.submit")}
          </button>
        </div>
      </form>
      {opts.unsupported_series > 0 && (
        <p className="muted small" style={{ marginTop: "0.75rem" }}>
          {t("price.form.hiddenSeries", { n: opts.unsupported_series })}
        </p>
      )}
    </>
  );
}
