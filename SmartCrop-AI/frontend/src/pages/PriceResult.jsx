import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, CalendarCheck, ChartNoAxesCombined, CircleHelp, CircleCheck, History, Lightbulb, Scale, TriangleAlert, Warehouse,
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
import { STATE_MARKET } from "../utils/constants";
import { addDays, cropName, fmtDate, pct, rupees, signedRupees } from "../utils/format";
import { isContextOnly, rangeView } from "../utils/priceView";
import { referenceRows, selectedPrice, typicalMiss } from "../utils/selectedPrice";
import { decideSelling, makePriceAt } from "../utils/sellingDecision";
import { LAST_PRICE_REQUEST_KEY } from "./PricePrediction";

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

/** Smart Selling: the planned date against the best other date, from one decision (utils/sellingDecision.js). */
function SellRecommendation({ decision: d, planned, plannedDate, crop, storage, source }) {
  const t = useT();
  const farmDays = storage.farm_hold_days ?? storage.max_hold_days;
  const sd = (date) => fmtDate(date, { day: "numeric", month: "long" });
  const best = d.best;
  const hasGain = best && best.diff != null && best.diff > 0;
  const chips = { none: { Icon: Scale, tone: "neutral" }, wait: { Icon: CalendarCheck, tone: "good" }, sell_soon: { Icon: TriangleAlert, tone: "warn" } };
  const { Icon, tone } = chips[d.chip];
  const n = best ? Math.abs(best.days) : 0;

  let why, store;
  if (d.code === "D") {
    why = t("price.sell.why.D", { crop, planned: sd(plannedDate), sellBy: sd(d.sellBy) });
    store = t("price.sell.store.D", { crop, sellBy: sd(d.sellBy) });
  } else if (d.code === "B") {
    why = t("price.sell.why.B", { date: sd(best.date), diff: rupees(best.diff) });
    store = <>{t("price.sell.store.B", { crop, days: days(t, n), shelf: days(t, farmDays) })} <ServerText>{storage.note}</ServerText></>;
  } else if (d.code === "A" && hasGain) {
    why = t(`price.sell.why.A.${source}`, { price: rupees(best.price), date: sd(best.date) });
    store = t("price.sell.store.A", { crop, days: days(t, n) });
  } else if (d.code === "A") {
    why = t("price.sell.why.plannedBest");
    store = t("price.sell.store.plannedBest", { crop });
  } else {
    why = t("price.sell.why.C");
    store = t("price.sell.store.C", { crop });
  }

  const showBest = best && (hasGain || d.code === "D");
  const earlier = best && best.days < 0;
  return (
    <div className={`sell-card ${tone}`} data-testid="sell-card" data-outcome={d.code}>
      <div className="sell-badge" data-testid="sell-chip"><Icon size={18} aria-hidden="true" />{t(`price.sell.chip.${d.chip}`)}</div>

      <div className="sell-summary">
        <SellCell label={t("price.sell.planned")} date={plannedDate} price={planned?.price} rec={d.recommended === "planned"} />
        {showBest
          ? <SellCell label={t("price.sell.alt")} date={best.date} price={best.price} rec={d.recommended === "best"}
            sub={d.code === "D" ? null : t(best.gainSmall ? "price.sell.altWhy.small" : "price.sell.altWhy.higher")} />
          : <SellCell label={t("price.sell.alt")} value={t(best ? "price.sell.noBetter" : "price.sell.notAvailable")} />}
        {showBest && best.diff != null
          ? <SellCell label={t("price.sell.diff")} tone={d.code === "B" ? "is-up" : ""}
            value={<>{signedRupees(best.diff)} <small>({pct(best.pct, 1)})</small></>} sub={t("price.sell.beforeCosts")} />
          : <SellCell label={t("price.sell.diff")} value="-" />}
        <SellCell label={t(earlier ? "price.sell.daysBefore" : "price.sell.waitTime")} value={showBest ? days(t, n) : "-"} />
      </div>

      <div className="sell-why">
        <h3><Lightbulb size={16} aria-hidden="true" />{t("price.sell.whyTitle")}</h3>
        <p data-testid="sell-why">{why}</p>
      </div>

      <div className="sell-store">
        <h3><Warehouse size={16} aria-hidden="true" />{t("price.sell.storageTitle")}</h3>
        <p data-testid="sell-store">{store}</p>
        <p className="sell-store-general">
          <span className="sell-store-tag">{t("price.sell.generalLabel")}</span>{" "}
          <ServerText>{storage.note}</ServerText>{" "}
          {t("price.advice.keepsFarm", { days: days(t, farmDays) })}
          {storage.max_hold_days > farmDays && <> {t("price.advice.keepsGood", { days: days(t, storage.max_hold_days) })}</>}
        </p>
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

  const { series, advice } = forecast;
  const marketName = series.market === STATE_MARKET ? tr("price.form.allMarkets") : series.market;
  const crop = cropName(tr, series.commodity);
  const ctxOnly = isContextOnly(forecast);
  const range = rangeView(forecast);
  const latest = forecast.latest_recorded;
  // ONE price for the selected date: the chart dot, the estimate card and the planned-date tile all read it
  const selected = selectedPrice(forecast);
  const rows = referenceRows(forecast);
  const chartPath = forecast.chart_path || forecast.path;
  const chartEnd = forecast.chart_end_date || addDays(forecast.target_date, 14);
  const drawable = ctxOnly ? rows.some((r) => r.date >= forecast.forecast_origin_date) : chartPath.length > 0;
  const stale = !latest || latest.age_days > 7;
  const decision = decideSelling({
    plannedDate: forecast.target_date, today: forecast.input_date, shelfDays: advice.storage.farm_hold_days ?? advice.storage.max_hold_days,
    plannedPrice: selected?.price ?? null, priceAt: makePriceAt(forecast), typicalMiss: typicalMiss(forecast),
  });

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
          {selected ? (
            <>
              <div className="hero-card-head">
                <span className="stat-label" data-testid="price-label">{tr(ctxOnly ? (forecast.history_is_reference ? "price.result.lastYearOn" : "price.result.reportedOn") : "price.result.priceOn", { date: fmtDate(forecast.target_date) })}</span>
              </div>
              <div className="hero-price" data-testid="hero-price">{rupees(selected.price)}<span className="unit"> {tr("unit.perQuintal")}</span></div>
              {!ctxOnly && (range.kind === "measured" || range.kind === "unmeasured") && (
                <div className="stat-sub" data-testid="range-line">{tr("price.result.likelyRange", { low: rupees(range.low), high: rupees(range.high) })}</div>
              )}
            </>
          ) : <p className="hero-nodir" data-testid="no-price">{tr("price.result.noPrice")}</p>}
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

      <ResultStep n={3} id="step-chart" title={tr("price.chart.title", { crop })} className="reveal"
        subtitle={tr(ctxOnly ? "price.chart.descBlocked" : "price.chart.descAllowed", { start: fmtDate(forecast.forecast_origin_date), end: fmtDate(chartEnd) })}>
        {(stale || ctxOnly) && (
          <div style={{ marginBottom: 12 }}>
            <Alert type="info">
              <div data-testid="chart-notice">
                {stale && <p style={{ margin: 0 }}>{tr("price.chart.noticeStale")}</p>}
                {ctxOnly && <p style={{ margin: stale ? "6px 0 0" : 0 }} data-testid="no-forecast-line">{tr("price.chart.noForecastNotice", { crop })}</p>}
              </div>
            </Alert>
          </div>
        )}
        {drawable ? (
          <PriceTrendChart historyIsReference={forecast.history_is_reference} referenceRows={rows} chartPath={ctxOnly ? [] : chartPath}
            originDate={forecast.forecast_origin_date} inputDate={forecast.input_date} currentPrice={forecast.current_price}
            targetDate={forecast.target_date} chartEnd={chartEnd} forecast={!ctxOnly} selected={selected} latest={latest}
            caption={tr(ctxOnly ? (forecast.history_is_reference ? "price.chart.captionBlocked" : "price.chart.captionBlockedActual") : "price.chart.captionAllowed", { crop, market: marketName })} />
        ) : <p className="muted" data-testid="no-history">{tr("price.chart.noHistory", { crop, market: marketName })}</p>}
      </ResultStep>

      <ResultStep n={4} id="step-sell" title={tr("price.sell.title")} subtitle={tr("price.sell.subtitle")} className="sell-step">
        <SellRecommendation decision={decision} planned={selected} plannedDate={forecast.target_date} crop={crop} storage={advice.storage}
          source={ctxOnly ? "earlier" : "model"} />
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
