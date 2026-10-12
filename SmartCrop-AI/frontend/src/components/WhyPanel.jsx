import { useState } from "react";
import { ArrowDown, ArrowUp, BookOpen, CalendarDays, ChartLine, CloudSun, Sprout } from "lucide-react";
import DivergingBarChart from "./charts/DivergingBarChart";
import ServerText from "./ServerText";
import TechnicalDetails from "./TechnicalDetails";
import { useT } from "../i18n/LanguageContext";
import { cropName } from "../utils/format";

const PILLAR_ICON = { weather: CloudSun, soil: Sprout, timing: CalendarDays, market: ChartLine };

/** Translated label for a backend key, or the backend's own English label when the dictionary has none. */
const labelFor = (t, key, fallback) => { const v = t(key); return v === key ? fallback : v; };

function DirectionBadge({ supports, share }) {
  const t = useT();
  return (
    <span className={`badge ${supports ? "badge-up" : "badge-down"}`}>
      {supports ? <><ArrowUp size={13} aria-hidden="true" />{t("why.helps")}</> : <><ArrowDown size={13} aria-hidden="true" />{t("why.against")}</>}
      {share != null && ` · ${share > 0 ? "+" : ""}${share}%`}
    </span>
  );
}

function Pillar({ p }) {
  const t = useT();
  const Icon = PILLAR_ICON[p.key] || Sprout;
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="!m-0 flex items-center gap-2 text-[0.98rem]">
          <Icon size={18} className="text-brand" aria-hidden="true" />{labelFor(t, `why.pillar.${p.key}`, p.title)}
        </h4>
        <DirectionBadge supports={p.direction === "supports"} share={p.share_pct} />
      </div>
      <ul className="list small text-2">{p.points.map((s) => <li key={s}><ServerText>{s}</ServerText></li>)}</ul>
    </div>
  );
}

/**
 * Crop explanation in three layers:
 *  B. why the model suggested this crop — plain-language pillars (weather, soil, timing, market)
 *     and the inputs that mattered most, all taken from the API's SHAP-based explanation;
 *  C. what those inputs mean, in farming terms;
 * The original SHAP charts and table (E) are in `WhyTechnical`, which the result page shows in
 * its collapsed "Advanced explanation" step.
 */
export default function WhyPanel({ result }) {
  const t = useT();
  const crop = cropName(t, result.crop_name);
  const top = [...result.important_factors].sort((a, b) => Math.abs(b.share_pct) - Math.abs(a.share_pct)).slice(0, 3);
  // explain only the inputs listed above, so the glossary stays short
  const glossary = top.map((f) => f.feature).filter((k) => t(`gloss.feature.${k}`) !== `gloss.feature.${k}`);

  return (
    <div className="stack">
      <div>
        <h3 className="!mb-2">{t("why.pillarsTitle")}</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {result.why.map((p) => <Pillar key={p.key} p={p} />)}
        </div>
      </div>

      {top.length > 0 && (
        <div>
          <h3 className="!mb-1">{t("why.topFactorsTitle")}</h3>
          <p className="muted small !mb-2">{t("why.topFactorsIntro", { crop })}</p>
          <ul className="factor-list">
            {top.map((f) => (
              <li key={f.feature}>
                <div className="factor-head">
                  <strong>{labelFor(t, `feature.${f.feature}`, f.label)}: {f.value}</strong>
                  <DirectionBadge supports={f.direction === "supports"} />
                </div>
                <ServerText as="p" className="small !mb-0 !mt-1">{f.text}</ServerText>
              </li>
            ))}
          </ul>
        </div>
      )}

      {glossary.length > 0 && (
        <details className="glossary">
          <summary className="section-title"><BookOpen size={18} aria-hidden="true" />{t("why.glossaryTitle")}</summary>
          <dl>
            {glossary.map((k) => (
              <div key={k}><dt>{t(`feature.${k}`)}</dt><dd>{t(`gloss.feature.${k}`)}</dd></div>
            ))}
            <div><dt>{t("gloss.matchTitle")}</dt><dd>{t("gloss.match")}</dd></div>
          </dl>
        </details>
      )}
    </div>
  );
}

/** The SHAP charts and tables behind the explanation, collapsed by default. */
export function WhyTechnical({ result, title }) {
  const t = useT();
  const [tab, setTab] = useState("suitability");
  const crop = cropName(t, result.crop_name);
  const exp = result.market?.explanation;
  return (
    <TechnicalDetails title={title || t("tech.factorsTitle")}>
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
    </TechnicalDetails>
  );
}
