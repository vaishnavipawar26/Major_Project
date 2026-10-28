import { CalendarDays, Droplets, FlaskConical, Layers, MapPin, Store, Thermometer, CloudRain } from "lucide-react";
import { useT } from "../../i18n/LanguageContext";
import { availability } from "../../utils/factorWeights";
import { fmtDate } from "../../utils/format";

const long = (d) => fmtDate(d, { day: "numeric", month: "long", year: "numeric" });
const first = (s) => (s ? String(s).split(",")[0] : null);

/** One factor: heading, the actual value, a status label and 1-2 plain sentences. A missing value says "Not available". */
function Card({ id, Icon, title, value, status, tone, text }) {
  const t = useT();
  return (
    <li className="wf-card" data-testid={`wf-${id}`}>
      <div className="wf-head">
        <Icon size={17} aria-hidden="true" />
        <h3>{title}</h3>
        <span className={`wf-status ${tone}`}>{status}</span>
      </div>
      <p className="wf-value" data-testid={`wf-${id}-value`}>{value ?? t("wf.na")}</p>
      <p className="wf-text">{text}</p>
    </li>
  );
}

/**
 * "Why these factors matter": one short card per factor of the histogram, built from this prediction's own data (selling date, crop,
 * market, the growing location's weather and soil). Season and crop/market say they matter to the model only when the explanation really
 * contains those model inputs; weather, soil and location are labelled context and never described as changing the price.
 */
export function WhyFactorsMatter({ exp, crop, market, targetDate, weather, soil, growing, modelInputs = null }) {
  const t = useT();
  const av = availability({ weather, soil, growing: null, market });
  const w = weather?.data, wxOk = weather?.state === "ok" && w && w.status !== "unavailable";
  const groups = new Set((exp?.charts?.local?.steps || []).map((s) => s.group));
  const mi = modelInputs || {};
  const usesSeason = modelInputs ? Boolean(mi.season) : groups.has("season");
  const usesMarket = modelInputs ? Boolean(mi.crop_market) : groups.has("crop_market");
  const anyUsed = Boolean(mi.temperature || mi.rainfall || mi.humidity || mi.soil_type || mi.soil_ph);
  const kind = wxOk ? t(`wf.kind.${w.status}`) : "";
  const where = first(w?.place) || market;
  const place = av.location.value || first(typeof growing === "string" ? growing : growing?.name);
  const na = t("wf.na");

  // a weather / soil card: "Used by the model" only when the loaded model has that input; otherwise context only (or a regional estimate)
  const env = (id, Icon, label, used, value, usedText, contextText, estimate = false) => {
    const ok = av[id].ok;
    const status = used ? (ok ? t("wf.s.model") : t("wf.na")) : t(estimate ? "wf.s.estimate" : "wf.s.context");
    const tone = used && ok ? "is-model" : estimate ? "is-estimate" : "is-context";
    return <Card key={id} id={id} Icon={Icon} title={label} value={ok ? value : null} status={status} tone={tone}
      text={!ok ? t("wf.missing") : used ? usedText : contextText} />;
  };
  const date = fmtDate(w?.date);
  const at = { kind, where, date };

  return (
    <section className="card xp-section" aria-labelledby="wf-title" data-testid="why-factors">
      <h2 id="wf-title" className="cr-h2">{t("wf.title")}</h2>
      <p className="muted small wf-note" data-testid="wf-note">{t(anyUsed ? "wf.noteUsed" : "wf.note")}</p>
      <ul className="wf-grid">
        <Card id="season" Icon={CalendarDays} title={t("wf.season")} value={long(targetDate)}
          status={t(usesSeason ? "wf.s.model" : "wf.s.unconfirmed")} tone={usesSeason ? "is-model" : "is-context"}
          text={t(usesSeason ? "wf.season.model" : "wf.season.unconfirmed")} />
        <Card id="market" Icon={Store} title={t("wf.market")} value={`${crop} · ${market}`}
          status={t(usesMarket ? "wf.s.model" : "wf.s.unconfirmed")} tone={usesMarket ? "is-model" : "is-context"}
          text={t(usesMarket ? "wf.market.model" : "wf.market.unconfirmed", { crop, market })} />
        {env("temperature", Thermometer, t("wf.temperature"), mi.temperature, `${av.temperature.value} °C`, t("wf.temperature.used", at), t("wf.temperature.text", at))}
        {env("rainfall", CloudRain, t("wf.rainfall"), mi.rainfall, `${av.rainfall.value} mm`, t("wf.rainfall.used", at), t("wf.rainfall.text", at))}
        {env("humidity", Droplets, t("wf.humidity"), mi.humidity, `${av.humidity.value}%`, t("wf.humidity.used", at), t("wf.humidity.text", at))}
        {env("soil", Layers, t("wf.soil"), mi.soil_type, av.soil.ok ? `${av.soil.value} ${t("wf.estimate")}` : null, t("wf.soil.used", { value: av.soil.value, market }),
          t("wf.soil.text", { value: av.soil.value }), true)}
        {env("ph", FlaskConical, t("wf.ph"), mi.soil_ph, av.ph.ok ? `${av.ph.value} ${t("wf.estimate")}` : null, t("wf.ph.used", { value: av.ph.value, market }),
          t("wf.ph.text", { value: av.ph.value }), true)}
        <Card id="location" Icon={MapPin} title={t("wf.location")} value={place || na} status={t("wf.s.location")} tone="is-context"
          text={place ? t("wf.location.text", { place }) : t("wf.missing")} />
      </ul>
    </section>
  );
}
