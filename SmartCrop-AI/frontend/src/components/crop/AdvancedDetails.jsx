import ServerText from "../ServerText";
import TechnicalDetails from "../TechnicalDetails";
import { WhyTechnical } from "../WhyPanel";
import { useT } from "../../i18n/LanguageContext";
import { cropName, monthLabel } from "../../utils/format";

/** Section 9 - everything technical (inputs, scoring method, metrics, SHAP), collapsed by default. */
export default function AdvancedDetails({ result, response, req }) {
  const t = useT();
  const w = response.weights, pctOf = (x) => Math.round(x * 100);
  const m = result.market;
  const cm = response.model.crop.test_metrics;
  const crop = cropName(t, result.crop_name);
  return (
    <section aria-labelledby="adv-title">
      <h2 id="adv-title" className="sr-only">{t("cr.adv.title")}</h2>
      <TechnicalDetails title={t("cr.adv.title")}>
        <dl className="kv">
          <dt>{t("crop.understand.inputs")}</dt>
          <dd>{t("crop.understand.inputsValue", {
            n: req.nitrogen, p: req.phosphorus, k: req.potassium, ph: req.ph,
            temp: req.temperature, humidity: req.humidity, rain: req.rainfall,
          })}</dd>
          <dt>{t("crop.understand.priceData")}</dt>
          <dd>{t("crop.understand.priceDataValue", { dataEnd: monthLabel(response.model.price.data_end), inflation: response.model.price.inflation_annual_pct })}</dd>
          <dt>{t("cr.adv.models")}</dt>
          <dd>{t("cr.adv.modelsValue", { crop: response.model.crop.algorithm, cropV: response.model.crop.version, price: response.model.price.algorithm, priceV: response.model.price.version })}</dd>
          <dt>{t("cr.adv.metrics")}</dt>
          <dd>{t("cr.adv.metricsValue", { acc: (cm.accuracy * 100).toFixed(1), f1: (cm.f1_macro * 100).toFixed(1), n: cm.n_test })}</dd>
          {m && <>
            <dt>{t("cr.adv.priceTest", { crop })}</dt>
            <dd>{t("cr.adv.priceTestValue", { model: m.reliability.model_mae, naive: m.reliability.naive_mae, verdict: t(m.reliability.beats_baseline ? "cr.adv.better" : "cr.adv.notBetter") })}</dd>
          </>}
        </dl>

        <h3 className="tech-subtitle mt-3">{t("crop.understand.techTitle")}</h3>
        <p className="text-2">{t("cr.adv.formula", { a: pctOf(w.agronomic), tm: pctOf(w.timing), p: pctOf(w.profit) })}</p>
        <p className="text-2">{t("cr.adv.eligibility")}</p>
        <p className="muted small">{t("cr.adv.synthetic")}</p>

        {result.limitations.length > 0 && (
          <>
            <h3 className="tech-subtitle mt-3">{t("cr.adv.flags", { crop })}</h3>
            <ul className="list small text-2">{result.limitations.map((s) => <li key={s}><ServerText>{s}</ServerText></li>)}</ul>
          </>
        )}
        <ul className="list small text-2 mt-3">{response.notes.map((n) => <li key={n}><ServerText>{n}</ServerText></li>)}</ul>

        <div className="mt-3"><WhyTechnical result={result} bare /></div>
      </TechnicalDetails>
    </section>
  );
}
