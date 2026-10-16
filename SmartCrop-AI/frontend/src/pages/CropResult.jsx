import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { History, Plus, Sprout } from "lucide-react";
import Alert from "../components/Alert";
import EmptyState from "../components/EmptyState";
import Loader from "../components/Loader";
import ServerText from "../components/ServerText";
import BestCropCard from "../components/crop/BestCropCard";
import CropCompare from "../components/crop/CropCompare";
import CropPicker from "../components/crop/CropPicker";
import Financials from "../components/crop/Financials";
import PlanSummary from "../components/crop/PlanSummary";
import SuitabilitySection from "../components/crop/SuitabilitySection";
import TimelineSection from "../components/crop/TimelineSection";
import { useT } from "../i18n/LanguageContext";
import { errorMessage } from "../services/api";
import { cropService } from "../services/cropService";
import { historyService } from "../services/historyService";
import { cropName, fmtDateTime, titleCase } from "../utils/format";
import { LAST_CROP_RESULT_KEY } from "./CropRecommendation";

const INPUT_KEYS = ["nitrogen", "phosphorus", "potassium", "temperature", "humidity", "ph", "rainfall"];

/** Rebuild the dashboard from a saved history record by re-running the (unsaved) analysis. */
async function loadFromHistory(id) {
  const rec = await historyService.recommendationItem(id);
  if (!rec.city || !rec.selling_month) return { legacy: rec };
  const req = {
    ...Object.fromEntries(INPUT_KEYS.map((k) => [k, rec[k]])),
    city: rec.city, planting_month: rec.month, selling_month: rec.selling_month,
    area_acres: rec.area_acres || 1, state: "Maharashtra", soil_type: rec.soil_type,
    planting_year: rec.planting_date ? Number(rec.planting_date.slice(0, 4)) : null,
  };
  const response = await cropService.analyze(req);
  return { fromHistory: true, createdAt: rec.created_at, req, response: { ...response, id: rec.id } };
}

export default function CropResult() {
  const tr = useT();
  const location = useLocation();
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
  const current = useMemo(() => results && (results.find((r) => r.crop_name === selected)
    || results.find((r) => r.crop_name === response.best_overall)
    || results.find((r) => r.crop_name === response.highest_profit) || results[0]), [results, selected, response]);

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
  const inputs = Object.fromEntries(INPUT_KEYS.map((k) => [k, data.req[k]]));

  return (
    <div className="crop-result">
      <div className="page-header">
        <div>
          <h1>{tr("crop.result.title")}</h1>
          <p>{tr("cr.subtitle")}</p>
        </div>
        {backLinks}
      </div>

      {response.warnings.length > 0 && (
        <div className="stack mb-4">{response.warnings.map((w) => <Alert key={w} type="warn"><ServerText>{w}</ServerText></Alert>)}</div>
      )}

      <div className="stack">
        <PlanSummary response={response} crop={best || current} fromHistory={data.fromHistory} savedAt={data.createdAt} />
        <BestCropCard response={response} onSelect={setSelected} />
        <CropCompare response={response} selected={current.crop_name} onSelect={setSelected} />
        <CropPicker results={results} selected={current.crop_name} bestName={response.best_overall} onSelect={setSelected} />
        <SuitabilitySection result={current} response={response} inputs={inputs} />
        <Financials result={current} response={response} />
        <TimelineSection result={current} />
        <p className="cr-disclaimer">{tr("cr.disclaimer")}</p>
      </div>
    </div>
  );
}
