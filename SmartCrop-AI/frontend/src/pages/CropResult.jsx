import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { CircleHelp, History, Plus, Sprout } from "lucide-react";
import Alert from "../components/Alert";
import EmptyState from "../components/EmptyState";
import Loader from "../components/Loader";
import ServerText from "../components/ServerText";
import BestCropCard from "../components/crop/BestCropCard";
import CropCompare from "../components/crop/CropCompare";
import Financials from "../components/crop/Financials";
import PersonalPlan from "../components/crop/PersonalPlan";
import PlanSummary from "../components/crop/PlanSummary";
import TimelineSection from "../components/crop/TimelineSection";
import { useT } from "../i18n/LanguageContext";
import { errorMessage } from "../services/api";
import { cropService } from "../services/cropService";
import { historyService } from "../services/historyService";
import { cropName, fmtDateTime, titleCase } from "../utils/format";
import { defaultCrop } from "../utils/cropPlan";
import { LAST_CROP_RESULT_KEY, SOILS } from "./CropRecommendation";

export const INPUT_KEYS = ["nitrogen", "phosphorus", "potassium", "temperature", "humidity", "ph", "rainfall"];

/** Rebuild the dashboard from a saved history record by re-running the (unsaved) analysis. */
export async function loadFromHistory(id) {
  const rec = await historyService.recommendationItem(id);
  if (!rec.city || !rec.selling_month) return { legacy: rec };
  const req = {
    ...Object.fromEntries(INPUT_KEYS.map((k) => [k, rec[k]])),
    city: rec.city, planting_month: rec.month, selling_month: rec.selling_month,
    area_acres: rec.area_acres || 1, state: "Maharashtra", soil_type: SOILS.includes(rec.soil_type) ? rec.soil_type : "unknown",   // older records may hold free text
    planting_year: rec.planting_date ? Number(rec.planting_date.slice(0, 4)) : null,
    // the optional budget plan: only the inputs that were saved, so an old record asks for exactly what it always did
    ...(rec.budget_inr != null ? { budget_inr: rec.budget_inr } : {}),
    ...(rec.priority ? { priority: rec.priority } : {}),
    ...(rec.risk_level ? { risk_level: rec.risk_level } : {}),
  };
  const response = await cropService.analyze(req);
  return { fromHistory: true, createdAt: rec.created_at, req, response: { ...response, id: rec.id } };
}

export default function CropResult() {
  const tr = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const id = params.get("id");
  const [data, setData] = useState(() => {
    if (location.state?.response) return location.state;
    if (!id) {
      try { return JSON.parse(sessionStorage.getItem(LAST_CROP_RESULT_KEY)); } catch { return null; }
    }
    return null;
  });
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (data || !id) return;
    loadFromHistory(id).then(setData).catch((e) => setError(errorMessage(e)));
  }, [id, data]);

  const response = data?.response;
  const results = response?.results;
  // details start with the best overall crop, else the highest-profit one, else the first-ranked crop
  const current = useMemo(() => results && defaultCrop(results, response, selected), [results, selected, response]);

  const backLinks = (
    <div className="row">
      {id && <Link to="/history" className="btn btn-secondary"><History size={16} aria-hidden="true" />{tr("common.backToHistory")}</Link>}
      <Link to="/crop-recommendation" className="btn btn-primary"><Plus size={16} aria-hidden="true" />{tr("crop.result.newAnalysis")}</Link>
    </div>
  );

  if (error) return <Alert type="error" action={backLinks}>{error}</Alert>;
  if (!data && id) return <Loader label={tr("crop.result.loadingHistory")} />;
  if (data?.legacy) {
    return (
      <>
        <div className="page-header"><div><h1>{tr("crop.result.legacyTitle")}</h1><p>{tr("crop.result.savedOn", { date: fmtDateTime(data.legacy.created_at) })}</p></div>
          {backLinks}</div>
        <Alert type="info">{tr("crop.result.legacyBody", { crops: data.legacy.results.map((r) => cropName(tr, titleCase(r.crop_name))).join(", ") })}</Alert>
      </>
    );
  }
  // nothing yet, or a result saved in this browser session by an older version of the page
  if (!data || !results?.[0]?.timeline || !results[0].range_fit) {
    return <EmptyState icon={Sprout} title={tr("crop.result.emptyTitle")}
      action={<Link className="btn btn-primary" to="/crop-recommendation">{tr("crop.result.emptyAction")}</Link>} />;
  }

  const best = results.find((r) => r.crop_name === response.best_overall);

  return (
    <div className="crop-result">
      <div className="page-header">
        <div>
          <h1>{tr("crop.result.title")}</h1>
        </div>
        {backLinks}
      </div>

      {response.warnings.length > 0 && (
        <div className="stack mb-4">{response.warnings.map((w) => <Alert key={w} type={/is outside the range in the training data/.test(w) ? "info" : "warn"}><ServerText>{w}</ServerText></Alert>)}</div>
      )}

      <div className="stack">
        <div className="cr-top">
          <PlanSummary response={response} crop={best || current} />
          <BestCropCard response={response} onSelect={setSelected} />
        </div>
        <PersonalPlan response={response} />
        <CropCompare response={response} selected={current.crop_name} onSelect={setSelected} />
        <Financials result={current} response={response} />
        <TimelineSection result={current} />
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={() => {
            // the saved record id travels in the URL; an unsaved result has none, so it is handed over as page state instead
            const rid = id || response.id;
            navigate(rid ? `/crop-recommendation/explanation?id=${rid}` : "/crop-recommendation/explanation", { state: data });
          }}>
            <CircleHelp size={16} aria-hidden="true" />{tr("cr.xp.viewButton")}
          </button>
        </div>
      </div>
    </div>
  );
}
