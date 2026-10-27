import { useT } from "../../i18n/LanguageContext";
import { fmtDate, rupees } from "../../utils/format";
import { aboutPct, fmtPct, fmtShap, splitSteps } from "./factorModel";

const UP = "#2e7d32", DOWN = "#c62828";

/** Plain wording for each factor group when it pushed the model's output up or down. Descriptions only: no numbers. */
const MEANING = {
  season: ["The time of year usually raises prices.", "The time of year usually lowers prices."],
  price_level: ["The current price level supports a higher price.", "The current price level points to a lower price."],
  recent_week: ["Prices in the last few days have been pushing the price up.", "Prices in the last few days have been pushing the price down."],
  recent_month: ["The price change over the last month points upward.", "The price change over the last month points downward."],
  averages: ["The price is above its recent average.", "The price is below its recent average."],
  volatility: ["Recent price swings point to a higher price.", "Recent price swings point to a lower price."],
  arrivals: ["Market supply (arrivals) points to a higher price.", "Market supply (arrivals) points to a lower price."],
  state_market: ["Prices in other Maharashtra markets point upward.", "Prices in other Maharashtra markets point downward."],
  distance: ["The number of days until your selling date points upward.", "The number of days until your selling date points downward."],
  crop_market: ["This crop at this market usually trades a little higher.", "This crop at this market usually trades a little lower."],
};

/** Plain size word for a factor. Fixed bands on the model's own value, used for wording only. */
const sizeKey = (v) => (Math.abs(v) < 0.01 ? "small" : Math.abs(v) < 0.03 ? "moderate" : "strong");

function Row({ s, up }) {
  const t = useT();
  const v = s.log_contribution;
  return (
    <li className={`factor-card xai-card ${up ? "push-up" : "push-down"}`} data-testid={`u-${up ? "up" : "down"}-${s.group}`}
      style={{ borderLeft: `4px solid ${up ? UP : DOWN}` }}>
      <strong className="factor-name">{s.title}</strong>
      <span style={{ float: "right", fontWeight: 600, color: up ? UP : DOWN }}>{t(`ex.size.${sizeKey(v)}`)} ({fmtShap(v)})</span>
      <p className="muted small" style={{ margin: "0.25rem 0 0" }}>{MEANING[s.group]?.[up ? 0 : 1] || s.help}</p>
    </li>
  );
}

/**
 * "Understand Your Crop Price Prediction", kept short for farmers: the predicted price, what pushes it higher, what pushes it lower,
 * and what that means. `exp` is one entry of /api/price-prediction/explain (already checked by explanationOk). The values are the
 * model's own SHAP contributions for this prediction (log of the price ratio, not rupees); the model uses no weather or soil inputs.
 */
export default function UnderstandPrediction({ exp, crop, targetDate }) {
  const t = useT();
  const local = exp.charts.local;
  const { up, down } = splitSteps(local);
  const net = exp.technical.model_output_log - exp.base_value;
  const meaning = [];
  if (up[0]) meaning.push(t("ex.meanUp", { name: up[0].title }));
  if (down[0]) meaning.push(t("ex.meanDown", { name: down[0].title }));
  meaning.push(t(net >= 0 ? "ex.meanNetUp" : "ex.meanNetDown"));
  meaning.push(t("ex.g.check"));

  return (
    <div className="stack" data-testid="understand">
      <section className="card xp-section" aria-labelledby="u-a">
        <h2 id="u-a" className="cr-h2">{t("ex.a.title")}</h2>
        <p style={{ fontSize: "1.8rem", fontWeight: 700, margin: "0 0 0.3rem", color: "var(--brand)" }} data-testid="u-price">
          {rupees(local.forecast_price)} <span className="muted small" style={{ fontWeight: 400 }}>{t("unit.perQuintal")}</span>
        </p>
        <p className="muted small" style={{ margin: 0 }}>{t("ex.a.text", { crop, date: fmtDate(targetDate), pct: fmtPct(aboutPct(net)) })}</p>
      </section>

      <section className="card xp-section" aria-labelledby="u-c">
        <h2 id="u-c" className="cr-h2">{t("ex.c.title")}</h2>
        {up.length ? <ul className="factor-cards">{up.slice(0, 3).map((s) => <Row key={s.group} s={s} up />)}</ul>
          : <p className="muted small" data-testid="u-none-up">{t("ex.c.none")}</p>}
      </section>

      <section className="card xp-section" aria-labelledby="u-d">
        <h2 id="u-d" className="cr-h2">{t("ex.d.title")}</h2>
        {down.length ? <ul className="factor-cards">{down.slice(0, 3).map((s) => <Row key={s.group} s={s} up={false} />)}</ul>
          : <p className="muted small" data-testid="u-none-down">{t("ex.d.none")}</p>}
      </section>

      <section className="card xp-section" aria-labelledby="u-g">
        <h2 id="u-g" className="cr-h2">{t("ex.g.title")}</h2>
        <ul className="xai-limits" data-testid="u-meaning">{meaning.map((m) => <li key={m}>{m}</li>)}</ul>
        <p className="muted small" style={{ margin: "0.4rem 0 0" }} data-testid="u-caution">{t("ex.f.caution", { crop })}</p>
      </section>
    </div>
  );
}
