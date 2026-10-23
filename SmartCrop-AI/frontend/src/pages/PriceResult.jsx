import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, ChartNoAxesCombined, CircleHelp, CircleCheck, History, Lightbulb, TriangleAlert, Warehouse,
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
import { addDays, cropName, dayRanges, fmtDate, pct, rupees, signedRupees, priceSourceKey } from "../utils/format";
import { isContextOnly, rangeText, rangeView } from "../utils/priceView";
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
function SellRecommendation({ advice, commodity, contextOnly }) {
  const t = useT();
  const style = ADVICE_STYLE[advice.code] || ADVICE_STYLE.UNAVAILABLE;
  const Icon = style.icon;
  const crop = cropName(t, commodity);
  const s = advice.storage;
  const farmDays = s.farm_hold_days ?? s.max_hold_days;
  if (contextOnly) {
    // the model is not used to claim a direction here: no model price, no dates compared
    return (
      <div className={`sell-card ${style.tone}`} data-testid="sell-context-only">
        <div className="sell-badge"><Icon size={18} aria-hidden="true" />{labelFor(t, "price.advice.code.UNAVAILABLE", advice.label)}</div>
        <div className="sell-why">
          <h3><Lightbulb size={16} aria-hidden="true" />{t("price.sell.whyTitle")}</h3>
          <p><ServerText>{advice.explanation}</ServerText></p>
          <p><ServerText>{advice.reason}</ServerText></p>
        </div>
        <div className="sell-store">
          <h3><Warehouse size={16} aria-hidden="true" />{t("price.sell.storageTitle")}</h3>
          <p className="sell-store-general"><ServerText>{s.note}</ServerText> {t("price.advice.keepsFarm", { days: days(t, farmDays) })}</p>
        </div>
      </div>
    );
  }
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
      {advice.code !== "NO_CLEAR_DIFFERENCE" && (
        <div className="sell-badge"><Icon size={18} aria-hidden="true" />
          {labelFor(t, `price.advice.code.${advice.code}`, advice.label)}</div>
      )}

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
  const navigate = useNavigate();

  useEffect(() => {
    if (!source) return;
    if (source.forecast) setForecast(source.forecast);
    else priceService.trend(source.req).then(setForecast).catch((e) => setError(errorMessage(e)));
    // prefetched only so the explanation page can open without a second model run; it refetches if this fails
    priceService.explain(source.req).then(setExplain).catch(() => {});
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
  const sourceKey = priceSourceKey(forecast.source);
  const estimated = forecast.source?.method === "historical_baseline";
  const marketName = series.market === STATE_MARKET ? tr("price.form.allMarkets") : series.market;
  const ctxOnly = isContextOnly(forecast);
  const range = rangeView(forecast);
  const rt = rangeText(range);
  const latest = forecast.latest_recorded;

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
          {ctxOnly ? (
            <div data-testid="no-direction">
              <p className="hero-nodir">
                {latest ? tr("price.result.noDirection", { price: rupees(latest.price), date: fmtDate(latest.date) }) : tr("price.result.noDirectionNoPrice")}
              </p>
              <div className="stat-sub">{tr("price.result.noDirectionNote")}
                {forecast.range_info?.typical_miss_inr != null && <> {tr("price.result.typicalMiss", { amount: rupees(forecast.range_info.typical_miss_inr) })}</>}</div>
            </div>
          ) : (
            <>
              <div className="hero-price">{rupees(t.predicted_price)}<span className="unit"> {tr("unit.perQuintal")}</span></div>
              {rt && <div className="stat-sub" data-testid="range-line">{tr(rt.key, { low: rupees(range.low), high: rupees(range.high), pct: range.pct })}</div>}
            </>
          )}
          <div className="hero-meta">
            {!ctxOnly && (
              <div><span className="stat-label">{tr(forecast.projection || estimated ? "price.result.startingPriceEstimated" : "price.result.startingPriceLatest")}</span><strong>{rupees(forecast.current_price)}</strong>
                <span className="muted small">{forecast.projection
                  ? tr("price.result.basedOnRecords", { date: fmtDate(forecast.projection.reference_origin_date) })
                  : tr(estimated ? "price.result.estimatedOn" : "price.result.latestOn", { date: fmtDate(forecast.forecast_origin_date) })}</span></div>
            )}
            <div><span className="stat-label">{tr("price.result.daysAhead")}</span><strong>{t.horizon_days}</strong></div>
          </div>
          {sourceKey && <p className="price-source">{tr(sourceKey)}</p>}
          {forecast.source?.note && <p className="price-source"><ServerText>{forecast.source.note}</ServerText></p>}
          {/* only the caution is shown; a forecast that passed testing needs no label */}
          {!validated && !ctxOnly && (
            <span className="reliability weak"><TriangleAlert size={15} aria-hidden="true" />{tr("price.result.roughGuide")}</span>
          )}
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
        {ctxOnly ? <p className="muted" data-testid="no-forecast-line">{tr("price.chart.noForecastLine")}</p> : (
          <PriceTrendChart history={forecast.history} historyIsReference={forecast.history_is_reference}
            actualAfter={forecast.actual_after_origin} path={forecast.path}
            originDate={forecast.forecast_origin_date} currentPrice={forecast.current_price}
            targetDate={forecast.target_date} recommendedDate={advice.recommended_date} peak={advice.peak}
            showRange={range.kind === "measured" || range.kind === "unmeasured"} rangePct={range.pct ?? null} />
        )}
      </ResultStep>

      <ResultStep n={4} id="step-sell" title={tr("price.sell.title")} className="sell-step">
        <SellRecommendation advice={advice} commodity={series.commodity} contextOnly={ctxOnly} />
      </ResultStep>

      <div className="row" style={{ margin: "1rem 0" }}>
        <button type="button" className="btn btn-primary"
          onClick={() => navigate(historyId ? `/price-prediction/explanation?id=${historyId}` : "/price-prediction/explanation",
            { state: { req: source.req, explain } })}>
          <CircleHelp size={16} aria-hidden="true" />{tr("price.expl.button")}
        </button>
        <span className="muted small">{tr("price.expl.buttonHint")}</span>
      </div>

      <p className="price-disclaimer"><strong>{tr("price.result.disclaimerLabel")}</strong> {tr("price.result.disclaimer")}</p>
    </>
  );
}
