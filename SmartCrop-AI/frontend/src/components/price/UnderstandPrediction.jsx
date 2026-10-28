import { useT } from "../../i18n/LanguageContext";
import { fmtDate, rupees } from "../../utils/format";
import { aboutPct, fmtPct } from "./factorModel";

/**
 * "Understand Your Crop Price Prediction", kept short for farmers: the predicted price, what pushes it higher, what pushes it lower,
 * and what that means. `exp` is one entry of /api/price-prediction/explain (already checked by explanationOk). The values are the
 * model's own SHAP contributions for this prediction (log of the price ratio, not rupees); the model uses no weather or soil inputs.
 */
export default function UnderstandPrediction({ exp, crop, targetDate, afterA = null }) {
  const t = useT();
  const local = exp.charts.local;
  const net = exp.technical.model_output_log - exp.base_value;

  return (
    <div className="stack" data-testid="understand">
      <section className="card xp-section" aria-labelledby="u-a">
        <h2 id="u-a" className="cr-h2">{t("ex.a.title")}</h2>
        <p style={{ fontSize: "1.8rem", fontWeight: 700, margin: "0 0 0.3rem", color: "var(--brand)" }} data-testid="u-price">
          {rupees(local.forecast_price)} <span className="muted small" style={{ fontWeight: 400 }}>{t("unit.perQuintal")}</span>
        </p>
        <p className="muted small" style={{ margin: 0 }}>{t("ex.a.text", { crop, date: fmtDate(targetDate), pct: fmtPct(aboutPct(net)) })}</p>
      </section>

      {afterA}
    </div>
  );
}
