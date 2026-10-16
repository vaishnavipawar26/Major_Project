import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import {
  Activity, ArrowLeft, CalendarDays, ChartNoAxesCombined, CircleCheck, CloudSun, Coins, History, Lightbulb, Map, Minus, MoveRight, Plus, Scale, TrendingDown, TrendingUp, TriangleAlert, Truck, Warehouse, Wheat,
} from "lucide-react";
import Alert from "../components/Alert";
import CropArt from "../components/CropArt";
import EmptyState from "../components/EmptyState";
import Loader from "../components/Loader";
import ResultStep from "../components/ResultStep";
import ServerText from "../components/ServerText";
import Tip from "../components/Tip";
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

/** Optional cost check: the farmer's own storage and selling costs against the extra income before costs. */
function CostCheck({ advice }) {
  const t = useT();
  const [perDay, setPerDay] = useState("");
  const [other, setOther] = useState("");
  const num = (v) => (v === "" || Number.isNaN(Number(v)) || Number(v) < 0 ? null : Number(v));
  const day = num(perDay);
  const once = num(other);
  const entered = day != null || once != null;
  const costs = (day ?? 0) * advice.wait_days + (once ?? 0);
  const net = advice.extra_per_quintal - costs;
  return (
    <div className="calc">
      <strong className="small">{t("price.advice.costTitle")}</strong>
      <div className="calc-fields">
        <label className="small">
          {t("price.advice.storageCostLabel")}
          <input type="number" min="0" step="any" inputMode="decimal" placeholder={t("price.advice.storageCostPlaceholder")}
            value={perDay} onChange={(e) => setPerDay(e.target.value)} />
        </label>
        <label className="small">
          {t("price.advice.otherCostLabel")}
          <input type="number" min="0" step="any" inputMode="decimal" placeholder={t("price.advice.otherCostPlaceholder")}
            value={other} onChange={(e) => setOther(e.target.value)} />
        </label>
      </div>
      <p className="small" style={{ margin: "8px 0 0" }}>
        {t("price.advice.grossExtra", { amount: rupees(advice.extra_per_quintal) })}
        {entered && (
          <>
            {" − "}{t("price.advice.yourCosts", { amount: rupees(costs) })}{" = "}
            <strong className={net >= 0 ? "text-good" : "text-bad"}>
              {t(net >= 0 ? "price.advice.netGain" : "price.advice.netLoss", { amount: rupees(Math.abs(net)) })}
            </strong>
          </>
        )}
      </p>
      <p className="muted small" style={{ margin: "4px 0 0" }}>
        {t(entered ? "price.advice.costsPartial" : "price.advice.costsNotDeducted")}
      </p>
    </div>
  );
}

/** One cell of the selling summary: a date with its predicted price, or a single figure. */
function SellCell({ label, date, price, value, sub, rec, tone }) {
  const t = useT();
  return (
    <div className={`sell-cell${rec ? " is-rec" : ""}${tone ? ` ${tone}` : ""}`}>
      <span className="sell-cell-label">{label}{rec && <span className="sell-rec-tag"><CircleCheck size={12} aria-hidden="true" />{t("price.sell.recTag")}</span>}</span>
      {date !== undefined && <span className="sell-cell-date">{date ? fmtDate(date, { day: "numeric", month: "short", year: "numeric" }) : "—"}</span>}
      {price !== undefined && <span className="sell-cell-price">{rupees(price)}<span className="unit"> {t("unit.perQuintal")}</span></span>}
      {value !== undefined && <span className="sell-cell-value">{value}</span>}
      {sub && <span className="sell-cell-sub">{sub}</span>}
    </div>
  );
}

/**
 * Smart selling recommendation (codes from app/ml/price_prediction/selling_advice.py). Everything shown
 * is built from the API's numbers; the wording is short, translated and never repeats a price.
 */
function SellRecommendation({ advice, commodity }) {
  const t = useT();
  const style = ADVICE_STYLE[advice.code] || ADVICE_STYLE.UNAVAILABLE;
  const Icon = style.icon;
  const crop = cropName(t, commodity);
  const s = advice.storage;
  const farmDays = s.farm_hold_days ?? s.max_hold_days;
  const wait = advice.code === "WAIT";
  const noPrice = advice.target_price == null;
  // the best other date the backend reports (the recommended date when waiting is advised)
  const [kind, alt] = wait ? ["wait", advice.alternative]
    : advice.alternative ? ["alternative", advice.alternative]
    : advice.beyond_storage ? ["beyond", advice.beyond_storage]
    : advice.best_before ? ["before", advice.best_before] : [null, null];
  const sd = (d) => fmtDate(d, { day: "numeric", month: "long" });
  const altDays = alt ? days(t, Math.abs(alt.days_from_target)) : null;

  let why;
  if (advice.code === "UNAVAILABLE") {
    why = noPrice ? t("price.sell.why.noPrice") : t("price.sell.why.unreliable");
  } else if (kind === "wait") {
    why = t("price.sell.why.wait", { date: sd(alt.date) });
  } else if (kind === "alternative") {
    why = t("price.sell.why.small", { date: sd(alt.date) });
  } else if (kind === "beyond") {
    why = t("price.sell.why.beyond", { date: sd(alt.date), days: altDays, crop });
  } else if (kind === "before") {
    why = t("price.sell.why.before", { date: sd(alt.date) });
  } else {
    why = t("price.sell.why.best", { days: days(t, s.max_hold_days) });
  }
  if (advice.falls_after_target && (advice.code === "SELL_ON_TARGET" || advice.code === "NO_CLEAR_DIFFERENCE")) {
    why += ` ${t("price.sell.why.fallsAfter")}`;
  }

  let store;
  if (wait) {
    store = t("price.sell.store.wait", { crop, days: altDays });
    if (advice.needs_special_storage) {
      store += ` ${t("price.sell.store.special", { crop, farm: days(t, farmDays) })}`;
      if (advice.farm_option) store += ` ${t("price.sell.store.farmOption", { date: sd(advice.farm_option.date), price: rupees(advice.farm_option.price) })}`;
    }
  } else if (kind === "alternative" && alt.days_from_target > 0) {
    store = t("price.sell.store.small", { crop, days: altDays });
  } else if (advice.code === "STORAGE_LIMIT") {
    store = t("price.sell.store.limit", { crop, days: days(t, s.max_hold_days) });
  } else if (advice.code === "UNAVAILABLE") {
    store = t("price.sell.store.unknown", { crop });
  } else {
    store = t("price.sell.store.onTime");
  }

  return (
    <div className={`sell-card ${style.tone}`}>
      <div className="sell-badge"><Icon size={18} aria-hidden="true" />
        {labelFor(t, `price.advice.code.${advice.code}`, advice.label)}</div>

      <div className={`sell-summary${alt ? "" : " is-short"}`}>
        <SellCell label={t("price.sell.planned")} date={advice.target_date} price={advice.target_price}
          rec={!wait && advice.code !== "UNAVAILABLE"} />
        {alt ? (
          <>
            <SellCell label={t("price.sell.alt")} date={alt.date} price={alt.price} rec={wait}
              sub={wait ? null : t(`price.sell.altWhy.${kind}`)} />
            <SellCell label={t("price.sell.diff")} tone={wait ? "is-up" : ""}
              value={<>{signedRupees(alt.extra_per_quintal)} <small>({pct(alt.extra_pct, 1)})</small></>}
              sub={t("price.sell.beforeCosts")} />
            <SellCell label={alt.days_from_target < 0 ? t("price.sell.daysBefore") : t("price.sell.waitTime")} value={altDays} />
          </>
        ) : !noPrice && advice.code !== "UNAVAILABLE" && (
          <SellCell label={t("price.sell.alt")} value={t("price.sell.noAlt")} />
        )}
      </div>

      <div className="sell-why">
        <h3><Lightbulb size={16} aria-hidden="true" />{t("price.sell.whyTitle")}</h3>
        <p>{why}</p>
      </div>

      <div className="sell-store">
        <h3><Warehouse size={16} aria-hidden="true" />{t("price.sell.storageTitle")}</h3>
        <p>{store}</p>
        <p className="sell-store-general">
          <span className="sell-store-tag">{t("price.sell.generalLabel")}</span>{" "}
          <ServerText>{s.note}</ServerText>{" "}
          {t("price.advice.keepsFarm", { days: days(t, farmDays) })}
          {s.max_hold_days > farmDays && <> {t("price.advice.keepsGood", { days: days(t, s.max_hold_days) })}</>}
        </p>
        {advice.wait_days > 0 && <CostCheck advice={advice} />}
      </div>

      <p className="sell-note"><TriangleAlert size={15} aria-hidden="true" />
        <span>{advice.typical_error_pct != null
          ? t("price.sell.note", { pct: advice.typical_error_pct.toFixed(0) })
          : t("price.sell.noteNoError")}</span></p>
    </div>
  );
}

// Direction of a factor's SHAP contribution as the API reports it ("impact"); never inferred here
const PUSH = {
  higher: { cls: "push-up", icon: TrendingUp, label: "price.why.pushUp", detail: "price.why.detailUp" },
  lower: { cls: "push-down", icon: TrendingDown, label: "price.why.pushDown", detail: "price.why.detailDown" },
  small: { cls: "push-small", icon: Minus, label: "price.why.pushSmall", detail: null },
};
// factors whose backend observation is a measured fact worth showing (the others are generic)
const OBSERVED = new Set(["recent_week", "recent_month", "averages", "volatility", "arrivals", "state_market", "price_level"]);

/** One factor: what it did to the prediction (icon + label) and what it means, in one or two short sentences. */
function FactorCard({ f, commodity }) {
  const t = useT();
  const m = PUSH[f.impact] || PUSH.small;
  const crop = cropName(t, commodity);
  const sayKey = `price.why.say.${f.factor}.${f.impact in PUSH ? f.impact : "small"}`;
  const say = t(sayKey, { crop });
  return (
    <li className={`factor-card ${m.cls}`}>
      <span className="factor-push"><m.icon size={16} aria-hidden="true" />{t(m.label)}</span>
      <strong className="factor-name">{labelFor(t, `price.factor.${f.factor}`, f.title)}</strong>
      <p className="factor-say">
        {say !== sayKey ? say : <ServerText>{f.observation}</ServerText>}
        {m.detail && <> <span className="factor-detail">{t(m.detail, { pct: `${Math.abs(f.effect_pct).toFixed(1)}%` })}</span></>}
      </p>
      {say !== sayKey && OBSERVED.has(f.factor) && (
        <p className="factor-seen"><ServerText>{f.observation}</ServerText></p>
      )}
    </li>
  );
}

/** Step 4 — the three factors the model relied on most, as cards (from the API's SHAP explanation). */
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
          <ul className="factor-cards">
            {exp.factors.slice(0, 3).map((f) => <FactorCard key={f.factor} f={f} commodity={forecast.series.commodity} />)}
          </ul>
          <p className="muted small" style={{ margin: 0 }}>{t("price.why.patternsNote")}</p>
        </div>
      )}
    </>
  );
}

const FLAT_PCT = 1;   // changes within +/-1% are described as "about the same"
const SMALL_PCT = 3;  // up to this a change is "a tiny bit"
const BIG_PCT = 8;    // from this a change is "a lot"
const REASON_ICON = {
  price_level: Coins, seasonal: CloudSun, vs_average: Scale, movement: TrendingUp, crop_market: Wheat,
  horizon: CalendarDays, volatility: Activity, supply: Truck, statewide: Map, other: Plus,
};

/** Headline key, tone and arrow for an expected price change in percent. */
function changeStyle(change) {
  const a = Math.abs(change);
  if (a < FLAT_PCT) return { tone: "flat", Arrow: MoveRight, headline: "price.kid.flat" };
  const size = a < SMALL_PCT ? "Tiny" : a >= BIG_PCT ? "Lot" : "Some";
  return change > 0
    ? { tone: "up", Arrow: TrendingUp, headline: `price.kid.up${size}` }
    : { tone: "down", Arrow: TrendingDown, headline: `price.kid.down${size}` };
}

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Big number, a plain headline and "today -> that day" prices. */
function SummaryCard({ exp, forecast }) {
  const tr = useT();
  const { tone, Arrow, headline } = changeStyle(exp.prediction_change_pct);
  const point = forecast.path.find((p) => p.horizon_days === exp.horizon_days);
  const origin = forecast.forecast_origin_date;
  return (
    <div className={`kid-summary is-${tone}`}>
      <div className="kid-summary-top">
        <span className="kid-summary-num"><Arrow size={30} aria-hidden="true" />{Math.round(exp.prediction_change_pct) === 0 ? "0%" : pct(exp.prediction_change_pct, 0)}</span>
        <span className="kid-summary-title">{tr(headline)}</span>
      </div>
      {point && (
        <p className="kid-summary-line">
          {origin === localToday() ? tr("price.kid.today") : fmtDate(origin)}: <strong>{rupees(forecast.current_price)}</strong>
          {" \u2192 "}{fmtDate(exp.date)}: {tr("price.kid.about")} <strong>{rupees(point.predicted_price)}</strong>
        </p>
      )}
    </div>
  );
}

/** One reason: emoji, short title, one easy line, and the effect as a coloured pill. */
function Reason({ f }) {
  const tr = useT();
  const tone = f.factor === "other" ? "flat" : f.effect_pct > 0 ? "up" : f.effect_pct < 0 ? "down" : "flat";
  const Icon = REASON_ICON[f.factor] || Plus;
  const line = f.factor === "other" ? tr("price.kid.other.line") : tr(`price.kid.${f.factor}.${f.direction}`);
  return (
    <li className="kid-row">
      <span className="kid-icon" aria-hidden="true"><Icon size={22} /></span>
      <span className="kid-text">
        <strong>{tr(`price.kid.${f.factor}.title`)}</strong>
        <span>{line}</span>
      </span>
      <span className={`kid-pill is-${tone}`}>{pct(f.effect_pct)}</span>
    </li>
  );
}

/** Step 6: why the price moves, in plain words. */
function AdvancedDetails({ explain, forecast, which }) {
  const tr = useT();
  const exps = explain?.explanations || [];
  const exp = exps[Math.min(which, exps.length - 1)];
  const validated = forecast.path.filter((p) => p.beats_baseline).map((p) => p.horizon_days);
  const simple = exp?.simple;
  const rows = simple ? [...simple.factors, simple.other] : [];
  const change = exp?.prediction_change_pct ?? 0;
  const pushUp = rows.some((f) => f.factor !== "other" && f.effect_pct > 0);
  const pushDown = rows.some((f) => f.factor !== "other" && f.effect_pct < 0);
  const word = Math.abs(change) < FLAT_PCT ? "flat" : change > 0 ? "up" : "down";
  const total = word === "flat" ? tr("price.kid.sumFlat") : tr(`price.kid.sum${word === "up" ? "Up" : "Down"}`, { pct: Math.abs(change).toFixed(0) });
  const closing = pushUp && pushDown ? tr("price.kid.mixed", { total }) : tr("price.kid.same", { total });
  return (
    <div className="kid">
      {exp && <SummaryCard exp={exp} forecast={forecast} />}
      {simple && (
        <>
          <h3 className="kid-h">{tr("price.kid.why")}</h3>
          <ul className="kid-list">{rows.map((f) => <Reason key={f.factor} f={f} />)}</ul>
          <p className="kid-closing">{closing}</p>
        </>
      )}
      <details className="kid-about">
        <summary>{tr("price.kid.aboutTitle")}</summary>
        {forecast.target.beats_baseline && validated.length ? (
          <p className="kid-about-line"><CircleCheck size={16} aria-hidden="true" />
            {tr("price.kid.tested", { from: Math.min(...validated), to: Math.max(...validated) })}</p>
        ) : (
          <p className="kid-about-line is-warn"><TriangleAlert size={16} aria-hidden="true" />{tr("price.kid.notTested")}</p>
        )}
      </details>
    </div>
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

      <ResultStep n={3} id="step-chart" title={tr("price.chart.title", { crop: cropName(tr, series.commodity) })} className="reveal">
        <p className="chart-desc mb-3">
          {tr("price.chart.desc", { from: fmtDate(forecast.forecast_origin_date), to: fmtDate(forecast.path[forecast.path.length - 1].date) })}
          {forecast.path.length > t.horizon_days && ` ${tr("price.chart.descLater")}`}
        </p>
        <PriceTrendChart history={forecast.history} historyIsReference={forecast.history_is_reference}
          actualAfter={forecast.actual_after_origin} path={forecast.path}
          originDate={forecast.forecast_origin_date} currentPrice={forecast.current_price}
          targetDate={forecast.target_date} recommendedDate={advice.recommended_date} peak={advice.peak} />
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

      <ResultStep n={4} id="step-why" title={tr("price.why.title")} className="reveal">
        <WhyFactors explain={explain} error={explainError} forecast={forecast} which={which} setWhich={setWhich} />
      </ResultStep>

      <ResultStep n={5} id="step-sell" title={tr("price.sell.title")} className="sell-step">
        <p className="step-subtitle">{tr("price.sell.subtitle")}</p>
        <SellRecommendation advice={advice} commodity={series.commodity} />
      </ResultStep>

      <ResultStep n={6} id="step-advanced" title={tr("price.steps.advanced")}>
        <AdvancedDetails explain={explain} forecast={forecast} which={which} />
      </ResultStep>

      <p className="price-disclaimer"><strong>{tr("price.result.disclaimerLabel")}</strong> {tr("price.result.disclaimer")}</p>
    </>
  );
}
