import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, CalendarDays, History, MapPin, Plus, Ruler, Sprout } from "lucide-react";
import Alert from "../components/Alert";
import CropArt from "../components/CropArt";
import EmptyState from "../components/EmptyState";
import Loader from "../components/Loader";
import { useT } from "../i18n/LanguageContext";
import { errorMessage } from "../services/api";
import { isExplainable, recommendedCrop } from "../utils/cropExplanation";
import FarmExplanation from "../components/crop/FarmExplanation";
import { fitSummary, monthYear } from "../utils/cropPlan";
import { acresText } from "../utils/farmerExplanation";
import { cropName } from "../utils/format";
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

function Summary({ best, response, inputs }) {
  const t = useT();
  const facts = [
    [MapPin, t("cr.fx.hero.location"), cropName(t, response.city, "city")],
    [Sprout, t("cr.fx.hero.planting"), monthYear(best.timeline?.planting || response.planting_date?.slice(0, 7))],
    [CalendarDays, t("cr.fx.hero.selling"), monthYear(response.selling_date)],
    [Ruler, t("cr.fx.hero.farm"), acresText(response.area_acres, t)],
  ];
  return (
    <section className="card xp-hero" aria-labelledby="xp-summary">
      <h2 id="xp-summary" className="sr-only">{t("cr.xp.summaryTitle")}</h2>
      <div className="best-head">
        <CropArt crop={best.crop_name} size={88} className="best-photo" />
        <div className="min-w-0">
          <p className="best-name">{cropName(t, best.crop_name)}</p>
          <p className="fit-text">{fitSummary(best, inputs, t)}</p>
        </div>
        <div className="xp-score" role="group" aria-label={t("cr.fx.hero.score")}>
          <span className="xp-score-num num">{Math.round(best.recommendation_score)}<small>/100</small></span>
          <span className="xp-score-label">{t("cr.fx.hero.score")}</span>
          <span className="xp-score-rank">{t("cr.best.rankValue", { rank: best.rank, total: response.results.length })}</span>
        </div>
      </div>
      <dl className="xp-facts">
        {facts.map(([Icon, k, v]) => (
          <div key={k} className="xp-fact"><dt><Icon size={15} aria-hidden="true" />{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
    </section>
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
      <div className="row">
        <button type="button" className="btn btn-secondary" onClick={back}>
          <ArrowLeft size={16} aria-hidden="true" />{t("cr.fx.backResults")}
        </button>
        {id && <Link to="/history" className="btn btn-secondary"><History size={16} aria-hidden="true" />{t("common.backToHistory")}</Link>}
        <Link to="/crop-recommendation" className="btn btn-primary"><Plus size={16} aria-hidden="true" />{t("crop.result.newAnalysis")}</Link>
      </div>
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
        <FarmExplanation result={best} response={response} inputs={inputs} />
      </div>
    </div>
  );
}
