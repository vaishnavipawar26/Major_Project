import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, MapPin, ShoppingBasket } from "lucide-react";
import Alert from "../components/Alert";
import FormField from "../components/FormField";
import LockedState from "../components/LockedState";
import Loader from "../components/Loader";
import PageHero from "../components/PageHero";
import SproutSpinner from "../components/SproutSpinner";
import GrowingLocationField from "../components/price/GrowingLocationField";
import marketPhoto from "../assets/photos/market.webp";
import { useAsync } from "../hooks/useAsync";
import { useT } from "../i18n/LanguageContext";
import { errorMessage } from "../services/api";
import { priceService } from "../services/priceService";
import { addDays, cropName, fmtDate } from "../utils/format";

export const LAST_PRICE_REQUEST_KEY = "smartcrop_last_price_request";
const FIELD_ORDER = ["commodity", "market", "growing_location", "target_date"];

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
  // where the crop is grown (separate from the selling market): the typed text and the place picked from the location search
  const [growing, setGrowing] = useState({ text: "", place: null, down: false });
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const commodity = useMemo(() => opts?.commodities.find((c) => c.commodity === form.commodity), [opts, form.commodity]);
  const market = useMemo(() => commodity?.markets.find((m) => m.market === form.market), [commodity, form.market]);
  const minTarget = opts ? addDays(opts.today, 1) : "";
  const maxTarget = opts ? addDays(opts.today, opts.max_horizon_days) : "";
  const dateOk = Boolean(form.target_date) && form.target_date >= minTarget && form.target_date <= maxTarget;
  // a place picked from the search; only while the search service is down can typed text be sent as it is (it is looked up again later)
  const growingOk = Boolean(growing.place) || (growing.down && growing.text.trim().length >= 2);
  const complete = Boolean(commodity && market && dateOk && growingOk);
  // a place chosen after a failed submit clears that field's error (and the error count above the form)
  useEffect(() => {
    if (growingOk) setErrors((e) => { if (!e.growing_location) return e; const { growing_location: _, ...rest } = e; return rest; });
  }, [growingOk]);

  // choosing a crop resets the market: each crop has its own list
  const onCommodity = (e) => setForm((f) => ({ ...f, commodity: e.target.value, market: "" }));

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.commodity) errs.commodity = t("price.form.errCrop");
    if (!form.market) errs.market = t("price.form.errMarket");
    if (!growing.text.trim()) errs.growing_location = t("price.form.errGrowing");
    else if (!growingOk) errs.growing_location = t("price.form.errGrowingPick");
    if (!form.target_date) errs.target_date = t("price.form.errDate");
    else if (form.target_date < minTarget || form.target_date > maxTarget)
      errs.target_date = t("price.form.errDateRange", { min: fmtDate(minTarget), max: fmtDate(maxTarget) });
    setErrors(errs);
    if (Object.keys(errs).length) { focusFirstError(errs); return; }

    const req = {
      state: commodity.states[0] || "Maharashtra", market: form.market, commodity: form.commodity,
      variety: market.default_variety, target_date: form.target_date,
      growing_location: growing.place
        ? { name: growing.place.label, latitude: growing.place.latitude, longitude: growing.place.longitude }
        : { name: growing.text.trim() },
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

  const errorCount = Object.keys(errors).length;

  return (
    <>
      <PageHero image={marketPhoto} alt={t("art.marketAlt")} title={t("price.form.title")}>{t("price.form.subtitle")}</PageHero>

      <form className="card form-card price-form" style={{ marginTop: "1rem" }} onSubmit={submit} noValidate>
        {apiError && <div style={{ marginBottom: "1rem" }}><Alert type="error">{apiError}</Alert></div>}
        {errorCount > 0 && <div style={{ marginBottom: "1rem" }}><Alert type="error">{t("form.fixErrors", { n: errorCount })}</Alert></div>}

        <div className="form-section">
          <h2 className="section-title form-step"><ShoppingBasket size={19} aria-hidden="true" />{t("price.form.stepWhat")}</h2>
          <div className="form-grid form-grid-3">
            <LockedState label={t("price.form.state")} hint={t("price.form.stateCovers")} />
            <FormField id="commodity" label={t("price.form.crop")} error={errors.commodity}>
              <select id="commodity" value={form.commodity} onChange={onCommodity}>
                <option value="" disabled>{t("price.form.chooseCrop")}</option>
                {opts.commodities.map((c) => <option key={c.commodity} value={c.commodity}>{cropName(t, c.commodity)}</option>)}
              </select>
            </FormField>
            <FormField id="market" label={t("price.form.market")} error={errors.market}>
              <select id="market" value={form.market} disabled={!commodity} onChange={(e) => setForm((f) => ({ ...f, market: e.target.value }))}>
                <option value="" disabled>{t("price.form.chooseMarket")}</option>
                {commodity?.markets.map((m) => (
                  <option key={m.market} value={m.market}>{m.is_state_aggregate ? t("price.form.allMarkets") : m.market}</option>
                ))}
              </select>
            </FormField>
          </div>
        </div>

        <div className="form-section">
          <h2 className="section-title form-step"><MapPin size={19} aria-hidden="true" />{t("price.form.stepWhere")}</h2>
          <GrowingLocationField value={growing} onChange={setGrowing} error={errors.growing_location} />
        </div>

        <div className="form-section">
          <h2 className="section-title form-step"><CalendarDays size={19} aria-hidden="true" />{t("price.form.stepWhen")}</h2>
          <FormField id="target_date" label={t("price.form.date")} error={errors.target_date}>
            <div className={`date-ph${form.target_date ? "" : " is-empty"}`} data-placeholder={t("price.form.chooseDate")}>
              <input id="target_date" type="date" min={minTarget} max={maxTarget}
                value={form.target_date} onChange={(e) => setForm((f) => ({ ...f, target_date: e.target.value }))} />
            </div>
          </FormField>
          <p className="muted small forecast-start-line">{t("price.form.startPoint", { date: fmtDate(opts.today) })}</p>
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary btn-lg" disabled={submitting || !complete}>
            {submitting && <SproutSpinner inButton />}{submitting ? t("price.form.submitting") : t("price.form.submit")}
          </button>
        </div>
      </form>
    </>
  );
}
