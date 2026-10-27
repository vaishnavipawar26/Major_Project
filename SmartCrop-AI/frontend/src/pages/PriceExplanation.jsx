import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ChartNoAxesCombined, MoveRight, TrendingDown, TrendingUp } from "lucide-react";
import Alert from "../components/Alert";
import EmptyState from "../components/EmptyState";
import Loader from "../components/Loader";
import ServerText from "../components/ServerText";
import { useT } from "../i18n/LanguageContext";
import { errorMessage } from "../services/api";
import { historyService } from "../services/historyService";
import { priceService } from "../services/priceService";
import { addDays, cropName, fmtDate, pct, rupees } from "../utils/format";
import { STATE_MARKET } from "../utils/constants";
import ExplanationV3 from "../components/price/ExplanationV3";
import ConditionMeanings from "../components/price/ConditionMeanings";
import UnderstandPrediction from "../components/price/UnderstandPrediction";
import { useFieldConditions } from "../hooks/useFieldConditions";
import { explanationOk } from "../components/price/factorModel";
import { isExplainedReliably, matchesRequest, reasonsOf, reliabilityView } from "../utils/explanationView";

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
        as_of: p.input_date, target_date: addDays(p.input_date, p.horizon_days) },
    })).catch((e) => live && setError(errorMessage(e)));
    return () => { live = false; };
  }, [fromState, id]);

  const src = fromState || saved;
  return { req: src?.req || null, explain: fromState?.explain || null, which: fromState?.which || 0,
    id, error, missing: !fromState && !id };
}

/** Predicted price and a one-sentence summary, both built from the forecast's own numbers. */
function Summary({ exp, explain }) {
  const t = useT();
  const s = exp.summary;
  const flat = s.direction === "about the same";
  const kind = flat ? "flat" : s.change_abs > 0 ? "up" : "down";
  const crop = cropName(t, explain.series.commodity);
  const market = explain.series.market === STATE_MARKET ? t("price.form.allMarkets") : explain.series.market;
  const sign = s.change_abs >= 0 ? "+" : "−";
  return (
    <section className="xai-overall" aria-labelledby="expl-summary">
      <h2 id="expl-summary" className="xai-h">{t("price.expl.predictedTitle")}</h2>
      <dl className="kv">
        <dt>{t("hist.col.crop")} · {t("hist.col.market")}</dt><dd><strong>{crop}</strong> · {market}</dd>
        <dt>{t("price.result.startingPrice")}</dt><dd>{rupees(s.reference_price)} <span className="muted small">{t("price.expl.perQuintal")} · {fmtDate(explain.forecast_origin_date)}</span></dd>
        <dt>{t("price.expl.expectedPrice")}</dt><dd><strong>{rupees(s.predicted_price)}</strong> <span className="muted small">{t("price.expl.perQuintal")} · {fmtDate(exp.date)}</span></dd>
        <dt>{t("price.expl.expectedChange")}</dt><dd>{sign}{rupees(Math.abs(s.change_abs))} ({sign}{Math.abs(s.change_pct).toFixed(0)}%)</dd>
      </dl>
      <p className="xai-line" style={{ fontSize: "1.05rem" }}>
        {t(`price.expl.para.${kind}`, {
          crop, from: rupees(s.reference_price), to: rupees(s.predicted_price),
          date: fmtDate(exp.date, { day: "numeric", month: "long", year: "numeric" }),
        })}
      </p>
    </section>
  );
}

/** One reason: familiar title and direction, one sentence of measured evidence, one sentence on what it means. */
function Reason({ r }) {
  const t = useT();
  const up = r.direction === "up";
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <li className={`factor-card xai-card ${up ? "push-up" : "push-down"}`}>
      <strong className="factor-name">{r.title}</strong>
      <span className="factor-push"><Icon size={15} aria-hidden="true" />{t(up ? "price.expl.pushHigher" : "price.expl.pushLower")}</span>
      <p className="xai-parts" style={{ margin: "0.3rem 0 0" }}>
        <ServerText>{r.evidence}</ServerText> <ServerText>{r.meaning}</ServerText>
      </p>
    </li>
  );
}

/** Section D: typical error read against the expected change, the range and any warning that really applies. */
function Reliability({ exp }) {
  const t = useT();
  const v = reliabilityView(exp);
  const m = v.message?.vars;
  const vars = m && "mae" in m ? { change: rupees(m.change), mae: rupees(m.mae), move: t(`price.expl.move.${m.move}`) } : m;
  return (
    <section aria-labelledby="expl-rel">
      <h2 id="expl-rel" className="xai-h">{t("price.expl.trustTitle")}</h2>
      <ul className="xai-limits">
        {v.message && <li className={v.smaller || v.message.key === "price.expl.relMsgSmall" ? "xai-caution" : ""}>{t(v.message.key, vars)}</li>}
        {v.range && <li>{t("price.expl.rangeLine", { low: rupees(v.range.lower), high: rupees(v.range.upper) })}</li>}
        {v.warnings.map((w) => <li key={w.key}>{t(w.key, w.vars)}</li>)}
      </ul>
    </section>
  );
}

function Advanced({ exp, model }) {
  const t = useT();
  const tech = exp.technical;
  const feats = Object.entries(tech.features).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const recon = tech.reconstruction_ok == null ? t("price.expl.techReconNa")
    : t(tech.reconstruction_ok ? "price.expl.techReconPass" : "price.expl.techReconFail",
      { err: tech.reconstruction_error, tol: tech.reconstruction_tolerance });
  return (
    <details className="kid-about xai-tech" data-testid="expl-advanced">
      <summary>{t("price.expl.techTitle")}</summary>
      <dl className="kv">
        <dt>{t("price.expl.techModel")}</dt><dd>{model?.algorithm || "—"}</dd>
        <dt>{t("price.expl.techVersion")}</dt><dd>{model?.version || "—"}</dd>
        <dt>{t("price.expl.techExplainer")}</dt><dd>{tech.explainer_type || exp.method}</dd>
        <dt>{t("price.expl.techSpace")}</dt><dd>{exp.output_space}</dd>
        <dt>{t("price.expl.techBase")}</dt><dd>{exp.base_value.toFixed(5)}</dd>
        <dt>{t("price.expl.techSum")}</dt><dd>{tech.sum_of_contributions_log.toFixed(5)}</dd>
        <dt>{t("price.expl.techOut")}</dt><dd>{tech.model_output_log.toFixed(5)}</dd>
        <dt>{t("price.expl.techRecon")}</dt><dd>{recon}</dd>
      </dl>
      <p className="small muted">{t("price.expl.techLogNote")}</p>
      {tech.grouped && (
        <>
          <h3 className="xai-h">{t("price.expl.techGrouped")}</h3>
          <div className="xai-table-wrap"><table className="xai-table">
            <thead><tr><th scope="col">{t("price.expl.colGroup")}</th><th scope="col">{t("price.expl.colContribution")}</th></tr></thead>
            <tbody>{Object.entries(tech.grouped).map(([k, g]) => <tr key={k}><td>{g.title} ({k})</td><td>{g.shap_value.toFixed(5)}</td></tr>)}</tbody>
          </table></div>
        </>
      )}
      <h3 className="xai-h">{t("price.expl.techFeatures")}</h3>
      <div className="xai-table-wrap"><table className="xai-table">
        <thead><tr><th scope="col">{t("price.expl.colFeature")}</th><th scope="col">{t("price.expl.colValue")}</th><th scope="col">{t("price.expl.colContribution")}</th></tr></thead>
        <tbody>{feats.map(([k, v]) => {
          const val = tech.feature_values?.[k];
          return <tr key={k}><td>{k}</td><td>{val == null ? "—" : val}</td><td>{v.toFixed(5)}</td></tr>;
        })}</tbody>
      </table></div>
    </details>
  );
}

export default function PriceExplanation() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const { req, explain: passed, which: passedWhich, id, error: srcError, missing } = useExplanationSource();
  const [explain, setExplain] = useState(passed);
  const fieldConditions = useFieldConditions(explain?.series?.market, explain?.target_date);   // the market the forecast actually used
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
  // the SHAP-based "Understand Your Crop Price Prediction" view, only when the app trusts a price and the explanation adds up
  const newView = explanationOk(exp, false);
  const reasons = reasonsOf(exp);
  // evidence-first layout when the backend sent it (older saved responses keep the previous layout below)
  const v3 = exp.v3 || null;
  const v3Ok = v3 && !(v3.checks?.reconstruction_error > 1e-3) && exp.technical?.reconstruction_ok !== false;

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
        {newView ? <UnderstandPrediction exp={exp} crop={cropName(t, explain.series.commodity)} market={explain.series.market} targetDate={exp.date} req={req} />
        : v3 ? (
          v3Ok ? <ExplanationV3 exp={exp} explain={explain} />
            : <Alert type="info">{t("price.expl.unreliable")}</Alert>
        ) : <Summary exp={exp} explain={explain} />}
        {!newView && !v3 && (<>
        <section aria-labelledby="expl-main">
          <h2 id="expl-main" className="xai-h">{t("price.expl.driveTitle")}</h2>
          {reasons.length > 0 && isExplainedReliably(exp) ? (
            <>
              <ul className="factor-cards">{reasons.map((r) => <Reason key={r.id} r={r} />)}</ul>
              {reasons.length < 3 && <p className="muted small">{t("price.expl.fewReasons", { n: reasons.length })}</p>}
            </>
          ) : <Alert type="info">{t(exp.technical?.reconstruction_ok === false ? "price.expl.unreliable" : "price.expl.noEvidence")}</Alert>}
        </section>
        {exp.what_it_means && isExplainedReliably(exp) && (
          <section aria-labelledby="expl-means">
            <h2 id="expl-means" className="xai-h">{t("price.expl.meansTitle")}</h2>
            <p className="xai-line"><ServerText>{exp.what_it_means}</ServerText></p>
          </section>
        )}
        <Reliability exp={exp} />
        {(exp.data_basis || exp.scope) && (
          <p className="muted small">{exp.data_basis && <ServerText>{exp.data_basis.text}</ServerText>} {exp.scope && <ServerText>{exp.scope.text}</ServerText>}</p>
        )}
        </>)}
        <ConditionMeanings crop={cropName(t, explain.series.commodity)} market={explain.series.market === STATE_MARKET ? t("price.form.allMarkets") : explain.series.market} weather={fieldConditions.weather} soil={fieldConditions.soil} />
        <p className="muted small">{t("price.expl.note")}</p>
        {/* developer-only: base value, raw contributions, encoded features, model and explainer details */}
        {import.meta.env.DEV &&         <Advanced exp={exp} model={{ ...explain.model, algorithm: exp.algorithm || explain.model?.algorithm }} />}
      </div>
    </>
  );
}
