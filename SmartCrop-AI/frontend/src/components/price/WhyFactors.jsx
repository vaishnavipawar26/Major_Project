import { CalendarDays, Droplets, FlaskConical, Layers, MapPin, Store, Thermometer } from "lucide-react";
import { useT } from "../../i18n/LanguageContext";
import { availability } from "../../utils/factorWeights";
import { fmtDate } from "../../utils/format";
import { modelContributions, whyLines } from "./factorModel";

const long = (d) => fmtDate(d, { day: "numeric", month: "long", year: "numeric" });
const first = (s) => (s ? String(s).split(",")[0] : null);

/** One card: icon, title, status badge, the big value and ONE short line, or, for a model factor with a contribution, its TWO short lines
 *  (what the past prices showed, then what the model adds or subtracts). */
function Card({ id, Icon, title, value, badge, line, contrib = false }) {
  return (
    <li className="wf-card" data-testid={`wf-${id}`}>
      <div className="wf-head">
        <Icon size={17} aria-hidden="true" />
        <h3>{title}</h3>
        <span className={`wf-status ${badge.tone}`}>{badge.text}</span>
      </div>
      <p className="wf-value" data-testid={`wf-${id}-value`}>{value}</p>
      <p className={contrib ? "wf-contrib" : "wf-text"} data-testid={`wf-${id}-${contrib ? "contrib" : "line"}`}>
        {contrib ? line.map((l, i) => <span key={i}>{i > 0 && <br />}{l}</span>) : line}
      </p>
    </li>
  );
}

/**
 * "Why these factors matter": seven cards built from this prediction's own data (selling date, crop and market, and the weather and regional
 * soil looked up for the farmer's growing location). Season and crop/market explain the model's own signed contribution (SHAP, rupees per
 * quintal) in two lines when the explanation provides it and the breakdown adds up to the forecast; weather and soil cards never get one,
 * because the current price model does not take them as inputs. Each value carries a short source label (forecast / recorded / typical for
 * this time of year / regional estimate); a missing value says "Not available".
 */
export function WhyFactorsMatter({ exp, crop, market, targetDate, weather, soil, growing, modelInputs = null }) {
  const t = useT();
  const av = availability({ weather, soil, growing: null, market });
  const w = weather?.data, wxOk = weather?.state === "ok" && w && w.status !== "unavailable";
  const groups = new Set((exp?.charts?.local?.steps || []).map((s) => s.group));
  const mi = modelInputs || {};
  const mc = modelContributions(exp);
  const experimental = mc.experimental;
  const contribOf = (group) => (mc[group] == null ? null : whyLines(t, group, mc[group], { crop, market }));
  const usesSeason = modelInputs ? Boolean(mi.season) : groups.has("season");
  const usesMarket = modelInputs ? Boolean(mi.crop_market) : groups.has("crop_market");
  const seasonContrib = usesSeason ? contribOf("season") : null;
  const marketContrib = usesMarket ? contribOf("crop_market") : null;
  const na = t("wf.na");
  const place = av.location.value || first(typeof growing === "string" ? growing : growing?.name);
  // a weather value carries its short source label: (forecast), (recorded) or (typical for this time of year)
  const src = wxOk ? ` (${t(`wf.src.${w.status}`)})` : "";
  const show = (id, text) => (av[id].ok ? text : na);
  const badge = (key) => ({ tone: { model: "is-model", unconfirmed: "is-context", guidance: "is-context", estimate: "is-estimate", location: "is-context" }[key],
    text: t(`wf.s.${key}`) });
  // a weather or soil card is "Used by the model" only if the loaded model really has that input (none at present)
  const env = (key, fallback) => badge(mi[key] ? "model" : fallback);

  return (
    <section className="card xp-section" aria-labelledby="wf-title" data-testid="why-factors">
      <h2 id="wf-title" className="cr-h2">{t("wf.title")}</h2>
      <ul className="wf-grid">
        <Card id="season" Icon={CalendarDays} title={t("wf.season")} value={long(targetDate)} badge={badge(usesSeason ? "model" : "unconfirmed")}
          line={seasonContrib || t("wf.line.season")} contrib={Boolean(seasonContrib)} />
        <Card id="market" Icon={Store} title={t("wf.market")} value={`${crop} · ${market}`} badge={badge(usesMarket ? "model" : "unconfirmed")}
          line={marketContrib || t("wf.line.market")} contrib={Boolean(marketContrib)} />
        <Card id="temperature" Icon={Thermometer} title={t("wf.c.temperature")} value={show("temperature", `${av.temperature.value} °C${src}`)}
          badge={env("temperature", "guidance")} line={t("wf.line.temperature")} />
        <Card id="humidity" Icon={Droplets} title={t("wf.c.humidity")} value={show("humidity", `${av.humidity.value}%${src}`)}
          badge={env("humidity", "guidance")} line={t("wf.line.humidity")} />
        <Card id="soil" Icon={Layers} title={t("wf.c.soil")} value={show("soil", `${av.soil.value} ${t("wf.estimate")}`)}
          badge={env("soil_type", "estimate")} line={t("wf.line.soil")} />
        <Card id="ph" Icon={FlaskConical} title={t("wf.c.ph")} value={show("ph", `${av.ph.value} ${t("wf.estimate")}`)}
          badge={env("soil_ph", "estimate")} line={t("wf.line.ph")} />
        <Card id="location" Icon={MapPin} title={t("wf.c.location")} value={place || na} badge={badge("location")} line={t("wf.line.location")} />
      </ul>
      {experimental && (seasonContrib || marketContrib) && <p className="muted small wf-note" data-testid="wf-exp-note">{t("wf.contrib.exp")}</p>}
    </section>
  );
}
