import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChartNoAxesCombined, Sprout } from "lucide-react";
import Alert from "../components/Alert";
import DirectionBadge from "../components/DirectionBadge";
import EmptyState from "../components/EmptyState";
import Loader from "../components/Loader";
import StatCard from "../components/StatCard";
import { useAsync } from "../hooks/useAsync";
import { errorMessage } from "../services/api";
import { historyService } from "../services/historyService";
import { MONTHS } from "../utils/constants";
import { addDays, compactRupees, fmtDate, fmtDateTime, rupees, titleCase, topCrops } from "../utils/format";

const PAGE = 10;

function Pager({ total, offset, onChange }) {
  if (total <= PAGE) return null;
  return (
    <div className="row" style={{ justifyContent: "space-between", marginTop: "0.75rem" }}>
      <span className="muted small">Showing {offset + 1}–{Math.min(offset + PAGE, total)} of {total}</span>
      <div className="row">
        <button className="btn btn-secondary" disabled={offset === 0} onClick={() => onChange(offset - PAGE)}>Previous</button>
        <button className="btn btn-secondary" disabled={offset + PAGE >= total} onClick={() => onChange(offset + PAGE)}>Next</button>
      </div>
    </div>
  );
}

function DeleteButton({ onDelete }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) return <button className="btn-link small" onClick={() => setConfirming(true)}>Delete</button>;
  return (
    <span className="row" style={{ gap: 4 }}>
      <button className="btn btn-danger small" style={{ padding: "0.2rem 0.5rem" }} onClick={onDelete}>Confirm</button>
      <button className="btn-link small" onClick={() => setConfirming(false)}>Cancel</button>
    </span>
  );
}

function PriceHistory({ onChanged }) {
  const [offset, setOffset] = useState(0);
  const [actionError, setActionError] = useState(null);
  const { data, loading, error, reload } = useAsync(() => historyService.price(PAGE, offset), [offset]);
  const remove = async (id) => {
    try { await historyService.deletePrice(id); reload(); onChanged(); } catch (e) { setActionError(errorMessage(e)); }
  };
  if (loading && !data) return <Loader />;
  if (error) return <Alert type="error">{error}</Alert>;
  if (!data.total) {
    return <EmptyState icon={ChartNoAxesCombined} title="No price predictions yet"
      action={<Link className="btn btn-primary" to="/price-prediction">Predict a price</Link>}>
      Forecasts you make are saved here automatically.</EmptyState>;
  }
  return (
    <>
      {actionError && <Alert type="error">{actionError}</Alert>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Saved</th><th>Crop</th><th>Market</th><th>As of</th><th className="num">Price then</th>
              <th className="num">Forecast</th><th>Trend</th><th>Suggestion</th><th /></tr>
          </thead>
          <tbody>
            {data.items.map((p) => (
              <tr key={p.id}>
                <td className="muted small">{fmtDateTime(p.created_at)}</td>
                <td><Link to={`/price-prediction/result?id=${p.id}`}>{p.commodity}</Link>
                  <div className="muted small">{p.variety}</div></td>
                <td>{p.market}</td>
                <td>{fmtDate(p.forecast_origin_date)}</td>
                <td className="num">{rupees(p.current_price)}</td>
                <td className="num">{rupees(p.predicted_price)}<div className="muted small">for {fmtDate(addDays(p.input_date, p.horizon_days))}</div></td>
                <td><DirectionBadge direction={p.predicted_direction} /></td>
                <td className="small">{p.sell_hold_suggestion}</td>
                <td><DeleteButton onDelete={() => remove(p.id)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager total={data.total} offset={offset} onChange={setOffset} />
    </>
  );
}

function RecommendationHistory({ onChanged }) {
  const [offset, setOffset] = useState(0);
  const [actionError, setActionError] = useState(null);
  const { data, loading, error, reload } = useAsync(() => historyService.recommendations(PAGE, offset), [offset]);
  const remove = async (id) => {
    try { await historyService.deleteRecommendation(id); reload(); onChanged(); } catch (e) { setActionError(errorMessage(e)); }
  };
  if (loading && !data) return <Loader />;
  if (error) return <Alert type="error">{error}</Alert>;
  if (!data.total) {
    return <EmptyState icon={Sprout} title="No recommendations yet"
      action={<Link className="btn btn-primary" to="/crop-recommendation">Find a crop</Link>}>
      Crop recommendations you request are saved here automatically.</EmptyState>;
  }
  return (
    <>
      {actionError && <Alert type="error">{actionError}</Alert>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Saved</th><th>Soil (N-P-K, pH)</th><th>Weather</th><th>City · plant → sell</th>
              <th>Recommended crops (profit)</th><th /></tr>
          </thead>
          <tbody>
            {data.items.map((r) => (
              <tr key={r.id}>
                <td className="muted small">{fmtDateTime(r.created_at)}</td>
                <td>{r.nitrogen}-{r.phosphorus}-{r.potassium}, pH {r.ph}</td>
                <td className="small">{r.temperature} °C, {r.humidity}%, {r.rainfall} mm</td>
                <td>{r.city ? `${r.city} · ` : ""}{MONTHS[r.month - 1].slice(0, 3)}
                  {r.selling_month ? ` → ${MONTHS[r.selling_month - 1].slice(0, 3)}` : ` · ${r.season}`}</td>
                <td><Link to={`/crop-recommendation/result?id=${r.id}`}>
                  {topCrops(r.results).map((x) => `${titleCase(x.crop_name)}${x.expected_profit != null ? ` (${compactRupees(x.expected_profit)})` : ""}`).join(", ") || "None suitable"}
                </Link></td>
                <td><DeleteButton onDelete={() => remove(r.id)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager total={data.total} offset={offset} onChange={setOffset} />
    </>
  );
}

export default function History() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "recommendations" ? "recommendations" : "price";
  // One request for both totals; refreshed after a delete so the counts always match the tables.
  const summary = useAsync(() => historyService.summary(), []);
  const totals = summary.data;
  const countsLoading = summary.loading && !totals;
  return (
    <>
      <div className="page-header">
        <div><h1>History</h1><p>Your saved predictions and recommendations. Only you can see them.</p></div>
      </div>

      {summary.error ? (
        <div className="mb-4">
          <Alert type="error" title="Could not load your totals"
            action={<button className="btn btn-secondary" onClick={summary.reload}>Retry</button>}>{summary.error}</Alert>
        </div>
      ) : (
        <div className="grid grid-2 mb-4" aria-live="polite">
          <StatCard icon={ChartNoAxesCombined} label="Total Price Predictions" loading={countsLoading}
            value={totals?.total_price_predictions} sub="Saved price forecasts" />
          <StatCard icon={Sprout} label="Total Crop Recommendations" loading={countsLoading}
            value={totals?.total_crop_recommendations} sub="Saved crop recommendations" />
        </div>
      )}

      <div className="card">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "price"} className={tab === "price" ? "active" : ""}
            onClick={() => setParams({})}>Price predictions</button>
          <button role="tab" aria-selected={tab === "recommendations"} className={tab === "recommendations" ? "active" : ""}
            onClick={() => setParams({ tab: "recommendations" })}>Crop recommendations</button>
        </div>
        {tab === "price" ? <PriceHistory onChanged={summary.reload} /> : <RecommendationHistory onChanged={summary.reload} />}
      </div>
    </>
  );
}
