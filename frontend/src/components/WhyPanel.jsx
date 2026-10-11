import { useState } from "react";
import { ArrowDown, ArrowUp, CalendarDays, ChartLine, CloudSun, Sprout } from "lucide-react";
import DivergingBarChart from "./charts/DivergingBarChart";

const PILLAR_ICON = { weather: CloudSun, soil: Sprout, timing: CalendarDays, market: ChartLine };

function Pillar({ p }) {
  const good = p.direction === "supports";
  const Icon = PILLAR_ICON[p.key] || Sprout;
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="!m-0 flex items-center gap-2 text-[0.98rem]">
          <Icon size={18} className="text-brand" aria-hidden="true" />{p.title}
        </h4>
        <span className={`badge ${good ? "badge-up" : "badge-down"}`}>
          {good ? <><ArrowUp size={13} aria-hidden="true" />Supports</> : <><ArrowDown size={13} aria-hidden="true" />Against</>}{p.share_pct != null && ` · ${p.share_pct > 0 ? "+" : ""}${p.share_pct}%`}
        </span>
      </div>
      <ul className="list small text-2">{p.points.map((t) => <li key={t}>{t}</li>)}</ul>
    </div>
  );
}

/**
 * "Why this recommendation?" — plain-language pillars (weather, soil, timing, market) backed
 * by SHAP, plus the two SHAP charts: crop suitability factors and price-forecast factors.
 */
export default function WhyPanel({ result }) {
  const [tab, setTab] = useState("suitability");
  const crop = result.crop_name;
  const exp = result.market?.explanation;
  return (
    <div>
      <div className="grid gap-3 md:grid-cols-2">
        {result.why.map((p) => <Pillar key={p.key} p={p} />)}
      </div>

      <div className="mt-5">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "suitability"} className={tab === "suitability" ? "active" : ""}
            onClick={() => setTab("suitability")}>Suitability factors (SHAP)</button>
          {exp && (
            <button role="tab" aria-selected={tab === "price"} className={tab === "price" ? "active" : ""}
              onClick={() => setTab("price")}>Price forecast factors (SHAP)</button>
          )}
        </div>

        {tab === "suitability" && (
          <>
            <DivergingBarChart
              items={result.important_factors.map((f) => ({ ...f, display: `${f.label}: ${f.value}` }))}
              valueKey="share_pct" labelKey="display" labelWidth={200}
              format={(v) => `${v > 0 ? "+" : ""}${Math.round(v)}%`}
              posLabel={`Makes ${crop} more suitable`} negLabel={`Makes ${crop} less suitable`}
              tooltip={(d) => (<>
                <strong>{d.label}: {d.value}</strong>
                {d.typical_low != null && <div>Typical for {crop}: {d.typical_low}–{d.typical_high}{d.unit ? ` ${d.unit}` : ""}</div>}
                <div className="mt-1">{d.text}</div>
                <div className="muted small">SHAP {d.shap_value > 0 ? "+" : ""}{d.shap_value.toFixed(3)} log-odds · {d.share_pct}% of the model's reasoning</div>
              </>)} />
            <p className="muted small">Each bar is that input's SHAP contribution to the model's {crop} score, shown as a share of
              all contributions. Groups: soil, weather, timing, location.</p>
          </>
        )}

        {tab === "price" && exp && (
          <>
            <DivergingBarChart
              items={exp.factors} valueKey="effect_pct" labelKey="label" labelWidth={190}
              format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(0)}%`}
              posLabel="Pushes price up" negLabel="Pulls price down"
              tooltip={(d) => (<><strong>{d.label}</strong><div className="mt-1">{d.text}</div>
                <div className="muted small">SHAP {d.shap_value > 0 ? "+" : ""}{d.shap_value.toFixed(3)} (log price change)</div></>)} />
            <p className="muted small">Effect of each factor on the projected {crop} price for your selling month, relative to
              the latest mandi price. Inflation (+{result.market.inflation_effect_pct}%) is added separately.</p>
            <ul className="list small text-2">{exp.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
            <details className="mt-2">
              <summary>Technical SHAP table</summary>
              <div className="table-wrap mt-2">
                <table>
                  <thead><tr><th>Feature</th><th className="num">Value</th><th className="num">SHAP</th></tr></thead>
                  <tbody>
                    {exp.technical.map((t) => (
                      <tr key={t.feature}><td>{t.label}</td><td className="num">{t.value ?? "—"}</td>
                        <td className="num">{t.shap_value > 0 ? "+" : ""}{t.shap_value.toFixed(4)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small mt-1">Base value {exp.base_value} + Σ SHAP + inflation {exp.inflation_log} = log(projected / latest price).</p>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
