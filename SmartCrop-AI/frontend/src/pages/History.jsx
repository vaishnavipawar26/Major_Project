import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChartNoAxesCombined, ExternalLink, Sprout, Trash2 } from "lucide-react";
import Alert from "../components/Alert";
import CropArt from "../components/CropArt";
import DirectionBadge from "../components/DirectionBadge";
import EmptyState from "../components/EmptyState";
import Loader from "../components/Loader";
import ServerText from "../components/ServerText";
import Tip from "../components/Tip";
import { useAsync } from "../hooks/useAsync";
import { useT } from "../i18n/LanguageContext";
import { errorMessage } from "../services/api";
import { historyService } from "../services/historyService";
import { addDays, compactRupees, cropName, fmtDate, fmtDateTime, monthShort, rupees, titleCase, topCrops } from "../utils/format";
import { isAboutSame, isContextOnly, latestText } from "../utils/priceView";

const PAGE = 10;

function Pager({ total, offset, onChange }) {
  const t = useT();
  if (total <= PAGE) return null;
  return (
    <div className="row" style={{ justifyContent: "space-between", marginTop: "0.75rem" }}>
      <span className="muted small">{t("hist.showing", { from: offset + 1, to: Math.min(offset + PAGE, total), total })}</span>
      <div className="row">
        <button className="btn btn-secondary" disabled={offset === 0} onClick={() => onChange(offset - PAGE)}>{t("hist.previous")}</button>
        <button className="btn btn-secondary" disabled={offset + PAGE >= total} onClick={() => onChange(offset + PAGE)}>{t("hist.next")}</button>
      </div>
    </div>
  );
}

function DeleteButton({ onDelete }) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return <button className="btn btn-ghost-danger" onClick={() => setConfirming(true)}><Trash2 size={15} aria-hidden="true" />{t("hist.delete")}</button>;
  }
  return (
    <span className="row" style={{ gap: 6 }}>
      <button className="btn btn-danger" onClick={onDelete}>{t("hist.confirmDelete")}</button>
      <button className="btn btn-secondary" onClick={() => setConfirming(false)}>{t("hist.cancel")}</button>
    </span>
  );
}

function PriceHistory({ onChanged }) {
  const t = useT();
  const [offset, setOffset] = useState(0);
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState(null);
  const { data, loading, error, reload } = useAsync(() => historyService.price(PAGE, offset), [offset]);
  const remove = async (id) => {
    setNotice(null);
    try { await historyService.deletePrice(id); reload(); onChanged(); setNotice(t("hist.deleted")); } catch (e) { setActionError(errorMessage(e)); }
  };
  if (loading && !data) return <Loader />;
  if (error) return <Alert type="error" action={<button className="btn btn-secondary" onClick={reload}>{t("common.retry")}</button>}>{error}</Alert>;
  if (!data.total) {
    return (
      <>
        {notice && <Alert type="success">{notice}</Alert>}
        <EmptyState icon={ChartNoAxesCombined} title={t("hist.emptyPriceTitle")}
          action={<Link className="btn btn-primary" to="/price-prediction">{t("hist.emptyPriceAction")}</Link>}>
          {t("hist.emptyPriceBody")}</EmptyState>
      </>
    );
  }
  return (
    <>
      {notice && <div className="mb-3"><Alert type="success">{notice}</Alert></div>}
      {actionError && <div className="mb-3"><Alert type="error">{actionError}</Alert></div>}
      <div className="table-wrap">
        <table className="resp-table">
          <thead>
            <tr><th>{t("hist.col.saved")}</th><th>{t("hist.col.crop")}</th><th>{t("hist.col.market")}</th><th>{t("hist.col.from")}</th>
              <th className="num">{t("hist.col.start")}</th><th className="num">{t("hist.col.expected")}</th><th>{t("hist.col.trend")}</th>
              <th>{t("hist.col.advice")}</th><th><span className="sr-only">{t("hist.col.actions")}</span></th></tr>
          </thead>
          <tbody>
            {data.items.map((p) => (
              <tr key={p.id}>
                <td data-label={t("hist.col.saved")} className="muted small">{fmtDateTime(p.created_at)}</td>
                <td data-label={t("hist.col.crop")} className="resp-title"><div>
                  <Link to={`/price-prediction/result?id=${p.id}`} className="inline-icon font-semibold"><CropArt crop={p.commodity} size={28} decorative />{cropName(t, p.commodity)}</Link>
                  <div className="muted small">{p.variety}</div></div></td>
                <td data-label={t("hist.col.market")}>{p.market === "All markets (state median)" ? t("price.form.allMarkets") : p.market}</td>
                <td data-label={t("hist.col.from")}>{fmtDate(p.forecast_origin_date)}</td>
                <td data-label={t("hist.col.start")} className="num">{rupees(p.current_price)}</td>
                <td data-label={t("hist.col.expected")} className="num">{isContextOnly(p) ? (
                  <div data-testid={`hist-nodir-${p.id}`}><strong>{t("hist.noDirection")}</strong>
                    <div className="muted small">{latestText(t, p.latest_recorded) ?? ""}</div>
                    <div className="muted small">{t("hist.forDate", { date: fmtDate(addDays(p.input_date, p.horizon_days)) })}</div></div>
                ) : isAboutSame(p) ? (
                  <div data-testid={`hist-same-${p.id}`}><strong>{t("hist.aboutSame", { price: rupees(p.verdict.start_price) })}</strong>
                    <div className="muted small">{t("hist.modelEstimate", { price: rupees(p.verdict.model_estimate) })}</div>
                    <div className="muted small">{t("hist.forDate", { date: fmtDate(addDays(p.input_date, p.horizon_days)) })}</div></div>
                ) : (<div><strong>{rupees(p.predicted_price)}</strong>
                  <div className="muted small">{t("hist.forDate", { date: fmtDate(addDays(p.input_date, p.horizon_days)) })}</div></div>)}</td>
                <td data-label={t("hist.col.trend")}>{isContextOnly(p) || isAboutSame(p) ? <span className="muted small">—</span> : <DirectionBadge direction={p.predicted_direction} />}</td>
                <td data-label={t("hist.col.advice")} className="small wrap"><ServerText>{p.sell_hold_suggestion}</ServerText></td>
                <td className="resp-actions">
                  <Link className="btn btn-secondary" to={`/price-prediction/result?id=${p.id}`}><ExternalLink size={15} aria-hidden="true" />{t("hist.open")}</Link>
                  <DeleteButton onDelete={() => remove(p.id)} />
                </td>
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
  const t = useT();
  const [offset, setOffset] = useState(0);
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState(null);
  const { data, loading, error, reload } = useAsync(() => historyService.recommendations(PAGE, offset), [offset]);
  const remove = async (id) => {
    setNotice(null);
    try { await historyService.deleteRecommendation(id); reload(); onChanged(); setNotice(t("hist.deleted")); } catch (e) { setActionError(errorMessage(e)); }
  };
  if (loading && !data) return <Loader />;
  if (error) return <Alert type="error" action={<button className="btn btn-secondary" onClick={reload}>{t("common.retry")}</button>}>{error}</Alert>;
  if (!data.total) {
    return (
      <>
        {notice && <Alert type="success">{notice}</Alert>}
        <EmptyState icon={Sprout} title={t("hist.emptyRecTitle")}
          action={<Link className="btn btn-primary" to="/crop-recommendation">{t("hist.emptyRecAction")}</Link>}>
          {t("hist.emptyRecBody")}</EmptyState>
      </>
    );
  }
  return (
    <>
      {notice && <div className="mb-3"><Alert type="success">{notice}</Alert></div>}
      {actionError && <div className="mb-3"><Alert type="error">{actionError}</Alert></div>}
      <div className="table-wrap">
        <table className="resp-table">
          <thead>
            <tr><th>{t("hist.col.saved")}</th><th>{t("hist.col.place")}</th><th>{t("hist.col.soil")}</th><th>{t("hist.col.weather")}</th>
              <th>{t("hist.col.crops")}</th><th><span className="sr-only">{t("hist.col.actions")}</span></th></tr>
          </thead>
          <tbody>
            {data.items.map((r) => (
              <tr key={r.id}>
                <td data-label={t("hist.col.saved")} className="muted small">{fmtDateTime(r.created_at)}</td>
                <td data-label={t("hist.col.place")} className="resp-title">{r.city ? `${cropName(t, r.city, "city")} · ` : ""}{monthShort(r.month)}
                  {r.selling_month ? ` → ${monthShort(r.selling_month)}` : ` · ${r.season}`}</td>
                <td data-label={t("hist.col.soil")}>{r.nitrogen}-{r.phosphorus}-{r.potassium}, pH {r.ph}</td>
                <td data-label={t("hist.col.weather")} className="small">{r.temperature} °C, {r.humidity}%, {r.rainfall} mm</td>
                <td data-label={t("hist.col.crops")} className="wrap"><Link to={`/crop-recommendation/result?id=${r.id}`} className="font-semibold">
                  {topCrops(r.results).map((x) => `${cropName(t, titleCase(x.crop_name))}${x.expected_profit != null ? ` (${compactRupees(x.expected_profit)})` : ""}`).join(", ") || t("hist.noneSuitable")}
                </Link></td>
                <td className="resp-actions">
                  <Link className="btn btn-secondary" to={`/crop-recommendation/result?id=${r.id}`}><ExternalLink size={15} aria-hidden="true" />{t("hist.open")}</Link>
                  <DeleteButton onDelete={() => remove(r.id)} />
                </td>
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
  const t = useT();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "recommendations" ? "recommendations" : "price";
  // One request for both totals; refreshed after a delete so the counts always match the tables.
  const summary = useAsync(() => historyService.summary(), []);
  const totals = summary.data;
  const count = (n) => (summary.loading && !totals ? "…" : n ?? "—");
  return (
    <>
      <div className="page-header">
        <div><h1>{t("hist.title")}</h1><p>{t("hist.subtitle")}</p></div>
      </div>
      <Tip id="history">{t("hist.savedNote")}</Tip>

      {summary.error && (
        <div className="mb-4">
          <Alert type="error" title={t("hist.totalsError")}
            action={<button className="btn btn-secondary" onClick={summary.reload}>{t("common.retry")}</button>}>{summary.error}</Alert>
        </div>
      )}

      <div className="card reveal">
        <div className="tabs tabs-lg" role="tablist" aria-live="polite">
          <button role="tab" aria-selected={tab === "price"} className={tab === "price" ? "active" : ""} onClick={() => setParams({})}>
            <ChartNoAxesCombined size={17} aria-hidden="true" />{t("hist.tabPrice")}<span className="tab-count">{count(totals?.total_price_predictions)}</span>
          </button>
          <button role="tab" aria-selected={tab === "recommendations"} className={tab === "recommendations" ? "active" : ""}
            onClick={() => setParams({ tab: "recommendations" })}>
            <Sprout size={17} aria-hidden="true" />{t("hist.tabCrop")}<span className="tab-count">{count(totals?.total_crop_recommendations)}</span>
          </button>
        </div>
        {tab === "price" ? <PriceHistory onChanged={summary.reload} /> : <RecommendationHistory onChanged={summary.reload} />}
      </div>
    </>
  );
}
