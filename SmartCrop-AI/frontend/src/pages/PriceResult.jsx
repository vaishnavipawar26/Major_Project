import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ArrowLeft, ChartNoAxesCombined, CircleCheck, Minus, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";
import Alert from "../components/Alert";
import DirectionBadge from "../components/DirectionBadge";
import EmptyState from "../components/EmptyState";
import Loader from "../components/Loader";
import PriceTrendChart from "../components/charts/PriceTrendChart";
import { errorMessage } from "../services/api";
import { historyService } from "../services/historyService";
import { priceService } from "../services/priceService";
import { ADVICE_STYLE } from "../utils/constants";
import { addDays, dayRanges, fmtDate, pct, rupees, signedRupees } from "../utils/format";
import { LAST_PRICE_REQUEST_KEY } from "./PricePrediction";

const ALGORITHMS = { random_forest: "Random Forest", xgboost: "XGBoost" };
const algorithmName = (a) => a.replace(/^(random_forest|xgboost)/, (m) => ALGORITHMS[m]);
const IMPACT = {
  higher: { cls: "impact-up", icon: TrendingUp, text: "Supports a higher price" },
  lower: { cls: "impact-down", icon: TrendingDown, text: "Supports a lower price" },
  small: { cls: "impact-small", icon: Minus, text: "Small influence" },
};
const plural = (n, word) => `${n} ${word}${Math.abs(n) === 1 ? "" : "s"}`;

/** Resolve the request to display: navigation state → ?id from history → last session result. */
function useResultSource() {
  const location = useLocation();
  const [params] = useSearchParams();
  const id = params.get("id");
  const [source, setSource] = useState(() => {
    if (location.state?.req) return { req: location.state.req, forecast: location.state.prediction };
    if (!id) {
      try {
        const s = JSON.parse(sessionStorage.getItem(LAST_PRICE_REQUEST_KEY));
        if (s?.req?.target_date) return { req: s.req, forecast: s.prediction };
      } catch { /* ignore */ }
    }
    return null;
  });
  const [error, setError] = useState(null);

  useEffect(() => {
    if (source || !id) return;
    historyService.priceItem(id).then((p) => setSource({
      fromHistory: true,
      saved: p,
      req: { state: p.state, market: p.market, commodity: p.commodity, variety: p.variety,
        as_of: p.input_date, target_date: addDays(p.input_date, p.horizon_days) },
    })).catch((e) => setError(errorMessage(e)));
  }, [id, source]);
  return { source, error, missing: !source && !id };
}

function ImpactPill({ impact }) {
  const m = IMPACT[impact] || IMPACT.small;
  const Icon = m.icon;
  return <span className={`impact ${m.cls}`}><Icon size={13} aria-hidden="true" />{m.text}</span>;
}

function StorageCostCalculator({ advice }) {
  const [cost, setCost] = useState("");
  const perDay = Number(cost);
  const valid = cost !== "" && !Number.isNaN(perDay) && perDay >= 0;
  const total = valid ? perDay * advice.wait_days : null;
  const net = valid ? advice.extra_per_quintal - total : null;
  return (
    <div className="calc">
      <label htmlFor="storage-cost" className="small" style={{ fontWeight: 600 }}>
        Your storage cost (₹ per quintal per day, optional)
      </label>
      <div className="row" style={{ marginTop: 4 }}>
        <input id="storage-cost" type="number" min="0" step="any" inputMode="decimal" placeholder="e.g. 5"
          value={cost} onChange={(e) => setCost(e.target.value)} style={{ maxWidth: 140 }} />
        {valid && (
          <span className="small">
            {plural(advice.wait_days, "day")} × {rupees(perDay)} = {rupees(total)} storage →
            {" "}<strong className={net >= 0 ? "text-good" : "text-bad"}>
              expected net {net >= 0 ? "gain" : "loss"} {rupees(Math.abs(net))} per quintal
            </strong>
          </span>
        )}
      </div>
      <p className="muted small" style={{ margin: "4px 0 0" }}>
        We don't know your storage costs, so enter them to see the expected gain after storage. Transport,
        commission and quality loss are not included.
      </p>
    </div>
  );
}

function AdviceCard({ advice, commodity }) {
  const style = ADVICE_STYLE[advice.code] || ADVICE_STYLE.NO_CLEAR_DIFFERENCE;
  const AdviceIcon = style.icon;
  const moved = advice.recommended_date !== advice.target_date;
  const peak = advice.peak;
  const showPeak = peak.date !== advice.recommended_date && peak.diff_vs_target > 0;
  return (
    <section className={`card suggestion ${style.tone}`} aria-labelledby="advice-title">
      <span className="stat-label">Best time to sell</span>
      <div className="suggestion-label" id="advice-title"><AdviceIcon size={22} aria-hidden="true" />{advice.label}</div>

      <dl className="advice-grid">
        <div><dt>Recommended selling date</dt><dd className="big">{fmtDate(advice.recommended_date)}</dd></div>
        <div><dt>Predicted price then</dt><dd className="big">{rupees(advice.recommended_price)}<span className="unit"> /quintal</span></dd></div>
        <div><dt>Price on your date ({fmtDate(advice.target_date, { day: "numeric", month: "short" })})</dt><dd>{rupees(advice.target_price)}</dd></div>
        <div><dt>Expected extra per quintal</dt><dd>{moved ? signedRupees(advice.extra_per_quintal) : "₹0"}</dd></div>
        <div><dt>Price difference</dt><dd>{moved ? pct(advice.extra_pct) : "0%"}</dd></div>
        <div><dt>{advice.wait_days < 0 ? "Days earlier than planned" : "Additional days to wait"}</dt>
          <dd>{plural(Math.abs(advice.wait_days), "day")}</dd></div>
      </dl>

      <p style={{ marginTop: 12 }}>{advice.explanation}</p>
      {showPeak && (
        <p className="small text-2">
          Highest predicted price in the forecast window: <strong>{rupees(peak.price)}</strong> on {fmtDate(peak.date)}
          {" "}({signedRupees(peak.diff_vs_target)}, {pct(peak.diff_pct)} vs your date)
          {peak.date > advice.target_date && advice.code !== "WAIT" ? " — not recommended because the difference is within the model's usual error or beyond safe storage time." : "."}
        </p>
      )}
      {advice.wait_days > 0 && <StorageCostCalculator advice={advice} />}

      <div className="storage-note">
        <strong>Storage for {commodity}: {advice.storage.category.toLowerCase()}</strong>
        <p className="small" style={{ margin: "2px 0 0" }}>{advice.storage.note} We only compare dates up to
          {" "}{plural(advice.storage.max_hold_days, "day")} after your date for this crop. (General guidance, not from the model.)</p>
      </div>

      <details style={{ marginTop: 10 }}>
        <summary>Before you decide, check</summary>
        <ul className="list small" style={{ marginTop: 6 }}>
          {advice.considerations.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </details>
      <p className="muted small" style={{ margin: "10px 0 0" }}>{advice.disclaimer}</p>
    </section>
  );
}

function WhyCard({ explain, error, forecast }) {
  const [which, setWhich] = useState(0);
  const exps = explain?.explanations || [];
  const exp = exps[Math.min(which, exps.length - 1)];
  const point = exp && forecast.path.find((p) => p.horizon_days === exp.horizon_days);
  return (
    <section className="card">
      <div className="card-title">
        <h2>Why is this price predicted?</h2>
        {exps.length > 1 && (
          <div className="segmented" role="radiogroup" aria-label="Explain which date">
            {exps.map((e, i) => (
              <button key={e.date} type="button" role="radio" aria-checked={which === i}
                className={which === i ? "active" : ""} onClick={() => setWhich(i)}>
                {i === 0 ? "Your date" : "Suggested date"}
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <Alert type="error">{error}</Alert>}
      {!explain && !error && <Loader label="Working out the main reasons…" />}
      {explain && !exp && <Alert type="info">{explain.message || "No explanation is available for this forecast."}</Alert>}
      {exp && (
        <div className="stack">
          <p className="text-2" style={{ margin: 0 }}>
            For {fmtDate(exp.date)} the model expects {point ? <strong>{rupees(point.predicted_price)}</strong> : "this price"}
            {" "}({pct(exp.prediction_change_pct)} from the starting price). The factors it relied on most:
          </p>
          {exp.all_small && (
            <Alert type="info">No single factor stood out. The forecast stays close to the model's usual expectation for this crop.</Alert>
          )}
          <ul className="factor-list">
            {exp.factors.slice(0, 3).map((f) => (
              <li key={f.factor}>
                <div className="factor-head"><strong>{f.title}</strong><ImpactPill impact={f.impact} /></div>
                <p className="small" style={{ margin: "4px 0 0" }}>
                  {f.observation}
                  {f.impact !== "small" && <> The model links this to a {f.impact} predicted price (about {pct(f.effect_pct)}).</>}
                </p>
              </li>
            ))}
          </ul>
          {exp.factors.length > 3 && (
            <details>
              <summary>Other factors</summary>
              <ul className="factor-list compact" style={{ marginTop: 8 }}>
                {exp.factors.slice(3).map((f) => (
                  <li key={f.factor}><div className="factor-head"><span>{f.title}</span><ImpactPill impact={f.impact} /></div></li>
                ))}
              </ul>
            </details>
          )}
          <p className="muted small" style={{ margin: 0 }}>
            These are patterns the model learned from past mandi prices. They show what the forecast relied on, not
            proven causes of price changes.
          </p>
        </div>
      )}
    </section>
  );
}

function ReliabilityCard({ forecast }) {
  const t = forecast.target;
  const validated = forecast.path.filter((p) => p.beats_baseline).map((p) => p.horizon_days);
  return (
    <section className="card">
      <h2>How reliable is this forecast?</h2>
      <dl className="kv" style={{ marginTop: 8 }}>
        <dt>Average error in testing</dt>
        <dd>{rupees(t.model_mae)} per quintal at {plural(t.horizon_days, "day")} ahead
          {" "}(assuming no change: {rupees(t.baseline_mae)})</dd>
        <dt>Your date</dt>
        <dd className="inline-icon">{t.beats_baseline
          ? <><CircleCheck size={15} className="text-good" aria-hidden="true" />Validated</>
          : <><TriangleAlert size={15} className="text-warn" aria-hidden="true" />Not validated — rough guide</>}</dd>
        <dt>Validated days ahead</dt>
        <dd>{validated.length ? dayRanges(validated) : `None for ${forecast.series.commodity}`}</dd>
        <dt>Typical error at your date</dt><dd>about ±{t.stable_band_pct.toFixed(0)}%</dd>
        <dt>Model at your date</dt><dd>{algorithmName(forecast.model.algorithm)}, one direct prediction per day (no recursion)</dd>
        <dt>Mandi data up to</dt><dd>{fmtDate(forecast.model.data_end)}</dd>
      </dl>
      <p className="muted small" style={{ margin: "10px 0 0" }}>
        "Validated" means that, when tested on 2025 data, the model's forecasts for {forecast.series.commodity} were
        closer to the real price than simply assuming the price stays the same.
      </p>
    </section>
  );
}

export default function PriceResult() {
  const { source, error: sourceError, missing } = useResultSource();
  const [forecast, setForecast] = useState(source?.forecast || null);
  const [explain, setExplain] = useState(null);
  const [error, setError] = useState(null);
  const [explainError, setExplainError] = useState(null);

  useEffect(() => {
    if (!source) return;
    if (source.forecast) setForecast(source.forecast);
    else priceService.trend(source.req).then(setForecast).catch((e) => setError(errorMessage(e)));
    priceService.explain(source.req).then(setExplain).catch((e) => setExplainError(errorMessage(e)));
  }, [source]);

  if (missing) {
    return <EmptyState icon={ChartNoAxesCombined} title="No prediction to show"
      action={<Link className="btn btn-primary" to="/price-prediction">Make a prediction</Link>}>
      Start a new price prediction first.</EmptyState>;
  }
  if (sourceError || error) return <Alert type="error">{sourceError || error}</Alert>;
  if (!forecast) return <Loader label="Preparing your forecast…" />;

  const { series, target: t, advice } = forecast;
  const validated = t.beats_baseline;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Crop Price Forecast</h1>
          <p><strong>{series.commodity}</strong> · {series.market} · {series.state}</p>
          <div className="chips">
            <span className="chip">Forecast generated {fmtDate(forecast.input_date)}</span>
            <span className="chip chip-brand">Your date {fmtDate(forecast.target_date)}</span>
          </div>
        </div>
        <Link to="/price-prediction" className="btn btn-secondary"><ArrowLeft size={16} aria-hidden="true" />New prediction</Link>
      </div>

      {source.fromHistory && (
        <div className="mb-1">
          <Alert type="info">Opened from your history and recalculated with the current model. The saved prediction
            was {rupees(source.saved.predicted_price)} per quintal.</Alert>
        </div>
      )}
      {forecast.projection && (
        <div className="mb-1">
          <Alert type="warn" title="Seasonal projection">
            Mandi prices in this app end on {fmtDate(forecast.model.data_end)}, so there are no real prices for the last few
            weeks. This forecast uses the price pattern from the same time last year
            ({fmtDate(forecast.projection.reference_origin_date)}), raised by about {forecast.projection.inflation_annual_pct}%
            {" "}per year for inflation. Please compare with today's mandi prices.
          </Alert>
        </div>
      )}
      {!forecast.projection && forecast.forecast_origin_date !== forecast.input_date && (
        <div className="mb-1">
          <Alert type="info">No price was reported on {fmtDate(forecast.input_date)}, so the forecast starts from the
            last reported day, {fmtDate(forecast.forecast_origin_date)}.</Alert>
        </div>
      )}

      <div className="result-top">
        <section className="card hero-card" aria-labelledby="hero-label">
          <span className="stat-label" id="hero-label">Predicted price on {fmtDate(t.date)}</span>
          <div className="hero-price">{rupees(t.predicted_price)}<span className="unit"> per quintal</span></div>
          <div className="stat-sub">Likely range {rupees(t.lower)} – {rupees(t.upper)}</div>
          <div className="row" style={{ marginTop: 10 }}>
            <DirectionBadge direction={t.direction} />
            <span className="small text-2">{pct(t.change_pct)} vs starting price {rupees(forecast.current_price)}</span>
          </div>
          <div className="hero-meta">
            <div><span className="stat-label">Starting price</span><strong>{rupees(forecast.current_price)}</strong>
              <span className="muted small">{forecast.projection ? "projected" : "reported"} {fmtDate(forecast.forecast_origin_date)}</span></div>
            <div><span className="stat-label">Days ahead</span><strong>{t.horizon_days}</strong></div>
          </div>
          <span className={`reliability ${validated ? "ok" : "weak"}`}>
            {validated
              ? <><CircleCheck size={15} aria-hidden="true" />Validated forecast horizon</>
              : <><TriangleAlert size={15} aria-hidden="true" />Less reliable — use as a rough guide</>}
          </span>
          {t.actual_price != null && (
            <p className="small" style={{ margin: "8px 0 0" }}>
              Actual price on that day: <strong>{rupees(t.actual_price)}</strong>
            </p>
          )}
        </section>
        <AdviceCard advice={advice} commodity={series.commodity} />
      </div>

      <section className="card">
        <div className="card-title">
          <div>
            <h2>Price forecast</h2>
            <p className="muted small" style={{ margin: 0 }}>
              Daily predictions from {fmtDate(forecast.forecast_origin_date)}
              {forecast.path.length > t.horizon_days ? ` to ${fmtDate(forecast.path[forecast.path.length - 1].date)} so you can compare later dates.` : "."}
            </p>
          </div>
        </div>
        <PriceTrendChart history={forecast.history} historyIsReference={forecast.history_is_reference}
          actualAfter={forecast.actual_after_origin} path={forecast.path}
          originDate={forecast.forecast_origin_date} currentPrice={forecast.current_price}
          targetDate={forecast.target_date} recommendedDate={advice.recommended_horizon_days > 0 ? advice.recommended_date : null} />
        {forecast.path.some((p) => !p.beats_baseline) && (
          <p className="small text-2" style={{ marginTop: 8 }}>
            {forecast.validated_days > 0
              ? <>Grey dotted parts are days where, in testing, the model was not more accurate than assuming today's
                price stays the same for {series.commodity}. They are not used for the selling advice.</>
              : <>For {series.commodity} the model was not more accurate than assuming no price change at any horizon, so the
                whole forecast is a rough guide.</>}
            {forecast.last_validated_days < forecast.max_horizon_days && forecast.path.length < forecast.max_horizon_days &&
              <> The chart stops at {fmtDate(forecast.path[forecast.path.length - 1].date)} because later dates are not validated.</>}
          </p>
        )}
      </section>

      <div className="grid result-bottom">
        <WhyCard explain={explain} error={explainError} forecast={forecast} />
        <ReliabilityCard forecast={forecast} />
      </div>

      <p className="muted small" style={{ marginTop: "1rem" }}>{forecast.disclaimer}</p>
    </>
  );
}
