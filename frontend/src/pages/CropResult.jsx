import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import {
  CalendarDays, ChartLine, CircleHelp, IndianRupee, MapPin, ReceiptText, Sprout, Star,
} from "lucide-react";
import Alert from "../components/Alert";
import CropTimeline from "../components/CropTimeline";
import EmptyState from "../components/EmptyState";
import Loader from "../components/Loader";
import ScoreBar from "../components/ScoreBar";
import WhyPanel from "../components/WhyPanel";
import MonthlyPriceChart from "../components/charts/MonthlyPriceChart";
import ProfitComparisonChart from "../components/charts/ProfitComparisonChart";
import { errorMessage } from "../services/api";
import { cropService } from "../services/cropService";
import { historyService } from "../services/historyService";
import { compactRupees, fmtDateTime, monthLabel, pct, rupees, signedRupees, titleCase } from "../utils/format";
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
      <div className={`num text-xl font-bold ${tone === "neg" ? "text-[var(--critical)]" : "text-ink"}`}>{value}</div>
      {sub && <div className="text-xs text-ink-muted">{sub}</div>}
    </div>
  );
}

function TopCard({ r, active, onClick }) {
  const e = r.economics;
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`card !mt-0 w-full cursor-pointer text-left transition hover:border-brand ${active ? "!border-brand ring-2 ring-brand/30" : ""}`}>
      <div className="flex items-start gap-3">
        <span className="rank-pill" aria-label={`Rank ${r.rank}`}>#{r.rank}</span>
        <div className="min-w-0 flex-1">
          <h2 className="!m-0 truncate">{r.crop_name}</h2>
          <p className="!mb-0 !mt-1 text-sm text-ink-2">{r.summary}</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-ink-muted">Score</div>
          <div className="num text-2xl font-bold">{Math.round(r.recommendation_score)}</div>
        </div>
      </div>
      {e && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <div><div className="text-xs text-ink-muted">Net profit</div>
            <div className={`num font-bold ${e.net_profit < 0 ? "text-[var(--critical)]" : ""}`}>{compactRupees(e.net_profit)}</div></div>
          <div><div className="text-xs text-ink-muted">ROI</div><div className="num font-bold">{pct(e.roi_pct, 0)}</div></div>
          <div><div className="text-xs text-ink-muted">Sell price</div><div className="num font-bold">{rupees(e.selling_price)}/q</div></div>
        </div>
      )}
      <div className="mt-3 grid gap-2">
        <ScoreBar label="Soil & weather fit" value={r.agronomic_score} />
        <ScoreBar label="Timing" value={r.timing_score} />
        <ScoreBar label="Profit" value={r.profit_score} />
      </div>
    </button>
  );
}

function Economics({ e }) {
  const rows = [
    ["Effective yield", `${e.effective_yield_q} quintal (${e.yield_q_per_acre} q/acre before losses)`],
    ["Gross revenue", rupees(e.gross_revenue)],
    ["Cultivation cost", `− ${rupees(e.cultivation_cost)}`],
    ["Marketing (commission, transport)", `− ${rupees(e.marketing_cost)}`],
    ...(e.storage_cost ? [["Storage", `− ${rupees(e.storage_cost)}`]] : []),
    ["Net profit", signedRupees(e.net_profit)],
  ];
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <Fragment key={k}><dt>{k}</dt><dd className={`num ${k === "Net profit" ? "font-bold" : ""}`}>{v}</dd></Fragment>
      ))}
    </dl>
  );
}

export default function CropResult() {
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

  if (error) return <Alert type="error">{error}</Alert>;
  if (!data && id) return <Loader label="Re-running the analysis…" />;
  if (data?.legacy) {
    return (
      <>
        <div className="page-header"><div><h1>Saved recommendation</h1><p>Saved {fmtDateTime(data.legacy.created_at)}</p></div>
          <Link to="/crop-recommendation" className="btn btn-primary">New recommendation</Link></div>
        <Alert type="info">This record was made with the earlier 22-crop model and has no city or selling month, so the
          new dashboard cannot be rebuilt. Top crops then: {data.legacy.results.map((r) => titleCase(r.crop_name)).join(", ")}.</Alert>
      </>
    );
  }
  if (!data || !results?.[0]?.timeline) { // nothing yet, or an old-format session result
    return <EmptyState icon={Sprout} title="No recommendation to show"
      action={<Link className="btn btn-primary" to="/crop-recommendation">Get a recommendation</Link>} />;
  }

  const top3 = results.filter((r) => r.recommended);
  const e = current.economics;
  const m = current.market;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Your crop plan</h1>
          <p className="meta-line"><span className="inline-icon"><MapPin size={15} aria-hidden="true" />{response.city}, {response.state}</span>
            <span className="inline-icon"><Sprout size={15} aria-hidden="true" />Plant {monthLabel(response.planting_date)} → sell {monthLabel(response.selling_date)}</span>
            {" "}({response.growing_months} months) · {response.area_acres} acre{response.area_acres !== 1 ? "s" : ""}
            {data.fromHistory && <> · saved {fmtDateTime(data.createdAt)}</>}</p>
        </div>
        <Link to="/crop-recommendation" className="btn btn-secondary">New analysis</Link>
      </div>

      {response.warnings.length > 0 && (
        <div className="stack mb-4">{response.warnings.map((w) => <Alert key={w} type="warn">{w}</Alert>)}</div>
      )}

      {top3.length > 0 && (
        <section className="mb-4">
          <h2 className="mb-2">Recommended for you</h2>
          <div className={`grid gap-4 ${GRID_COLS[top3.length] || ""}`}>
            {top3.map((r) => <TopCard key={r.crop_name} r={r} active={current.crop_name === r.crop_name} onClick={() => setSelected(r.crop_name)} />)}
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-title">
          <h2 className="section-title"><IndianRupee size={20} aria-hidden="true" />Profit &amp; revenue — all 7 crops in {monthLabel(response.selling_date)}</h2>
          <span className="muted small">Click a crop to see its details</span>
        </div>
        <ProfitComparisonChart results={results} selected={current.crop_name} onSelect={setSelected} />
      </section>

      <section className="card">
        <div className="mb-3 flex flex-wrap items-center gap-2" role="tablist" aria-label="Crop details">
          {results.map((r) => (
            <button key={r.crop_name} type="button" role="tab" aria-selected={current.crop_name === r.crop_name}
              onClick={() => setSelected(r.crop_name)}
              className={`rounded-full border px-3 py-1 text-sm font-semibold ${current.crop_name === r.crop_name ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink-2 hover:bg-brand-soft"}`}>
              <span className="inline-icon">{r.crop_name}{r.recommended && <Star size={13} fill="currentColor" aria-label="recommended" />}</span>
            </button>
          ))}
        </div>

        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="!m-0">{current.crop_name} — rank #{current.rank}</h2>
          <span className={`badge ${current.recommended ? "badge-brand" : current.feasible ? "" : "badge-down"}`}>
            {current.recommended ? <><Star size={13} fill="currentColor" aria-hidden="true" />Recommended</> : !current.feasible ? "Not sellable in this month" : current.low_agronomic_suitability ? "Poor soil/weather match" : "Not in top 3"}
          </span>
        </div>

        {e && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label={`Projected price · ${monthLabel(response.selling_date)}`} value={`${rupees(e.selling_price)}/q`}
              sub={`Likely ${rupees(e.price_low)} – ${rupees(e.price_high)}`} />
            <Kpi label="Expected net profit" value={signedRupees(e.net_profit)} tone={e.net_profit < 0 ? "neg" : null}
              sub={`Range ${compactRupees(e.net_profit_low)} to ${compactRupees(e.net_profit_high)}`} />
            <Kpi label="Return on cost" value={pct(e.roi_pct, 0)} sub={`Total cost ${compactRupees(e.total_cost)}`} />
            <Kpi label="Break-even price" value={`${rupees(e.break_even_price)}/q`}
              sub={m ? `Latest mandi: ${rupees(m.latest_price)} (${monthLabel(m.latest_month)})` : null} />
          </div>
        )}

        {current.limitations.length > 0 && (
          <div className="mt-3"><Alert type="warn" title="Things to watch">
            <ul className="list !mt-1">{current.limitations.map((t) => <li key={t}>{t}</li>)}</ul></Alert></div>
        )}

        <div className="mt-5 grid gap-5 xl:grid-cols-5">
          <div className="xl:col-span-3">
            <h3 className="section-title"><ChartLine size={18} aria-hidden="true" />Price trend &amp; projection</h3>
            {m ? (
              <>
                <p className="text-sm text-ink-2">{m.explanation.headline}</p>
                {m.series_note && <p className="muted small">{m.series_note}</p>}
                <MonthlyPriceChart market={m} sellingMonth={response.selling_date} optimalMonth={current.timeline.optimal_selling} />
              </>
            ) : <Alert type="info">Price forecast unavailable for this crop.</Alert>}
          </div>
          <div className="xl:col-span-2">
            <h3 className="section-title"><ReceiptText size={18} aria-hidden="true" />Profit / loss breakdown</h3>
            {e ? <Economics e={e} /> : <p className="muted">No economics available.</p>}
            <p className="muted small mt-2">Yield and cost per acre are approximate Maharashtra reference figures, adjusted for
              inflation. Replace them with your own numbers for a precise budget.</p>
          </div>
        </div>

        <div className="mt-6">
          <h3 className="section-title"><CalendarDays size={18} aria-hidden="true" />Growth &amp; timing</h3>
          <CropTimeline timeline={current.timeline} crop={current.crop_name} />
        </div>
      </section>

      <section className="card">
        <h2 className="section-title"><CircleHelp size={20} aria-hidden="true" />Why this recommendation? — {current.crop_name}</h2>
        <p className="text-ink-2">{current.summary}</p>
        <WhyPanel result={current} />
      </section>

      <section className="card">
        <h2>How the score is calculated</h2>
        <p className="text-2">
          Overall = {Math.round(response.weights.agronomic * 100)}% soil, weather &amp; timing fit (XGBoost classifier) +{" "}
          {Math.round(response.weights.timing * 100)}% timing feasibility (crop cycle &amp; storage) +{" "}
          {Math.round(response.weights.profit * 100)}% expected profit (XGBoost monthly price forecast × yield − costs).
          A crop is only recommended if the model rates it at least a 5% match and it can be sold in your chosen month.
        </p>
        <dl className="kv">
          <dt>Your inputs</dt>
          <dd>N {data.req.nitrogen}, P {data.req.phosphorus}, K {data.req.potassium}, pH {data.req.ph}, {data.req.temperature} °C,
            {" "}{data.req.humidity}% humidity, {data.req.rainfall} mm rain</dd>
          <dt>Price data</dt>
          <dd>Mandi prices up to {monthLabel(response.model.price.data_end)}; later months are projections with
            {" "}{response.model.price.inflation_annual_pct}%/year inflation assumed.</dd>
        </dl>
        <ul className="list small text-2 mt-3">{response.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      </section>
    </>
  );
}
