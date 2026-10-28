import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, ChartNoAxesCombined, CircleHelp, History,
} from "lucide-react";
import Alert from "../components/Alert";
import CropArt from "../components/CropArt";
import EmptyState from "../components/EmptyState";
import Loader from "../components/Loader";
import ResultStep from "../components/ResultStep";
import Tip from "../components/Tip";
import PriceForecastChart from "../components/price/PriceForecastChart";
import SellingRecommendation from "../components/price/SellingRecommendation";
import { useT } from "../i18n/LanguageContext";
import { errorMessage } from "../services/api";
import { historyService } from "../services/historyService";
import { priceService } from "../services/priceService";
import { STATE_MARKET } from "../utils/constants";
import { addDays, cropName, fmtDate, rupees } from "../utils/format";
import { isContextOnly, rangeView } from "../utils/priceView";
import { referenceInfo, selectedPrice } from "../utils/selectedPrice";
import { LAST_PRICE_REQUEST_KEY } from "./PricePrediction";

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
        as_of: p.input_date, target_date: addDays(p.input_date, p.horizon_days),
        ...(p.growing_location ? { growing_location: p.growing_location } : {}) },
    })).catch((e) => setError(errorMessage(e)));
  }, [id, source]);
  return { source, error, missing: !source && !id };
}

export default function PriceResult() {
  const tr = useT();
  const [params] = useSearchParams();
  const historyId = params.get("id");
  const { source, error: sourceError, missing } = useResultSource();
  const [forecast, setForecast] = useState(source?.forecast || null);
  const [explain, setExplain] = useState(null);
  // the farmer's storage choice ("facility:condition"); null = the API's default, ordinary farm storage. One choice drives the chart and the card.
  const [storageKey, setStorageKey] = useState(null);
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
  const ref = referenceInfo(forecast);
  const fromEarlier = ref.years > 0 && forecast.history_is_reference;

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

      <ResultStep n={1} id="step-price" title={tr("price.steps.price")} className="hero-card">
        {selected ? (
          <div className="market-card" style={{ alignItems: "center" }}>
            <CropArt crop={series.commodity} size={72} decorative className="hero-crop-art" />
            <div style={{ minWidth: 0 }}>
              <span className="stat-label" data-testid="price-label">{selected.source === "latest" ? tr("price.result.latestOn", { date: fmtDate(selected.date) })
                : tr(ctxOnly ? (fromEarlier ? "price.result.refPriceOn" : "price.result.reportedOn") : "price.result.priceOn", { date: fmtDate(ctxOnly && fromEarlier ? ref.sourceDate : forecast.target_date) })}</span>
              <div className="hero-price" data-testid="hero-price">{rupees(selected.price)}<span className="unit"> {tr("unit.perQuintal")}</span></div>
              {ctxOnly && (
                <div className="stat-sub" data-testid="no-forecast-note">{tr(selected.source === "latest" ? "price.result.noForecastLatest" : "price.result.noForecast", { date: fmtDate(forecast.target_date) })}</div>
              )}
              {ctxOnly && fromEarlier && selected.source === "reference" && (
                <div className="stat-sub" data-testid="ref-note">{tr(ref.inflationPct != null ? "price.result.refNoteInfl" : "price.result.refNote",
                  { source: fmtDate(ref.sourceDate), date: fmtDate(forecast.target_date), pct: ref.inflationPct })}</div>
              )}
              <div className="stat-sub" data-testid="summary-line"><strong>{crop}</strong> · {marketName} · {tr("price.form.date")}: <strong>{fmtDate(forecast.target_date)}</strong></div>
              {latest && selected.source !== "latest" && (
                <div className="stat-sub" data-testid="latest-actual">{tr("res.latestActual", { price: rupees(latest.price), date: fmtDate(latest.date) })}</div>
              )}
              {!ctxOnly && (range.kind === "measured" || range.kind === "unmeasured") && (
                <div className="stat-sub" data-testid="range-line">{tr("price.result.likelyRange", { low: rupees(range.low), high: rupees(range.high) })}</div>
              )}
            </div>
          </div>
        ) : (
          <>
            <p className="hero-nodir" data-testid="no-price">{ctxOnly ? tr("price.result.noRefPrice", { date: fmtDate(forecast.target_date) }) : tr("price.result.noPrice")}</p>
            <div className="stat-sub" data-testid="summary-line"><strong>{crop}</strong> · {marketName} · {tr("price.form.date")}: <strong>{fmtDate(forecast.target_date)}</strong></div>
            {latest && <div className="stat-sub" data-testid="latest-actual">{tr("res.latestActual", { price: rupees(latest.price), date: fmtDate(latest.date) })}</div>}
          </>
        )}
      </ResultStep>

      <ResultStep n={2} id="step-chart" title={tr("pfc.title")} subtitle={tr("pfc.subtitle")}>
        <PriceForecastChart forecast={forecast} crop={crop} market={marketName} storageKey={storageKey} />
      </ResultStep>

      <ResultStep n={3} id="step-sell" title={tr("price.sell.title")} subtitle={tr("price.sell.subtitle")} className="sell-step">
        <SellingRecommendation win={forecast.window} storage={advice.storage} crop={crop} storageKey={storageKey} />
      </ResultStep>

      <div className="card" style={{ margin: "1rem 0", padding: "1.1rem", textAlign: "center" }} data-testid="explain-card">
        <p className="muted small" style={{ margin: "0 0 0.6rem" }}>{tr("price.expl.buttonHint")}</p>
        <button type="button" className="btn btn-primary btn-lg" data-testid="why-button" style={{ fontSize: "1.05rem", padding: "0.8rem 1.4rem" }}
          onClick={() => navigate(historyId ? `/price-prediction/explanation?id=${historyId}` : "/price-prediction/explanation",
            { state: { req: source.req, explain } })}>
          <CircleHelp size={18} aria-hidden="true" />{tr("price.expl.button")}
        </button>
      </div>

    </>
  );
}
