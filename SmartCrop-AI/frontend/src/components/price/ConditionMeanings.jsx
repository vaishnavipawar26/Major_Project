import { useT } from "../../i18n/LanguageContext";
import { fmtDate } from "../../utils/format";

/** Plain-words bands for the retrieved values. Fixed bands, used only to choose a sentence; they say nothing about price. */
export const tempBand = (c) => (c >= 35 ? "veryHot" : c >= 30 ? "hot" : c >= 22 ? "warm" : c >= 15 ? "mild" : "cool");
export const humidityBand = (h) => (h < 40 ? "dry" : h <= 70 ? "moderate" : "high");
export const rainBand = (mm) => (mm < 0.5 ? "none" : mm < 5 ? "light" : mm < 20 ? "moderate" : "heavy");
export const phBand = (ph) => (ph < 5.5 ? "acidic" : ph <= 7.3 ? "neutral" : "alkaline");
/** Short descriptions of the soil classes the soil map names. A class that is not listed gets no description. */
export const SOIL_GLOSS = ["Vertisols", "Cambisols", "Luvisols", "Leptosols", "Fluvisols", "Regosols"];

/**
 * One short explanation per field condition, built from what was actually retrieved. Every sentence says what a value means in general and
 * never that it raises or lowers the predicted price: the price model does not use these six conditions. A missing value says there is not
 * enough information for a reliable explanation. Pure function so it can be tested without rendering.
 */
export function conditionMeanings({ crop, market, weather, soil, t }) {
  const w = weather?.data;
  const wxOk = weather?.state === "ok" && w && w.status !== "unavailable" && w.temperature_c != null;
  const sd = soil?.data;
  const soilOk = soil?.state === "ok" && sd && sd.status === "estimate";
  const when = wxOk ? t(`fc.when.${w.status}`, { date: fmtDate(w.date) }) : "";
  const none = (key, vars) => t(key, vars);
  const items = [];

  items.push({ id: "temperature", label: t("fc.temperature"), text: wxOk
    ? t("cm.temperature", { when, value: w.temperature_c, band: t(`cm.temp.${tempBand(w.temperature_c)}`), crop })
    : none("cm.temperature.none") });

  items.push({ id: "humidity", label: t("fc.humidity"), text: wxOk
    ? t("cm.humidity", { when, value: w.humidity_pct, meaning: t(`cm.hum.${humidityBand(w.humidity_pct)}`) })
    : none("cm.humidity.none") });

  items.push({ id: "rainfall", label: t("fc.rainfall"), text: wxOk
    ? t(w.rainfall_mm < 0.5 ? "cm.rainfall.none" : "cm.rainfall", { when, value: w.rainfall_mm, band: t(`cm.rain.${rainBand(w.rainfall_mm)}`), crop })
    : none("cm.rainfall.unavail") });

  items.push({ id: "ph", label: t("fc.ph"), text: soilOk && sd.ph != null
    ? t("cm.ph", { value: sd.ph, band: t(`cm.phband.${phBand(sd.ph)}`) })
    : none("cm.ph.none") });

  items.push({ id: "soil", label: t("fc.soil"), text: soilOk && sd.soil_type
    ? t("cm.soil", { name: sd.soil_type }) + (SOIL_GLOSS.includes(sd.soil_type) ? " " + t(`cm.gloss.${sd.soil_type}`) : "")
    : none("cm.soil.none") });

  items.push({ id: "location", label: t("fc.location"), text: t("cm.location", { market }) });
  return items;
}

/** "What Do These Conditions Mean for Your Crop?": six short explanations directly below the field conditions. */
export default function ConditionMeanings({ crop, market, weather, soil }) {
  const t = useT();
  const items = conditionMeanings({ crop, market, weather, soil, t });
  return (
    <section aria-labelledby="cm-title" data-testid="condition-meanings" style={{ marginTop: "1.1rem" }}>
      <h3 id="cm-title" className="xai-h" style={{ margin: "0 0 0.15rem" }}>{t("cm.title")}</h3>
      <p className="muted small" style={{ margin: "0 0 0.6rem" }}>{t("cm.intro")}</p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "0.6rem" }}>
        {items.map((i) => (
          <li key={i.id} data-testid={`cm-${i.id}`} style={{ background: "var(--card-soft, #f6f6ee)", borderRadius: 12, padding: "0.65rem 0.85rem" }}>
            <strong style={{ display: "block", marginBottom: "0.15rem" }}>{i.label}</strong>
            <span className="small" style={{ lineHeight: 1.5 }}>{i.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
