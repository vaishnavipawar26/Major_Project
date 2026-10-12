import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, BookOpen, ChartNoAxesCombined, CircleCheck, History, Lightbulb, Minus, TrendingDown, TrendingUp, TriangleAlert,
} from "lucide-react";
import Alert from "../components/Alert";
import CropArt from "../components/CropArt";
import EmptyState from "../components/EmptyState";
import Loader from "../components/Loader";
import ResultStep from "../components/ResultStep";
import ServerText from "../components/ServerText";
import Tip from "../components/Tip";
import TechnicalDetails from "../components/TechnicalDetails";
import PriceTrendChart from "../components/charts/PriceTrendChart";
import { useT } from "../i18n/LanguageContext";
import { errorMessage } from "../services/api";
import { historyService } from "../services/historyService";
import { priceService } from "../services/priceService";
import { ADVICE_STYLE, STATE_MARKET } from "../utils/constants";
import { addDays, cropName, dayRanges, fmtDate, pct, rupees, signedRupees } from "../utils/format";
import { LAST_PRICE_REQUEST_KEY } from "./PricePrediction";

const ALGORITHMS = { random_forest: "Random Forest", xgboost: "XGBoost" };
const algorithmName = (a) => a.replace(/^(random_forest|xgboost)/, (m) => ALGORITHMS[m]);
const IMPACT = {
  higher: { cls: "impact-up", icon: TrendingUp, text: "price.why.impactHigher" },
  lower: { cls: "impact-down", icon: TrendingDown, text: "price.why.impactLower" },
  small: { cls: "impact-small", icon: Minus, text: "price.why.impactSmall" },
};
// Plain reading of the API's direction field ("Stable" = change smaller than the model's usual error)
const TREND = {
  Increasing: { icon: TrendingUp, cls: "trend-up", text: "price.result.trendUp" },
  Decreasing: { icon: TrendingDown, cls: "trend-down", text: "price.result.trendDown" },
  Stable: { icon: Minus, cls: "trend-flat", text: "price.result.trendFlat" },
};
/** Translated label for a backend key, or the backend's own English label when the dictionary has none. */
const labelFor = (t, key, fallback) => { const v = t(key); return v === key ? fallback : v; };
/** "1 day" / "30 days" in the display language */
const days = (t, n) => t(Math.abs(n) === 1 ? "unit.day" : "unit.days", { n });

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
  const t = useT();
  const m = IMPACT[impact] || IMPACT.small;
  const Icon = m.icon;
  return <span className={`impact ${m.cls}`}><Icon size={13} aria-hidden="true" />{t(m.text)}</span>;
}

function StorageCostCalculator({ advice }) {
  const t = useT();
  const [cost, setCost] = useState("");
  const perDay = Number(cost);
  const valid = cost !== "" && !Number.isNaN(perDay) && perDay >= 0;
  const total = valid ? perDay * advice.wait_days : null;
  const net = valid ? advice.extra_per_quintal - total : null;
  return (
    <div className="calc">
      <label htmlFor="storage-cost" className="small" style={{ fontWeight: 600 }}>
        {t("price.advice.storageCostLabel")}
      </label>
      <div className="row" style={{ marginTop: 4 }}>
        <input id="storage-cost" type="number" min="0" step="any" inputMode="decimal" placeholder={t("price.advice.storageCostPlaceholder")}
          value={cost} onChange={(e) => setCost(e.target.value)} style={{ maxWidth: 140 }} />
        {valid && (
          <span className="small">
            {days(t, advice.wait_days)} × {rupees(perDay)} = {rupees(total)} {t("price.advice.storageWord")} →
            {" "}<strong className={net >= 0 ? "text-good" : "text-bad"}>
              {t(net >= 0 ? "price.advice.netGain" : "price.advice.netLoss", { amount: rupees(Math.abs(net)) })}
            </strong>
          </span>
        )}
      </div>
      <p className="muted small" style={{ margin: "4px 0 0" }}>{t("price.advice.storageCostNote")}</p>
    </div>
  );
}

function AdviceCard({ advice, commodity }) {
  const t = useT();
  const style = ADVICE_STYLE[advice.code] || ADVICE_STYLE.NO_CLEAR_DIFFERENCE;
  const AdviceIcon = style.icon;
  const moved = advice.recommended_date !== advice.target_date;
  const peak = advice.peak;
  const showPeak = peak.date !== advice.recommended_date && peak.diff_vs_target > 0;
  // same rule as the backend label: SELL_EARLIER with a suggested date of today reads "selling now"
  const labelCode = advice.code === "SELL_EARLIER" && advice.recommended_horizon_days === 0 ? "SELL_NOW" : advice.code;
  return (
    <section className={`card suggestion ${style.tone}`} aria-labelledby="advice-title">
      <span className="stat-label">{t("price.advice.title")}</span>
      <div className="suggestion-label" id="advice-title"><AdviceIcon size={22} aria-hidden="true" />{labelFor(t, `price.advice.code.${labelCode}`, advice.label)}</div>

      <dl className="advice-grid">
        <div><dt>{t("price.advice.recDate")}</dt><dd className="big">{fmtDate(advice.recommended_date)}</dd></div>
        <div><dt>{t("price.advice.recPrice")}</dt><dd className="big">{rupees(advice.recommended_price)}<span className="unit"> {t("unit.perQuintal")}</span></dd></div>
        <div><dt>{t("price.advice.yourDatePrice", { date: fmtDate(advice.target_date, { day: "numeric", month: "short" }) })}</dt><dd>{rupees(advice.target_price)}</dd></div>
        <div><dt>{t("price.advice.extra")}</dt><dd>{moved ? signedRupees(advice.extra_per_quintal) : "₹0"}</dd></div>
        <div><dt>{t("price.advice.diff")}</dt><dd>{moved ? pct(advice.extra_pct) : "0%"}</dd></div>
        <div><dt>{advice.wait_days < 0 ? t("price.advice.daysEarlier") : t("price.advice.daysWait")}</dt>
          <dd>{days(t, Math.abs(advice.wait_days))}</dd></div>
      </dl>

      <ServerText as="p" className="advice-text">{advice.explanation}</ServerText>
      {showPeak && (
        <p className="small text-2">
          {t("price.advice.peak")} <strong>{rupees(peak.price)}</strong> {t("price.advice.peakOn", { date: fmtDate(peak.date) })}
          {" "}({signedRupees(peak.diff_vs_target)}, {pct(peak.diff_pct)} {t("price.advice.vsYourDate")})
          {peak.date > advice.target_date && advice.code !== "WAIT" ? ` — ${t("price.advice.peakNotRecommended")}` : "."}
        </p>
      )}
      <details className="advice-more">
        <summary>{t("price.advice.storageMore")}</summary>
        {advice.wait_days > 0 && <StorageCostCalculator advice={advice} />}
        <div className="storage-note">
          <strong>{t("price.advice.storageFor", { crop: cropName(t, commodity), category: labelFor(t, `price.storageCat.${advice.storage.category}`, advice.storage.category.toLowerCase()) })}</strong>
          <p className="small" style={{ margin: "2px 0 0" }}><ServerText>{advice.storage.note}</ServerText>{" "}
            {t("price.advice.storageLimit", { days: days(t, advice.storage.max_hold_days) })}</p>
        </div>
      </details>

    </section>
  );
}

function FactorGlossary({ factors }) {
  const t = useT();
  const keys = [...new Set(factors.map((f) => f.factor))].filter((k) => t(`gloss.price.${k}`) !== `gloss.price.${k}`);
  if (!keys.length) return null;
  return (
    <details className="glossary">
      <summary className="section-title"><BookOpen size={18} aria-hidden="true" />{t("why.glossaryTitle")}</summary>
      <dl>
        {keys.map((k) => (
          <div key={k}><dt>{labelFor(t, `price.factor.${k}`, factors.find((f) => f.factor === k).title)}</dt><dd>{t(`gloss.price.${k}`)}</dd></div>
        ))}
      </dl>
    </details>
  );
}

/** Step 6 — the factors the model relied on most, one per row, in plain words (from the API's SHAP explanation). */
function WhyFactors({ explain, error, forecast, which, setWhich }) {
  const t = useT();
  const exps = explain?.explanations || [];
  const exp = exps[Math.min(which, exps.length - 1)];
  const point = exp && forecast.path.find((p) => p.horizon_days === exp.horizon_days);
  return (
    <>
      {exps.length > 1 && (
        <div className="segmented mb-3" role="radiogroup" aria-label={t("price.why.whichDate")}>
          {exps.map((e, i) => (
            <button key={e.date} type="button" role="radio" aria-checked={which === i}
              className={which === i ? "active" : ""} onClick={() => setWhich(i)}>
              {i === 0 ? t("price.chart.yourDate") : t("price.why.suggestedDate")}
            </button>
          ))}
        </div>
      )}
      {error && <Alert type="error">{error}</Alert>}
      {!explain && !error && <Loader label={t("price.why.loading")} />}
      {explain && !exp && <Alert type="info">{explain.message ? <ServerText>{explain.message}</ServerText> : t("price.why.none")}</Alert>}
      {exp && (
        <div className="stack">
          <p className="text-2" style={{ margin: 0 }}>
            {t("price.why.introA", { date: fmtDate(exp.date) })}{" "}
            <strong>{point ? rupees(point.predicted_price) : t("price.why.thisPrice")}</strong>{" "}
            {t("price.why.introB", { change: pct(exp.prediction_change_pct) })}
          </p>
          {exp.all_small && <Alert type="info">{t("price.why.allSmall")}</Alert>}
          <ul className="factor-list">
            {exp.factors.slice(0, 3).map((f) => (
              <li key={f.factor}>
                <div className="factor-head"><strong>{labelFor(t, `price.factor.${f.factor}`, f.title)}</strong><ImpactPill impact={f.impact} /></div>
                <p className="small" style={{ margin: "4px 0 0" }}>
                  <ServerText>{f.observation}</ServerText>
                  {f.impact !== "small" && <> {t(f.impact === "higher" ? "price.why.linkHigher" : "price.why.linkLower", { pct: pct(f.effect_pct) })}</>}
                </p>
              </li>
            ))}
          </ul>
          <FactorGlossary factors={exp.factors.slice(0, 3)} />
          <p className="muted small" style={{ margin: 0 }}>{t("price.why.patternsNote")}</p>
        </div>
      )}
    </>
  );
}

/** Step 8 — every factor with its SHAP value, the raw model inputs and the model/validation details (collapsed). */
function AdvancedDetails({ explain, forecast, which }) {
  const tr = useT();
  const exps = explain?.explanations || [];
  const exp = exps[Math.min(which, exps.length - 1)];
  const t = forecast.target;
  const crop = cropName(tr, forecast.series.commodity);
  const validated = forecast.path.filter((p) => p.beats_baseline).map((p) => p.horizon_days);
  return (
    <TechnicalDetails title={tr("price.steps.advancedToggle")}>
      {exp && (
        <>
          <h3 className="tech-subtitle">{tr("tech.factorsTitle")}</h3>
          <p className="small text-2">{tr("price.why.tech.intro")}</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{tr("table.factor")}</th><th>{tr("table.effect")}</th><th className="num">{tr("table.effectPct")}</th><th className="num">SHAP</th></tr></thead>
              <tbody>
                {exp.factors.map((f) => (
                  <tr key={f.factor}>
                    <td>{labelFor(tr, `price.factor.${f.factor}`, f.title)}</td>
                    <td><ImpactPill impact={f.impact} /></td>
                    <td className="num">{pct(f.effect_pct)}</td>
                    <td className="num">{f.shap_value > 0 ? "+" : ""}{f.shap_value.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {exp.technical?.length > 0 && (
            <div className="table-wrap mt-3">
              <table>
                <thead><tr><th>{tr("table.feature")}</th><th className="num">{tr("table.value")}</th><th className="num">SHAP</th></tr></thead>
                <tbody>
                  {exp.technical.map((r) => (
                    <tr key={r.feature}><td>{r.label}</td><td className="num">{r.value ?? "—"}</td>
                      <td className="num">{r.shap_value > 0 ? "+" : ""}{r.shap_value.toFixed(4)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small mt-2">
            {tr("price.why.tech.method", { method: exp.method, space: exp.output_space, base: exp.base_value, baseChange: pct(exp.base_change_pct) })}
          </p>
        </>
      )}
      <h3 className="tech-subtitle mt-4">{tr("price.rel.title")}</h3>
      <dl className="kv">
        <dt>{tr("price.rel.yourDate")}</dt>
        <dd>{t.beats_baseline ? tr("price.rel.validatedShort") : tr("price.rel.notValidatedShort")}</dd>
        <dt>{tr("price.rel.validatedDays")}</dt>
        <dd>{validated.length ? dayRanges(validated) : tr("price.rel.noneFor", { crop })}</dd>
        <dt>{tr("price.rel.model")}</dt><dd>{tr("price.rel.modelValue", { algorithm: algorithmName(forecast.model.algorithm) })}</dd>
      </dl>
      <p className="muted small" style={{ margin: "10px 0 0" }}>{tr("price.rel.validatedMeaning", { crop })}</p>
    </TechnicalDetails>
  );
}

/**
 * Step 3 — a neutral reading built only from fields the API returns (direction and size of the change,
 * the model's usual error, whether this horizon was validated, whether it is a seasonal projection),
 * followed by the plain reliability figures.
 */
function MeaningContent({ forecast }) {
  const tr = useT();
  const t = forecast.target;
  const crop = cropName(tr, forecast.series.commodity);
  const vars = {
    date: fmtDate(t.date), size: `${Math.abs(t.change_pct).toFixed(1)}%`, start: rupees(forecast.current_price),
    change: pct(t.change_pct), band: t.stable_band_pct.toFixed(0),
  };
  const lines = [
    t.direction === "Increasing" ? tr("price.understand.up", vars)
      : t.direction === "Decreasing" ? tr("price.understand.down", vars) : tr("price.understand.stable", vars),
    ...(forecast.projection ? [tr("price.understand.projection")] : []),
    tr("price.understand.estimate"),
  ];
  return (
    <div className="meaning-grid">
      <ul className="list meaning-list">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
      <div className={`meaning-sure ${t.beats_baseline ? "is-ok" : "is-caution"}`}>
        <p className="meaning-sure-title">
          {t.beats_baseline ? <CircleCheck size={18} aria-hidden="true" /> : <TriangleAlert size={18} aria-hidden="true" />}
          <strong>{tr("price.rel.title")}</strong>
        </p>
        <p className="small !mb-2">{t.beats_baseline
          ? tr("price.rel.validated", { days: days(tr, t.horizon_days), crop })
          : tr("price.rel.notValidated", { days: days(tr, t.horizon_days), crop })}</p>
        <dl className="kv small">
          <dt>{tr("price.rel.typicalError")}</dt><dd>{tr("price.rel.typicalErrorValue", { pct: t.stable_band_pct.toFixed(0) })}</dd>
          <dt>{tr("price.rel.avgError")}</dt>
          <dd>{tr("price.rel.avgErrorValue", { model: rupees(t.model_mae), days: days(tr, t.horizon_days), baseline: rupees(t.baseline_mae) })}</dd>
          <dt>{tr("price.rel.dataUpTo")}</dt><dd>{fmtDate(forecast.model.data_end)}</dd>
        </dl>
      </div>
    </div>
  );
}

/** Step 4 — rising / no clear change / falling, highlighting the direction the API returned (text label + icon, not colour alone). */
function MovementContent({ forecast }) {
  const tr = useT();
  const t = forecast.target;
  const trend = TREND[t.direction] || TREND.Stable;
  const scale = [["Increasing", TREND.Increasing], ["Stable", TREND.Stable], ["Decreasing", TREND.Decreasing]];
  return (
    <>
      <ul className="move-scale" aria-label={tr("price.steps.movementScale")}>
        {scale.map(([key, m]) => {
          const on = (TREND[t.direction] ? t.direction : "Stable") === key;
          return (
            <li key={key} className={`move-chip ${m.cls}${on ? " is-on" : ""}`} aria-current={on ? "true" : undefined}>
              <m.icon size={18} aria-hidden="true" /><span>{tr(m.text)}</span>
              {on && <span className="sr-only">{tr("price.steps.thisForecast")}</span>}
            </li>
          );
        })}
      </ul>
      <p className={`trend-line ${trend.cls}`}>
        <trend.icon size={18} aria-hidden="true" />
        <span><strong>{tr(trend.text)}</strong>{" "}
          <span className="text-2">{tr("price.result.vsStart", { change: pct(t.change_pct), start: rupees(forecast.current_price) })}</span></span>
      </p>
      {t.direction === "Stable" && <p className="small text-2 !mb-0">{tr("price.result.stableNote", { band: t.stable_band_pct.toFixed(0) })}</p>}
    </>
  );
}

export default function PriceResult() {
  const tr = useT();
  const [params] = useSearchParams();
  const historyId = params.get("id");
  const { source, error: sourceError, missing } = useResultSource();
  const [forecast, setForecast] = useState(source?.forecast || null);
  const [explain, setExplain] = useState(null);
  const [error, setError] = useState(null);
  const [explainError, setExplainError] = useState(null);
  const [which, setWhich] = useState(0); // which date the explanation shows (your date / suggested date)

  useEffect(() => {
    if (!source) return;
    if (source.forecast) setForecast(source.forecast);
    else priceService.trend(source.req).then(setForecast).catch((e) => setError(errorMessage(e)));
    priceService.explain(source.req).then(setExplain).catch((e) => setExplainError(errorMessage(e)));
  }, [source]);

  const backLinks = (
    <div className="row">
      {historyId && <Link to="/history" className="btn btn-secondary"><History size={16} aria-hidden="true" />{tr("common.backToHistory")}</Link>}
      <Link to="/price-prediction" className="btn btn-secondary"><ArrowLeft size={16} aria-hidden="true" />{tr("price.result.newPrediction")}</Link>
    </div>
  );

  if (missing) {
    return <EmptyState icon={ChartNoAxesCombined} title={tr("price.result.emptyTitle")}
      action={<Link className="btn btn-primary" to="/price-prediction">{tr("price.result.emptyAction")}</Link>}>
      {tr("price.result.emptyBody")}</EmptyState>;
  }
  if (sourceError || error) return <Alert type="error" action={backLinks}>{sourceError || error}</Alert>;
  if (!forecast) return <Loader label={tr("price.result.loading")} />;

  const { series, target: t, advice } = forecast;
  const validated = t.beats_baseline;
  const marketName = series.market === STATE_MARKET ? tr("price.form.allMarkets") : series.market;
  const notes = [
    source.fromHistory && tr("price.result.noteHistory", { price: rupees(source.saved.predicted_price) }),
    forecast.projection && tr("price.result.noteProjection", {
      end: fmtDate(forecast.model.data_end), ref: fmtDate(forecast.projection.reference_origin_date),
      inflation: forecast.projection.inflation_annual_pct,
    }),
    !forecast.projection && forecast.forecast_origin_date !== forecast.input_date
      && tr("price.result.noteOrigin", { date: fmtDate(forecast.input_date), origin: fmtDate(forecast.forecast_origin_date) }),
  ].filter(Boolean);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{tr("price.result.title")}</h1>
          <p><strong>{cropName(tr, series.commodity)}</strong> · {marketName} · {cropName(tr, series.state, "state")}</p>
        </div>
        {backLinks}
      </div>

      {!source.fromHistory && (
        <Tip id="price-result" className="mb-4">{tr("tip.priceResult")} <Link to="/history">{tr("tip.openHistory")}</Link></Tip>
      )}

      <div className="result-top steps-top">
        <ResultStep n={1} id="step-price" title={tr("price.steps.price")} className="hero-card">
          <div className="hero-card-head">
            <span className="stat-label">{tr("price.result.expectedOn", { date: fmtDate(t.date) })}</span>
          </div>
          <div className="hero-price">{rupees(t.predicted_price)}<span className="unit"> {tr("unit.perQuintal")}</span></div>
          <div className="stat-sub">{tr("price.result.likelyRange", { low: rupees(t.lower), high: rupees(t.upper) })}</div>
          <div className="hero-meta">
            <div><span className="stat-label">{tr("price.result.startingPrice")}</span><strong>{rupees(forecast.current_price)}</strong>
              <span className="muted small">{tr(forecast.projection ? "price.result.projectedOn" : "price.result.reportedOn", { date: fmtDate(forecast.forecast_origin_date) })}</span></div>
            <div><span className="stat-label">{tr("price.result.daysAhead")}</span><strong>{t.horizon_days}</strong></div>
          </div>
          <span className={`reliability ${validated ? "ok" : "weak"}`}>
            {validated
              ? <><CircleCheck size={15} aria-hidden="true" />{tr("price.result.validated")}</>
              : <><TriangleAlert size={15} aria-hidden="true" />{tr("price.result.roughGuide")}</>}
          </span>
          {t.actual_price != null && (
            <p className="small" style={{ margin: "8px 0 0" }}>
              {tr("price.result.actualThatDay")} <strong>{rupees(t.actual_price)}</strong>
            </p>
          )}
        </ResultStep>

        <ResultStep n={2} id="step-market" title={tr("price.steps.market")}>
          <div className="market-card">
            <CropArt crop={series.commodity} size={84} decorative className="hero-crop-art" />
            <dl className="kv">
              <dt>{tr("hist.col.crop")}</dt><dd><strong>{cropName(tr, series.commodity)}</strong>{series.variety && <span className="muted small"> · {series.variety}</span>}</dd>
              <dt>{tr("hist.col.market")}</dt><dd>{marketName}</dd>
              <dt>{tr("price.form.state")}</dt><dd>{cropName(tr, series.state, "state")}</dd>
              <dt>{tr("price.steps.madeOn")}</dt><dd>{fmtDate(forecast.input_date)}</dd>
              <dt>{tr("price.form.date")}</dt><dd><strong>{fmtDate(forecast.target_date)}</strong></dd>
            </dl>
          </div>
        </ResultStep>
      </div>

      {notes.length > 0 && (
        <details className={`notes-box mb-1 ${forecast.projection ? "is-warn" : ""}`}>
          <summary><TriangleAlert size={17} aria-hidden="true" />{tr("price.result.notesTitle")}<span className="notes-count">{notes.length}</span></summary>
          {notes.length === 1 ? <p>{notes[0]}</p> : <ul className="list">{notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        </details>
      )}

      <ResultStep n={3} id="step-meaning" title={tr("price.steps.meaning")} icon={Lightbulb} className="understand">
        <MeaningContent forecast={forecast} />
      </ResultStep>

      <ResultStep n={4} id="step-movement" title={tr("price.steps.movement")}>
        <MovementContent forecast={forecast} />
      </ResultStep>

      <ResultStep n={5} id="step-chart" title={tr("price.chart.title", { crop: cropName(tr, series.commodity) })} className="reveal">
        <p className="chart-desc mb-3">
          {tr("price.chart.desc", { from: fmtDate(forecast.forecast_origin_date), to: fmtDate(forecast.path[forecast.path.length - 1].date) })}
          {forecast.path.length > t.horizon_days && ` ${tr("price.chart.descLater")}`}
        </p>
        <PriceTrendChart history={forecast.history} historyIsReference={forecast.history_is_reference}
          actualAfter={forecast.actual_after_origin} path={forecast.path}
          originDate={forecast.forecast_origin_date} currentPrice={forecast.current_price}
          targetDate={forecast.target_date} recommendedDate={advice.recommended_horizon_days > 0 ? advice.recommended_date : null} />
        {forecast.path.some((p) => !p.beats_baseline) && (
          <p className="small text-2" style={{ marginTop: 8 }}>
            {forecast.validated_days > 0
              ? tr("price.chart.weakSome", { crop: cropName(tr, series.commodity) })
              : tr("price.chart.weakAll", { crop: cropName(tr, series.commodity) })}
            {forecast.last_validated_days < forecast.max_horizon_days && forecast.path.length < forecast.max_horizon_days &&
              <> {tr("price.chart.stops", { date: fmtDate(forecast.path[forecast.path.length - 1].date) })}</>}
          </p>
        )}
      </ResultStep>

      <ResultStep n={6} id="step-why" title={tr("price.why.title")} className="reveal">
        <WhyFactors explain={explain} error={explainError} forecast={forecast} which={which} setWhich={setWhich} />
      </ResultStep>

      <ResultStep n={7} id="step-check" title={tr("price.steps.check")}>
        <AdviceCard advice={advice} commodity={series.commodity} />
        <h3 className="tech-subtitle mt-4">{tr("price.advice.checkFirst")}</h3>
        <ul className="check-list">
          {advice.considerations.map((c) => <li key={c}><CircleCheck size={17} aria-hidden="true" /><ServerText>{c}</ServerText></li>)}
        </ul>
        <ServerText as="p" className="muted small advice-disclaimer">{advice.disclaimer}</ServerText>
      </ResultStep>

      <ResultStep n={8} id="step-advanced" title={tr("price.steps.advanced")}>
        <p className="small text-2 !mb-0">{tr("price.steps.advancedHint")}</p>
        <AdvancedDetails explain={explain} forecast={forecast} which={which} />
      </ResultStep>

      <ServerText as="p" className="muted small mt-4">{forecast.disclaimer}</ServerText>
    </>
  );
}
