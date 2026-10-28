import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ChartNoAxesCombined } from "lucide-react";
import Alert from "../components/Alert";
import EmptyState from "../components/EmptyState";
import Loader from "../components/Loader";
import ServerText from "../components/ServerText";
import { useT } from "../i18n/LanguageContext";
import { errorMessage } from "../services/api";
import { historyService } from "../services/historyService";
import { priceService } from "../services/priceService";
import { addDays, cropName } from "../utils/format";
import { STATE_MARKET } from "../utils/constants";
import { WhyFactorsMatter } from "../components/price/WhyFactors";
import FactorInfluence from "../components/price/FactorInfluence";
import UnderstandPrediction from "../components/price/UnderstandPrediction";
import { useFieldConditions } from "../hooks/useFieldConditions";
import { explanationOk } from "../components/price/factorModel";
import { matchesRequest } from "../utils/explanationView";

/**
 * Which prediction to explain. Only an explicit source is accepted: the navigation state from the
 * result page, or a saved prediction id in the URL. Nothing is read from a "last prediction" cache,
 * so a different forecast can never be shown by accident.
 */
function useExplanationSource() {
  const location = useLocation();
  const [params] = useSearchParams();
  const id = params.get("id");
  const fromState = location.state?.req ? location.state : null;
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (fromState || !id) return undefined;
    let live = true;
    setSaved(null); setError(null);
    historyService.priceItem(id).then((p) => live && setSaved({
      req: { state: p.state, market: p.market, commodity: p.commodity, variety: p.variety,
        as_of: p.input_date, target_date: addDays(p.input_date, p.horizon_days),
        ...(p.growing_location ? { growing_location: p.growing_location } : {}) },
    })).catch((e) => live && setError(errorMessage(e)));
    return () => { live = false; };
  }, [fromState, id]);

  const src = fromState || saved;
  return { req: src?.req || null, explain: fromState?.explain || null, which: fromState?.which || 0,
    id, error, missing: !fromState && !id };
}

export default function PriceExplanation() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const { req, explain: passed, which: passedWhich, id, error: srcError, missing } = useExplanationSource();
  const [explain, setExplain] = useState(passed);
  const fieldConditions = useFieldConditions(explain?.series?.market, explain?.target_date, null, req?.growing_location);   // the growing location (else the market the forecast used)
  const [error, setError] = useState(null);
  const [which, setWhich] = useState(passedWhich);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!req) return undefined;
    // the explanation handed over by the result page is for this exact request: no second model run
    if (passed && attempt === 0) { setExplain(passed); return undefined; }
    let live = true;
    setExplain(null); setError(null);
    priceService.explain(req).then((e) => live && setExplain(e)).catch((e) => live && setError(errorMessage(e)));
    return () => { live = false; };
  }, [req, passed, attempt]);

  const back = useCallback(() => {
    if (location.key !== "default") navigate(-1);
    else if (id) navigate(`/price-prediction/result?id=${id}`);
    else navigate("/price-prediction/result", { state: { req } });
  }, [navigate, location.key, id, req]);

  const backBtn = (
    <button type="button" className="btn btn-secondary" onClick={back}>
      <ArrowLeft size={16} aria-hidden="true" />{t("price.expl.back")}
    </button>
  );
  const header = (
    <div className="page-header">
      <div><h1>{t("price.expl.title")}</h1><p>{t("price.expl.desc")}</p></div>
      {backBtn}
    </div>
  );

  if (missing) {
    return (
      <>
        {header}
        <EmptyState icon={ChartNoAxesCombined} title={t("price.expl.missingTitle")}
          action={<Link className="btn btn-primary" to="/price-prediction">{t("price.expl.missingAction")}</Link>}>
          {t("price.expl.missingBody")}
        </EmptyState>
      </>
    );
  }
  if (srcError || error) {
    return (
      <>
        {header}
        <Alert type="error" action={<div className="row">
          {error && <button type="button" className="btn btn-secondary" onClick={() => setAttempt((n) => n + 1)}>{t("price.expl.retry")}</button>}
          <Link className="btn btn-primary" to="/price-prediction">{t("price.expl.missingAction")}</Link></div>}>
          {srcError || error}
        </Alert>
      </>
    );
  }
  if (!explain) return <>{header}<Loader label={t("price.expl.loading")} /></>;
  if (!matchesRequest(req, explain)) return <>{header}<Alert type="error">{t("price.expl.mismatch")}</Alert></>;

  const exps = explain.explanations || [];
  const exp = exps[Math.min(which, exps.length - 1)];
  if (!exp) return <>{header}<Alert type="info">{explain.message ? <ServerText>{explain.message}</ServerText> : t("price.expl.noExplanation")}</Alert></>;
  // the approved view needs a price the app trusts and a breakdown that adds up to it; otherwise only a status message is shown
  const newView = explanationOk(exp, false);
  const crop = cropName(t, explain.series.commodity);
  const marketName = explain.series.market === STATE_MARKET ? t("price.form.allMarkets") : explain.series.market;
  const noForecast = exp.v3?.context_only || exp.policy?.mode === "context_only";
  const influence = (
    <>
      <section className="card xp-section fi-card" aria-labelledby="fi-title" data-testid="influence-card">
        <h2 id="fi-title" className="cr-h2">{t("fi.title")}</h2>
        <p className="step-subtitle">{t("fi.subtitle")}</p>
        <FactorInfluence weather={fieldConditions.weather} soil={fieldConditions.soil} market={marketName} />
      </section>
      <WhyFactorsMatter exp={exp} crop={crop} market={marketName} targetDate={exp.date ?? explain.target_date}
        weather={fieldConditions.weather} soil={fieldConditions.soil} growing={req?.growing_location} modelInputs={explain.model_inputs} />
    </>
  );

  return (
    <>
      {newView ? (
        <div className="page-header">
          <div><h1>{t("ex.pageTitle")}</h1><p>{t("ex.pageDesc")}</p></div>
          {backBtn}
        </div>
      ) : header}
      <div className="stack">
        {exps.length > 1 && (
          <div className="segmented" role="radiogroup" aria-label={t("price.why.whichDate")}>
            {exps.map((e, i) => (
              <button key={e.date} type="button" role="radio" aria-checked={which === i}
                className={which === i ? "active" : ""} onClick={() => setWhich(i)}>
                {i === 0 ? t("price.chart.yourDate") : t("price.why.suggestedDate")}
              </button>
            ))}
          </div>
        )}
        {newView
          ? <UnderstandPrediction exp={exp} crop={crop} market={explain.series.market} targetDate={exp.date} req={req} afterA={influence} />
          : (
            <>
              <div data-testid="no-price-status"><Alert type="info">{t(noForecast ? "fb.notShown" : "price.expl.unreliable", { crop })}</Alert></div>
              {influence}
            </>
          )}
      </div>
    </>
  );
}
