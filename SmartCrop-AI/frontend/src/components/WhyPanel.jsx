import { useState } from "react";
import DivergingBarChart from "./charts/DivergingBarChart";
import ServerText from "./ServerText";
import TechnicalDetails from "./TechnicalDetails";
import { useT } from "../i18n/LanguageContext";
import { cropName } from "../utils/format";

/** Translated label for a backend key, or the backend's own English label when the dictionary has none. */
const labelFor = (t, key, fallback) => { const v = t(key); return v === key ? fallback : v; };

/** The SHAP charts and tables behind the explanation. `bare` skips the collapsible wrapper (already inside one). */
export function WhyTechnical({ result, title, bare = false }) {
  const t = useT();
  const [tab, setTab] = useState("suitability");
  const crop = cropName(t, result.crop_name);
  const exp = result.market?.explanation;
  const Wrap = bare ? "div" : TechnicalDetails;
  return (
    <Wrap {...(bare ? {} : { title: title || t("tech.factorsTitle") })}>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "suitability"} className={tab === "suitability" ? "active" : ""}
          onClick={() => setTab("suitability")}>{t("why.tech.suitabilityTab")}</button>
        {exp && (
          <button role="tab" aria-selected={tab === "price"} className={tab === "price" ? "active" : ""}
            onClick={() => setTab("price")}>{t("why.tech.priceTab")}</button>
        )}
      </div>

      {tab === "suitability" && (
        <>
          <DivergingBarChart
            items={result.important_factors.map((f) => ({ ...f, display: `${labelFor(t, `feature.${f.feature}`, f.label)}: ${f.value}` }))}
            valueKey="share_pct" labelKey="display" labelWidth={200}
            format={(v) => `${v > 0 ? "+" : ""}${Math.round(v)}%`}
            posLabel={t("why.tech.posSuitability", { crop })} negLabel={t("why.tech.negSuitability", { crop })}
            tooltip={(d) => (<>
              <strong>{d.label}: {d.value}</strong>
              {d.typical_low != null && <div>{t("why.typicalRange", { crop, low: d.typical_low, high: d.typical_high, unit: d.unit ? ` ${d.unit}` : "" })}</div>}
              <div className="mt-1">{d.text}</div>
              <div className="muted small">SHAP {d.shap_value > 0 ? "+" : ""}{d.shap_value.toFixed(3)} log-odds · {t("why.tech.shareOfReasoning", { pct: d.share_pct })}</div>
            </>)} />
          <p className="muted small">{t("why.tech.suitabilityNote", { crop })}</p>
        </>
      )}

      {tab === "price" && exp && (
        <>
          <DivergingBarChart
            items={exp.factors.map((f) => ({ ...f, label: labelFor(t, `monthly.factor.${f.factor}`, f.label) }))} valueKey="effect_pct" labelKey="label" labelWidth={190}
            format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(0)}%`}
            posLabel={t("why.tech.posPrice")} negLabel={t("why.tech.negPrice")}
            tooltip={(d) => (<><strong>{d.label}</strong><div className="mt-1">{d.text}</div>
              <div className="muted small">SHAP {d.shap_value > 0 ? "+" : ""}{d.shap_value.toFixed(3)} (log price change)</div></>)} />
          <p className="muted small">{t("why.tech.priceNote", { crop, inflation: result.market.inflation_effect_pct })}</p>
          <ul className="list small text-2">{exp.caveats.map((c) => <li key={c}><ServerText>{c}</ServerText></li>)}</ul>
          <div className="table-wrap mt-2">
            <table>
              <thead><tr><th>{t("table.feature")}</th><th className="num">{t("table.value")}</th><th className="num">SHAP</th></tr></thead>
              <tbody>
                {exp.technical.map((r) => (
                  <tr key={r.feature}><td>{r.label}</td><td className="num">{r.value ?? "—"}</td>
                    <td className="num">{r.shap_value > 0 ? "+" : ""}{r.shap_value.toFixed(4)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small mt-1">Base value {exp.base_value} + Σ SHAP + inflation {exp.inflation_log} = log(projected / latest price).</p>
        </>
      )}
    </Wrap>
  );
}
