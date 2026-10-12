import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import {
  CalendarDays, ChartLine, CircleCheck, CircleHelp, ClipboardCheck, Gauge, History, IndianRupee, Info, Lightbulb, MapPin,
  ReceiptText, Scale, Sprout, Star,
} from "lucide-react";
import Alert from "../components/Alert";
import ChartIntro from "../components/ChartIntro";
import CropArt from "../components/CropArt";
import CropTimeline from "../components/CropTimeline";
import EmptyState from "../components/EmptyState";
import Loader from "../components/Loader";
import ResultStep from "../components/ResultStep";
import ScoreBar from "../components/ScoreBar";
import ServerText from "../components/ServerText";
import Tip from "../components/Tip";
import TechnicalDetails from "../components/TechnicalDetails";
import WhyPanel, { WhyTechnical } from "../components/WhyPanel";
import MonthlyPriceChart from "../components/charts/MonthlyPriceChart";
import ProfitComparisonChart from "../components/charts/ProfitComparisonChart";
import { useT } from "../i18n/LanguageContext";
import { errorMessage } from "../services/api";
import { cropService } from "../services/cropService";
import { historyService } from "../services/historyService";
import { compactRupees, cropName, fmtDateTime, monthLabel, pct, rupees, signedRupees, titleCase } from "../utils/format";
import { LAST_CROP_RESULT_KEY } from "./CropRecommendation";

const GRID_COLS = { 2: "lg:grid-cols-2", 3: "lg:grid-cols-3" };
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

function Kpi({ label, value, sub, tone }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="text-xs font-medium text-ink-muted">{label}</div>
      <div className={`num text-xl font-bold ${tone === "neg" ? "text-[var(--critical)]" : tone === "pos" ? "text-[var(--good-text)]" : "text-ink"}`}>{value}</div>
      {sub && <div className="text-xs text-ink-muted">{sub}</div>}
    </div>
  );
}

function TopCard({ r, active, onClick, best }) {
  const t = useT();
  const e = r.economics;
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`card top-card !mt-0 w-full cursor-pointer text-left ${best ? "is-best" : ""} ${active ? "is-active" : ""}`}>
      {/* the first recommended crop in the API's own order is highlighted; ranks and scores are unchanged */}
      {best && <span className="best-ribbon"><Star size={13} fill="currentColor" aria-hidden="true" />{t("crop.result.bestBadge")}</span>}
      <span className="flex items-start gap-3">
        <CropArt crop={r.crop_name} size={best ? 68 : 56} decorative className="top-card-art" />
        <span className="min-w-0 flex-1">
          <span className="top-card-title"><span className="rank-pill" aria-label={t("crop.result.rankAria", { n: r.rank })}>#{r.rank}</span>{cropName(t, r.crop_name)}</span>
          <ServerText className="mt-1 block text-sm text-ink-2">{r.summary}</ServerText>
        </span>
        <span className="top-card-score text-right">
          <span className="block text-xs text-ink-muted">{t("crop.result.overallScore")}</span>
          <span className="num block text-2xl font-bold">{Math.round(r.recommendation_score)}<span className="text-sm font-normal text-ink-muted">/100</span></span>
        </span>
      </span>
      {e && (
        <span className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <span><span className="block text-xs text-ink-muted">{t("crop.result.cardProfit")}</span>
            <span className={`num block font-bold ${e.net_profit < 0 ? "text-[var(--critical)]" : ""}`}>{compactRupees(e.net_profit)}</span></span>
          <span><span className="block text-xs text-ink-muted">{t("crop.result.cardReturn")}</span><span className="num block font-bold">{pct(e.roi_pct, 0)}</span></span>
          <span><span className="block text-xs text-ink-muted">{t("crop.result.cardPrice")}</span><span className="num block font-bold">{rupees(e.selling_price)}</span></span>
        </span>
      )}
      <span className="mt-3 grid gap-2">
        <ScoreBar label={t("crop.result.barMatch")} value={r.agronomic_score} />
        <ScoreBar label={t("crop.result.barTiming")} value={r.timing_score} />
        <ScoreBar label={t("crop.result.barProfit")} value={r.profit_score} />
      </span>
    </button>
  );
}

function Economics({ e }) {
  const t = useT();
  const rows = [
    [t("crop.econ.yield"), t("crop.econ.yieldValue", { q: e.effective_yield_q, perAcre: e.yield_q_per_acre })],
    [t("crop.econ.revenue"), rupees(e.gross_revenue)],
    [t("crop.econ.cultivation"), `− ${rupees(e.cultivation_cost)}`],
    [t("crop.econ.marketing"), `− ${rupees(e.marketing_cost)}`],
    ...(e.storage_cost ? [[t("crop.econ.storage"), `− ${rupees(e.storage_cost)}`]] : []),
    [t("crop.econ.net"), signedRupees(e.net_profit)],
  ];
  return (
    <dl className="kv">
      {rows.map(([k, v], i) => (
        <Fragment key={k}><dt>{k}</dt><dd className={`num ${i === rows.length - 1 ? "font-bold" : ""}`}>{v}</dd></Fragment>
      ))}
    </dl>
  );
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
  const current = useMemo(() => results && (results.find((r) => r.crop_name === selected) || results[0]), [results, selected]);

  const backLinks = (
    <div className="row">
      {id && <Link to="/history" className="btn btn-secondary"><History size={16} aria-hidden="true" />{tr("common.backToHistory")}</Link>}
      <Link to="/crop-recommendation" className="btn btn-secondary">{tr("crop.result.newAnalysis")}</Link>
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
  if (!data || !results?.[0]?.timeline) { // nothing yet, or an old-format session result
    return <EmptyState icon={Sprout} title={tr("crop.result.emptyTitle")}
      action={<Link className="btn btn-primary" to="/crop-recommendation">{tr("crop.result.emptyAction")}</Link>} />;
  }

  const top3 = results.filter((r) => r.recommended);
  const best = top3[0];
  const e = current.economics;
  const m = current.market;
  const currentName = cropName(tr, current.crop_name);
  // general checks for the farmer to make — fixed text, not produced by the model
  const checks = ["season", "water", "local", "market"];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{tr("crop.result.title")}</h1>
          <p className="meta-line"><span className="inline-icon"><MapPin size={15} aria-hidden="true" />{cropName(tr, response.city, "city")}, {cropName(tr, response.state, "state")}</span>
            <span className="inline-icon"><Sprout size={15} aria-hidden="true" />{tr("crop.result.plantSell", { plant: monthLabel(response.planting_date), sell: monthLabel(response.selling_date) })}</span>
            {" "}{tr(response.area_acres === 1 ? "crop.result.monthsAcre" : "crop.result.monthsAcres", { months: response.growing_months, acres: response.area_acres })}
            {data.fromHistory && <> · {tr("crop.result.savedOn", { date: fmtDateTime(data.createdAt) })}</>}</p>
        </div>
        {backLinks}
      </div>

      {response.warnings.length > 0 && (
        <div className="stack mb-4">{response.warnings.map((w) => <Alert key={w} type="warn"><ServerText>{w}</ServerText></Alert>)}</div>
      )}

      <ResultStep n={1} id="step-best" title={tr("crop.result.recommendedTitle")} className="best-step">
        {best ? (
          <div className="best-crop">
            <CropArt crop={best.crop_name} size={132} className="best-crop-art" />
            <div className="min-w-0">
              <span className="best-ribbon static"><Star size={13} fill="currentColor" aria-hidden="true" />{tr("crop.result.bestBadge")}</span>
              <p className="best-crop-name">{cropName(tr, best.crop_name)}</p>
              <p className="lead-line !mb-1">{tr("crop.result.lead", { crop: cropName(tr, best.crop_name), score: Math.round(best.recommendation_score) })}</p>
              <ServerText as="p" className="text-2 !mb-1">{best.summary}</ServerText>
              <p className="muted small !mb-0">{tr("crop.result.estimateNote")}</p>
            </div>
          </div>
        ) : <Alert type="info">{tr("crop.result.noneRecommended")}</Alert>}
      </ResultStep>

      <Tip id="crop-result" className="mt-4">{tr("tip.cropResult")}</Tip>

      <div className="crop-picker card">
        <p className="small text-2 !mb-2">{tr("crop.steps.pickerNote")}</p>
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={tr("crop.result.pickCropAria")}>
          {results.map((r) => (
            <button key={r.crop_name} type="button" role="tab" aria-selected={current.crop_name === r.crop_name}
              onClick={() => setSelected(r.crop_name)}
              className={`crop-pill ${current.crop_name === r.crop_name ? "is-active" : ""}`}>
              <CropArt crop={r.crop_name} size={26} decorative />{cropName(tr, r.crop_name)}
              {r.recommended && <Star size={13} fill="currentColor" aria-label={tr("crop.profitChart.recommended")} />}
            </button>
          ))}
        </div>
      </div>

      <ResultStep n={2} id="step-why" title={tr("crop.why.title", { crop: currentName })} icon={CircleHelp} className="reveal">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className="!m-0 inline-icon detail-title"><CropArt crop={current.crop_name} size={40} decorative />{tr("crop.result.detailTitle", { crop: currentName, rank: current.rank })}</h3>
          <span className={`badge ${current.recommended ? "badge-brand" : current.feasible ? "" : "badge-down"}`}>
            {current.recommended ? <><Star size={13} fill="currentColor" aria-hidden="true" />{tr("crop.result.badgeRecommended")}</>
              : !current.feasible ? tr("crop.result.badgeNotSellable")
                : current.low_agronomic_suitability ? tr("crop.result.badgePoorMatch") : tr("crop.result.badgeNotTop")}
          </span>
        </div>
        <ServerText as="p" className="text-ink-2">{current.summary}</ServerText>
        <WhyPanel result={current} />
      </ResultStep>

      <ResultStep n={3} id="step-score" title={tr("crop.steps.score")} icon={Gauge}>
        <div className="score-step">
          <div className="score-big">
            <span className="num">{Math.round(current.recommendation_score)}</span><span className="muted">/100</span>
            <span className="small text-2 block">{tr("crop.result.overallScore")} · {currentName}</span>
          </div>
          <div className="grid gap-2 flex-1 min-w-0">
            <ScoreBar label={tr("crop.result.barMatch")} value={current.agronomic_score} />
            <ScoreBar label={tr("crop.result.barTiming")} value={current.timing_score} />
            <ScoreBar label={tr("crop.result.barProfit")} value={current.profit_score} />
          </div>
        </div>
        <div className="understand-box mt-3">
          <p className="section-title !mb-1"><Lightbulb size={18} aria-hidden="true" />{tr("crop.steps.scoreMeaning")}</p>
          <ul className="list !mb-0">
            <li>{tr("crop.understand.score", {
              agronomic: Math.round(response.weights.agronomic * 100), timing: Math.round(response.weights.timing * 100),
              profit: Math.round(response.weights.profit * 100),
            })}</li>
            <li>{tr("crop.understand.rule")}</li>
          </ul>
        </div>
      </ResultStep>

      <ResultStep n={4} id="step-compare" title={tr("crop.steps.compare")} icon={Scale} className="reveal">
        {top3.length > 0 && (
          <div className={`grid gap-4 mb-4 ${GRID_COLS[top3.length] || ""}`}>
            {top3.map((r, i) => <TopCard key={r.crop_name} r={r} best={i === 0} active={current.crop_name === r.crop_name} onClick={() => setSelected(r.crop_name)} />)}
          </div>
        )}
        <ChartIntro icon={IndianRupee} title={tr("crop.profitChart.title", { month: monthLabel(response.selling_date) })}>
          {tr("crop.profitChart.desc", { n: results.length, area: response.area_acres })}
        </ChartIntro>
        <ProfitComparisonChart results={results} selected={current.crop_name} onSelect={setSelected} />
      </ResultStep>

      <ResultStep n={5} id="step-money" title={tr("crop.steps.money", { crop: currentName })} icon={ReceiptText}>
        {e && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label={tr("crop.result.kpiPrice", { month: monthLabel(response.selling_date) })}
              value={`${rupees(e.selling_price)}`} sub={tr("crop.result.kpiPriceSub", { low: rupees(e.price_low), high: rupees(e.price_high) })} />
            <Kpi label={tr("crop.result.kpiProfit")} value={signedRupees(e.net_profit)} tone={e.net_profit < 0 ? "neg" : "pos"}
              sub={tr("crop.result.kpiProfitSub", { low: compactRupees(e.net_profit_low), high: compactRupees(e.net_profit_high) })} />
            <Kpi label={tr("crop.result.kpiReturn")} value={pct(e.roi_pct, 0)} sub={tr("crop.result.kpiReturnSub", { cost: compactRupees(e.total_cost) })} />
            <Kpi label={tr("crop.result.kpiBreakEven")} value={`${rupees(e.break_even_price)}`}
              sub={m ? tr("crop.result.kpiBreakEvenSub", { price: rupees(m.latest_price), month: monthLabel(m.latest_month) }) : null} />
          </div>
        )}
        {e && <p className="muted small !mb-0 !mt-2">{tr("crop.result.kpiNote")}</p>}

        <div className="mt-5 grid gap-5 xl:grid-cols-5">
          <div className="xl:col-span-3">
            <ChartIntro icon={ChartLine} title={tr("crop.priceChart.title", { crop: currentName })}>
              {m && tr("crop.priceChart.desc", { dataEnd: monthLabel(m.latest_month) })}
            </ChartIntro>
            {m ? (
              <>
                <ServerText as="p" className="text-sm text-ink-2">{m.explanation.headline}</ServerText>
                {m.series_note && <ServerText as="p" className="muted small">{m.series_note}</ServerText>}
                <MonthlyPriceChart market={m} sellingMonth={response.selling_date} optimalMonth={current.timeline.optimal_selling} />
              </>
            ) : <Alert type="info">{tr("crop.result.noPrice")}</Alert>}
          </div>
          <div className="xl:col-span-2">
            <h3 className="section-title"><ReceiptText size={18} aria-hidden="true" />{tr("crop.econ.title")}</h3>
            {e ? <Economics e={e} /> : <p className="muted">{tr("crop.econ.none")}</p>}
            <p className="muted small mt-2">{tr("crop.econ.note")}</p>
            <p className="muted small">{tr("crop.understand.estimates")}</p>
          </div>
        </div>
      </ResultStep>

      <ResultStep n={6} id="step-checks" title={tr("crop.steps.checks")} icon={ClipboardCheck}>
        <p className="checks-label"><Info size={16} aria-hidden="true" />{tr("crop.steps.checksLabel")}</p>
        <ul className="check-list">
          {checks.map((k) => (
            <li key={k}><CircleCheck size={17} aria-hidden="true" />
              <span><strong>{tr(`crop.check.${k}Title`)}</strong> — {tr(`crop.check.${k}`, { crop: currentName })}</span></li>
          ))}
        </ul>
        {current.limitations.length > 0 && (
          <div className="mt-3"><Alert type="warn" title={tr("crop.steps.flagged", { crop: currentName })}>
            <ul className="list !mt-1">{current.limitations.map((s) => <li key={s}><ServerText>{s}</ServerText></li>)}</ul></Alert></div>
        )}
        <div className="mt-5">
          <ChartIntro icon={CalendarDays} title={tr("timeline.title")}>{tr("timeline.desc")}</ChartIntro>
          <CropTimeline timeline={current.timeline} crop={currentName} />
        </div>
      </ResultStep>

      <ResultStep n={7} id="step-advanced" title={tr("crop.steps.advanced")}>
        <p className="small text-2">{tr("crop.steps.advancedHint")}</p>
        <TechnicalDetails title={tr("crop.steps.advancedToggle")}>
          <dl className="kv">
            <dt>{tr("crop.understand.inputs")}</dt>
            <dd>{tr("crop.understand.inputsValue", {
              n: data.req.nitrogen, p: data.req.phosphorus, k: data.req.potassium, ph: data.req.ph,
              temp: data.req.temperature, humidity: data.req.humidity, rain: data.req.rainfall,
            })}</dd>
            <dt>{tr("crop.understand.priceData")}</dt>
            <dd>{tr("crop.understand.priceDataValue", {
              dataEnd: monthLabel(response.model.price.data_end), inflation: response.model.price.inflation_annual_pct,
            })}</dd>
          </dl>
          <ul className="list small text-2 mt-3">{response.notes.map((n) => <li key={n}><ServerText>{n}</ServerText></li>)}</ul>
          <h3 className="tech-subtitle mt-3">{tr("crop.understand.techTitle")}</h3>
          <p className="text-2">
            Overall = {Math.round(response.weights.agronomic * 100)}% soil, weather &amp; timing fit (XGBoost classifier) +{" "}
            {Math.round(response.weights.timing * 100)}% timing feasibility (crop cycle &amp; storage) +{" "}
            {Math.round(response.weights.profit * 100)}% expected profit (XGBoost monthly price forecast × yield − costs).
            A crop is only recommended if the model rates it at least a 5% match and it can be sold in your chosen month.
          </p>
          <WhyTechnical result={current} />
        </TechnicalDetails>
      </ResultStep>
    </>
  );
}
