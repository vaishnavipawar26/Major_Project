import { Fragment, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Sprout } from "lucide-react";
import Alert from "../components/Alert";
import CropArt from "../components/CropArt";
import EmptyState from "../components/EmptyState";
import Loader from "../components/Loader";
import { useT } from "../i18n/LanguageContext";
import { errorMessage } from "../services/api";
import { SCORE_PARTS, isExplainable, recommendedCrop } from "../utils/cropExplanation";
import WhyCrop from "../components/crop/WhyCrop";
import { fitSummary, monthYear } from "../utils/cropPlan";
import { cropName, rupees, signedRupees } from "../utils/format";
import { INPUT_KEYS, loadFromHistory } from "./CropResult";

/**
 * What to explain: the analysis handed over by the result page, or a saved one re-opened by ?id.
 * No browser-session cache is read, so another analysis can never be shown by accident.
 */
function useSource() {
  const location = useLocation();
  const [params] = useSearchParams();
  const id = params.get("id");
  const fromState = location.state?.response ? location.state : null;
  const [loaded, setLoaded] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (fromState || !id) return undefined;
    let live = true;
    setLoaded(null); setError(null);
    loadFromHistory(id).then((d) => live && setLoaded(d)).catch((e) => live && setError(errorMessage(e)));
    return () => { live = false; };
  }, [fromState, id]);

  return { data: fromState || loaded, id, crop: params.get("crop") || location.state?.crop || null, error, missing: !fromState && !id };
}

const Section = ({ id, title, children }) => (
  <section className="card" aria-labelledby={id}>
    <h2 id={id} className="cr-h2">{title}</h2>
    {children}
  </section>
);

function Summary({ best, response, inputs }) {
  const t = useT();
  const e = best.economics;
  const month = monthYear(response.selling_date);
  const na = t("cr.xp.na");
  const facts = [
    [t("cr.xp.score"), `${Math.round(best.recommendation_score)}/100`],
    [t("cr.xp.rank"), t("cr.best.rankValue", { rank: best.rank, total: response.results.length })],
    [t("cr.xp.price"), e ? `${rupees(e.selling_price)} ${t("unit.perQuintal")}` : na],
    [t("cr.xp.period"), month],
    [t("cr.xp.cost"), e ? rupees(e.total_cost) : na],
    [t("cr.xp.profit"), e ? signedRupees(e.net_profit) : na],
    [t("cr.xp.roi"), e ? `${e.roi_pct > 0 ? "+" : ""}${Math.round(e.roi_pct)}%` : na],
  ];
  return (
    <Section id="xp-summary" title={t("cr.xp.summaryTitle")}>
      <div className="best-head">
        <CropArt crop={best.crop_name} size={88} className="best-photo" />
        <div className="min-w-0">
          <p className="best-name">{cropName(t, best.crop_name)}</p>
          <p className="fit-text">{fitSummary(best, inputs, t)}</p>
        </div>
      </div>
      <dl className="kv">
        {facts.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd className="num">{v}</dd></Fragment>)}
      </dl>
    </Section>
  );
}

function ScoreParts({ best, response }) {
  const t = useT();
  const pct = (x) => Math.round(x * 100);
  const score = { agronomic: best.agronomic_score, timing: best.timing_score, profit: best.profit_score };
  return (
    <Section id="xp-score" title={t("cr.xp.scoreTitle")}>
      <p>{t("cr.xp.scoreIntro")}</p>
      <div className="table-wrap">
        <table className="compare-table">
          <thead><tr>
            <th scope="col">{t("cr.xp.colPart")}</th><th scope="col" className="num">{t("cr.xp.colWeight")}</th>
            <th scope="col" className="num">{t("cr.xp.colScore")}</th><th scope="col" className="num">{t("cr.xp.colPoints")}</th>
          </tr></thead>
          <tbody>
            {SCORE_PARTS.map((k) => (
              <tr key={k}>
                <th scope="row">{t(`cr.xp.part.${k}`)}</th>
                <td className="num">{response.weights?.[k] != null ? `${pct(response.weights[k])}%` : "—"}</td>
                <td className="num">{score[k] != null ? Math.round(score[k]) : "—"}</td>
                <td className="num">{best.score_points?.[k] != null ? best.score_points[k].toFixed(1) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="xai-limits">
        {SCORE_PARTS.map((k) => <li key={k}><strong>{t(`cr.xp.part.${k}`)}:</strong> {t(`cr.xp.meaning.${k}`)}</li>)}
      </ul>
      <p className="muted small">{t("cr.fit.tip")}</p>
    </Section>
  );
}

export default function CropExplanation() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const { data, id, crop, error, missing } = useSource();

  const back = () => {
    if (location.key !== "default") navigate(-1);
    else navigate(id ? `/crop-recommendation/result?id=${id}` : "/crop-recommendation/result", id ? undefined : { state: data });
  };
  const header = (
    <div className="page-header">
      <div><h1>{t("cr.xp.title")}</h1><p>{t("cr.xp.desc")}</p></div>
      <button type="button" className="btn btn-secondary" onClick={back}>
        <ArrowLeft size={16} aria-hidden="true" />{t("cr.xp.back")}
      </button>
    </div>
  );
  const emptyAction = <Link className="btn btn-primary" to="/crop-recommendation">{t("cr.xp.missingAction")}</Link>;

  if (error) return <>{header}<Alert type="error" action={emptyAction}>{error}</Alert></>;
  if (missing || data?.legacy || (data && !isExplainable(data))) {
    return <>{header}<EmptyState icon={Sprout} title={t("cr.xp.missingTitle")} action={emptyAction}>{t("cr.xp.missingBody")}</EmptyState></>;
  }
  if (!data) return <>{header}<Loader label={t("cr.xp.loading")} /></>;

  const { response, req } = data;
  const best = response.results.find((r) => r.crop_name === crop) || recommendedCrop(response);
  if (!best) return <>{header}<Alert type="info" action={emptyAction}>{t("cr.xp.noBest")}</Alert></>;
  const inputs = Object.fromEntries(INPUT_KEYS.map((k) => [k, req[k]]));

  return (
    <div className="crop-result">
      {header}
      <div className="stack">
        <Summary best={best} response={response} inputs={inputs} />
        <WhyCrop result={best} response={response} inputs={inputs} />
        <ScoreParts best={best} response={response} />
      </div>
    </div>
  );
}
