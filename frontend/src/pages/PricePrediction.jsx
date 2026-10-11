import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Alert from "../components/Alert";
import FormField from "../components/FormField";
import Loader from "../components/Loader";
import { useAsync } from "../hooks/useAsync";
import { errorMessage } from "../services/api";
import { priceService } from "../services/priceService";
import { addDays, dayRanges, daysBetween, fmtDate } from "../utils/format";

export const LAST_PRICE_REQUEST_KEY = "smartcrop_last_price_request";
const DEFAULT_TARGET_DAYS = 10;

export default function PricePrediction() {
  const navigate = useNavigate();
  const { data: opts, loading, error } = useAsync(() => priceService.options(), []);
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
    if (!form.commodity) errs.commodity = "Choose a crop.";
    if (!form.market) errs.market = "Choose a market.";
    if (!form.target_date) errs.target_date = "Choose the date you plan to sell.";
    else if (form.target_date < minTarget || form.target_date > maxTarget)
      errs.target_date = `Choose a date between ${fmtDate(minTarget)} and ${fmtDate(maxTarget)}.`;
    setErrors(errs);
    if (Object.keys(errs).length) return;

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

  if (loading) return <Loader label="Loading supported crops and markets…" />;
  if (error) return <Alert type="error">{error}</Alert>;

  const validated = commodity?.validated_horizons ?? [];
  const days = form.target_date ? daysBetween(opts.today, form.target_date) : null;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Crop price prediction</h1>
          <p>Choose your crop, market and the date you plan to sell. We forecast the mandi price from today.</p>
        </div>
      </div>

      <form className="card" style={{ marginTop: "1rem" }} onSubmit={submit} noValidate>
        {apiError && <div style={{ marginBottom: "1rem" }}><Alert type="error">{apiError}</Alert></div>}
        <div className="form-grid">
          <FormField id="state" label="State" hint="Only Maharashtra is in the dataset.">
            <select id="state" value={commodity?.states[0] || "Maharashtra"} disabled>
              <option>{commodity?.states[0] || "Maharashtra"}</option>
            </select>
          </FormField>
          <FormField id="commodity" label="Crop" error={errors.commodity}>
            <select id="commodity" value={form.commodity} onChange={onCommodity}>
              {opts.commodities.map((c) => <option key={c.commodity}>{c.commodity}</option>)}
            </select>
          </FormField>
          <FormField id="market" label="Market"
            hint={market?.is_state_aggregate ? "Median of all reporting markets — the most reliable choice."
              : `Price data: ${fmtDate(market?.first_date)} – ${fmtDate(market?.last_date)}`}
            error={errors.market}>
            <select id="market" value={form.market} onChange={(e) => setForm((f) => ({ ...f, market: e.target.value }))}>
              {commodity?.markets.map((m) => <option key={m.market} value={m.market}>{m.market}</option>)}
            </select>
          </FormField>
          <FormField id="target_date" label="Date you plan to sell"
            hint={days != null && days > 0 ? `${days} day${days === 1 ? "" : "s"} from today. You can choose up to ${opts.max_horizon_days} days ahead.`
              : `You can choose up to ${opts.max_horizon_days} days ahead.`}
            error={errors.target_date}>
            <input id="target_date" type="date" min={minTarget} max={maxTarget}
              value={form.target_date} onChange={(e) => setForm((f) => ({ ...f, target_date: e.target.value }))} />
          </FormField>
        </div>

        <div className="forecast-start">
          <span className="stat-label">Forecast starts from</span>
          <strong>Today, {fmtDate(opts.today)}</strong>
          <span className="muted small">Market arrivals and recent prices are taken from the mandi data automatically.</span>
        </div>

        {days != null && days > 0 && !validated.includes(days) && (
          <div style={{ marginTop: "0.75rem" }}>
            <Alert type="warn">
              In testing, {form.commodity} forecasts {days} days ahead were not more accurate than simply assuming
              today's price stays the same. You will still get a forecast, but treat it as a rough guide.
              {validated.length > 0 && <> Validated days ahead for {form.commodity}: {dayRanges(validated)}.</>}
            </Alert>
          </div>
        )}
        {projected && (
          <p className="muted small" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
            Mandi prices in this app are available up to {fmtDate(opts.data_end)}. Forecasts from today are seasonal
            projections based on the same time of year, adjusted for about {opts.inflation_annual_pct}% inflation per year.
          </p>
        )}

        <div className="form-actions">
          <button type="submit" className="btn btn-primary btn-lg" disabled={submitting}>
            {submitting ? "Predicting…" : "Predict price"}
          </button>
        </div>
      </form>
      {opts.unsupported_series > 0 && (
        <p className="muted small" style={{ marginTop: "0.75rem" }}>
          {opts.unsupported_series} market series are hidden because they have fewer than 180 days of price reports.
        </p>
      )}
    </>
  );
}
