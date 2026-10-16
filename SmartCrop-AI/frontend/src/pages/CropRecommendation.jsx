import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check, CircleCheck, CircleX, Clock3, CloudSun, Lightbulb, Lock, MapPin, Minus, Package, Pencil, Plus, Sprout, TrendingUp, Wand2,
} from "lucide-react";
import Alert from "../components/Alert";
import CropArt from "../components/CropArt";
import FormField from "../components/FormField";
import Loader from "../components/Loader";
import PageHero from "../components/PageHero";
import SproutSpinner from "../components/SproutSpinner";
import CitySelect from "../components/crop/CitySelect";
import MonthTimeline from "../components/crop/MonthTimeline";
import RangeField from "../components/crop/RangeField";
import WeatherCards from "../components/crop/WeatherCards";
import fieldPhoto from "../assets/photos/field.webp";
import { useAsync } from "../hooks/useAsync";
import { useWeather } from "../hooks/useWeather";
import { useT } from "../i18n/LanguageContext";
import { errorMessage } from "../services/api";
import { cropService } from "../services/cropService";
import { FALLBACK, buildRanges, fieldStatus, likelyFits } from "../utils/featureRanges";
import { cropName, monthLong, monthShort } from "../utils/format";
import { numberInRange } from "../utils/validation";

export const LAST_CROP_RESULT_KEY = "smartcrop_last_crop_result";

// min/max/usual ranges come from the API (see utils/featureRanges.js); the rest is display only.
// `label` is the original English field name; the on-screen label, unit, help and validation wording come from the dictionary.
const FIELDS = [
  { key: "nitrogen", label: "Nitrogen (N)", step: "1", group: "soil", unit: "kg/ha", sample: "80" },
  { key: "phosphorus", label: "Phosphorus (P)", step: "1", group: "soil", unit: "kg/ha", sample: "45" },
  { key: "potassium", label: "Potassium (K)", step: "1", group: "soil", unit: "kg/ha", sample: "85" },
  { key: "ph", label: "Soil pH", step: "0.1", group: "soil", sample: "6.8" },
  { key: "temperature", label: "Temperature (°C)", step: "1", group: "weather", unit: "°C", sample: "23" },
  { key: "humidity", label: "Humidity (%)", step: "1", group: "weather", unit: "%", sample: "58" },
  { key: "rainfall", label: "Rainfall (mm / month)", step: "1", group: "weather", unit: "mm / month", sample: "70" },
];
const SOIL_KEYS = FIELDS.filter((f) => f.group === "soil").map((f) => f.key);
const WEATHER_KEYS = FIELDS.filter((f) => f.group === "weather").map((f) => f.key);
const FIELD_ORDER = [...SOIL_KEYS, "area_acres", ...WEATHER_KEYS];
const STATE = "Maharashtra";
const MONTH_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
// stored (and sent) in English; shown in the chosen language
const SOILS = ["Black cotton", "Red", "Laterite", "Alluvial", "Sandy loam", "Other"];
const AREA_MIN = 0.1, AREA_MAX = 1000, GUNTHA_PER_ACRE = 40;

const EXAMPLES = {
  "Onion field, Nashik": { nitrogen: 80, phosphorus: 45, potassium: 85, ph: 6.8, temperature: 23, humidity: 58, rainfall: 70, city: "Nashik", planting_month: 11, selling_month: 3 },
  "Vegetable plot, Pune": { nitrogen: 115, phosphorus: 65, potassium: 70, ph: 6.4, temperature: 21, humidity: 70, rainfall: 85, city: "Pune", planting_month: 9, selling_month: 12 },
  "Wheat field, Nagpur": { nitrogen: 90, phosphorus: 45, potassium: 40, ph: 7.4, temperature: 20, humidity: 45, rainfall: 30, city: "Nagpur", planting_month: 11, selling_month: 3 },
};

// Ready-in-time status for the crop chips (icon + colour + label, never colour alone)
const READY = {
  ok: { icon: CircleCheck, cls: "is-ok", text: "crop.form.readyOk" },
  stored: { icon: Package, cls: "is-stored", text: "crop.form.readyStored" },
  early: { icon: CircleX, cls: "is-no", text: "crop.form.readyNo" },
  late: { icon: CircleX, cls: "is-no", text: "crop.form.readyNo" },
};

const monthsBetween = (a, b) => ((b - a + 12) % 12) || 12;

function readyCrops(calendar, plant, sell) {
  const n = monthsBetween(plant, sell);
  return Object.entries(calendar || {}).map(([crop, c]) => {
    let status = "ok";
    if (n < c.growth_months_min) status = "early";
    else if (n > c.growth_months_max + c.max_storage_months) status = "late";
    else if (n > c.growth_months_max) status = "stored";
    return { crop, status, inWindow: c.planting_months.includes(plant) };
  });
}

/** Move keyboard focus (and the screen) to the first field with an error. */
const focusFirstError = (errs) => {
  const first = FIELD_ORDER.find((k) => errs[k]);
  const el = first && document.getElementById(first);
  if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: "center", behavior: "smooth" }); }
};

const blankForm = (thisMonth) => ({
  nitrogen: "", phosphorus: "", potassium: "", ph: "", temperature: "", humidity: "", rainfall: "",
  city: "Pune", planting_month: thisMonth, selling_month: ((thisMonth + 3) % 12) + 1,
  area_acres: "1", soil_type: "",
});

/** Progress step: a number, the current step highlighted, a green check once the section is valid. */
function Step({ n, label, done, current }) {
  return (
    <li className={`step-item${done ? " is-done" : ""}${current ? " is-current" : ""}`} aria-current={current ? "step" : undefined}>
      <span className="step-dot" aria-hidden="true">{done ? <Check size={14} strokeWidth={3} /> : n}</span>
      <span>{label}</span>
    </li>
  );
}

function SectionHead({ id, icon: Icon, title, note, action }) {
  return (
    <div className="sec-head">
      <span className="sec-badge"><Icon size={18} strokeWidth={2} aria-hidden="true" /></span>
      <div className="sec-text">
        <h2 id={id} className="sec-title">{title}</h2>
        <div className="sec-sub"><p className="sec-note">{note}</p>{action}</div>
      </div>
    </div>
  );
}

export default function CropRecommendation() {
  const t = useT();
  const navigate = useNavigate();
  const { data: opts, loading, error: optsError, reload } = useAsync(() => cropService.options(), []);
  const { data: rangeData } = useAsync(() => cropService.featureRanges(), []);
  const ranges = useMemo(() => buildRanges(rangeData), [rangeData]);
  const thisMonth = new Date().getMonth() + 1;
  const [form, setForm] = useState(() => blankForm(thisMonth));
  const [manual, setManual] = useState(false);
  const [touched, setTouched] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [apiError, setApiError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const touch = (k) => () => setTouched((x) => ({ ...x, [k]: true }));
  const plant = Number(form.planting_month), sell = Number(form.selling_month);
  const growMonths = monthsBetween(plant, sell);
  const crops = useMemo(() => readyCrops(opts?.calendar, plant, sell), [opts, plant, sell]);

  // Weather comes from the city and months (debounced); typing it by hand is the fallback.
  const weather = useWeather({ city: form.city, state: STATE, plantMonth: plant, sellMonth: sell, enabled: !manual });
  useEffect(() => {
    if (manual) return;
    const v = weather.state === "ok"
      ? { temperature: String(weather.data.avgTemperature), humidity: String(weather.data.avgHumidity), rainfall: String(weather.data.avgRainfall) }
      : { temperature: "", humidity: "", rainfall: "" };
    setForm((f) => ({ ...f, ...v }));
  }, [manual, weather.state, weather.data]);

  // The year the crop is planted in is the next occurrence of the planting month; selling rolls into the next year when it is not later.
  const now = new Date();
  const plantYear = plant >= now.getMonth() + 1 ? now.getFullYear() : now.getFullYear() + 1;
  const sellYear = plantYear + (sell > plant ? 0 : 1);

  // Hard limits: the dataset's min/max for typed values; automatic weather only has to be a plausible number (the API's own limits).
  const limitsOf = (key) => (manual || SOIL_KEYS.includes(key) ? ranges[key] : { ...ranges[key], min: FALLBACK[key].min, max: FALLBACK[key].max });

  // every error, whether shown yet or not
  const errors = useMemo(() => {
    const errs = {};
    FIELDS.forEach((f) => {
      const r = limitsOf(f.key), label = t(`crop.form.validLabel.${f.key}`);
      const { state } = fieldStatus(form[f.key], r);
      if (state === "required") errs[f.key] = t("valid.required", { label });
      else if (state === "invalid") errs[f.key] = Number.isNaN(Number(form[f.key])) ? t("valid.number", { label }) : t("crop.form.between", { min: r.min, max: r.max });
    });
    const areaErr = numberInRange(form.area_acres, AREA_MIN, AREA_MAX, t("crop.form.validLabel.area_acres"), t);
    if (areaErr) errs.area_acres = areaErr;
    return errs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, ranges, t, manual]);
  const shown = (k) => (submitted || touched[k] ? errors[k] : undefined);
  const warnOf = (f) => ((submitted || touched[f.key]) && !errors[f.key] && fieldStatus(form[f.key], ranges[f.key]).state === "outside" ? t("crop.form.fewCrops") : undefined);

  const soilDone = SOIL_KEYS.every((k) => !errors[k]);
  const placeDone = Boolean(form.city) && !errors.area_acres;
  const weatherDone = WEATHER_KEYS.every((k) => !errors[k]);
  const dones = [soilDone, placeDone, weatherDone];
  const current = dones.findIndex((d) => !d);
  const invalid = Object.keys(errors).length > 0;
  const fits = likelyFits(form, ranges);

  const fill = (ex) => {
    const { temperature, humidity, rainfall, ...rest } = ex;
    const weatherValues = manual ? { temperature, humidity, rainfall } : {};
    setForm((f) => ({ ...f, ...Object.fromEntries(Object.entries({ ...rest, ...weatherValues }).map(([k, v]) => [k, String(v)])) }));
    setTouched({}); setSubmitted(false);
  };
  const clearAll = () => { setForm(blankForm(thisMonth)); setManual(false); setTouched({}); setSubmitted(false); setApiError(null); };
  const bumpArea = (d) => setForm((f) => {
    const next = Math.round((Number(f.area_acres || 0) + d) * 10) / 10;
    return { ...f, area_acres: String(Math.min(AREA_MAX, Math.max(AREA_MIN, next))) };
  });

  const submit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (invalid) { focusFirstError(errors); return; }

    const req = {
      ...Object.fromEntries(FIELDS.map((f) => [f.key, Number(form[f.key])])),
      city: form.city, planting_month: plant,
      selling_month: sell, area_acres: Number(form.area_acres),
      state: STATE, soil_type: form.soil_type.trim() || null,
    };
    setSubmitting(true);
    setApiError(null);
    try {
      const response = await cropService.recommend(req);
      try { sessionStorage.setItem(LAST_CROP_RESULT_KEY, JSON.stringify({ req, response })); } catch { /* ignore */ }
      navigate("/crop-recommendation/result", { state: { req, response } });
    } catch (err) {
      setApiError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  // N, P and K have no help line; pH and the weather fields keep theirs (a missing key renders nothing)
  const helpOf = (key) => { const k = `crop.form.help.${key}`, h = t(k); return h === k ? undefined : h; };
  const renderField = (f) => (
    <RangeField key={f.key} id={f.key} label={t(`crop.form.field.${f.key}`)} unit={f.unit && cropName(t, f.unit, "unit")}
      help={helpOf(f.key)} range={ranges[f.key]} value={form[f.key]} step={f.step} placeholder={f.sample}
      error={shown(f.key)} warn={warnOf(f)} onChange={set(f.key)} onBlur={touch(f.key)} />
  );

  if (loading) return <Loader label={t("crop.form.loading")} />;
  if (optsError) return <Alert type="error" action={<button className="btn btn-secondary" onClick={reload}>{t("common.retry")}</button>}>{optsError}</Alert>;

  const errorCount = submitted ? Object.keys(errors).length : 0;
  const acres = Number(form.area_acres);
  const guntha = Number.isFinite(acres) ? Math.round(acres * GUNTHA_PER_ACRE * 10) / 10 : 0;

  return (
    <>
      <PageHero image={fieldPhoto} alt={t("art.fieldAlt")} title={t("crop.form.title")}>{t("crop.form.subtitle")}</PageHero>

      <div className="example-box mb-4">
        <p className="inline-icon !mb-1 font-semibold"><Lightbulb size={17} className="text-brand" aria-hidden="true" />{t("crop.form.examplesTitle")}</p>
        <p className="muted small !mb-2">{t("crop.form.examplesNote")}</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(EXAMPLES).map(([name, ex], i) => (
            <button key={name} type="button" className="btn btn-secondary example-btn" onClick={() => fill(ex)}>
              {t(`crop.form.example.${i}`)}
            </button>
          ))}
        </div>
      </div>

      <ol className="steps" aria-label={t("crop.form.stepsAria")}>
        <Step n={1} label={t("crop.form.step1")} done={dones[0]} current={current === 0} />
        <Step n={2} label={t("crop.form.step2")} done={dones[1]} current={current === 1} />
        <Step n={3} label={t("crop.form.step3")} done={dones[2]} current={current === 2} />
      </ol>

      <form onSubmit={submit} noValidate>
        <div className="cf-toolbar">
          <p className="required-note !mb-0">{t("form.requiredNote")}</p>
          <div className="cf-toolbar-actions">
            <button type="button" className="btn-link small" onClick={() => fill(EXAMPLES["Onion field, Nashik"])}>{t("crop.form.fillSample")}</button>
            <button type="button" className="btn-link small" onClick={clearAll}>{t("crop.form.clearAll")}</button>
          </div>
        </div>
        {apiError && <div className="mb-4"><Alert type="error">{apiError}</Alert></div>}
        {errorCount > 0 && <div className="mb-4"><Alert type="error">{t("form.fixErrors", { n: errorCount })}</Alert></div>}

        <div className="cf-layout">
          <section className="cf-card" aria-labelledby="soil-title">
            <SectionHead id="soil-title" icon={Sprout} title={t("crop.form.soilTitle")} note={t("crop.form.soilNote")} />
            <div className="cf-grid">{FIELDS.filter((f) => f.group === "soil").map(renderField)}</div>
          </section>

          <section className="cf-card" aria-labelledby="place-title">
            <SectionHead id="place-title" icon={MapPin} title={t("crop.form.placeTitle")} note={t("crop.form.placeNote")} />
            <div className="grid gap-4">
              <div className="field">
                <span className="label-like" id="state-label">{t("crop.form.state")}</span>
                <span className="state-chip" aria-labelledby="state-label"><Lock size={14} aria-hidden="true" />{cropName(t, STATE, "state")}</span>
              </div>
              <FormField id="city" label={t("crop.form.city")} required help={t("crop.form.cityHelp")}>
                <CitySelect id="city" value={form.city} cities={opts.cities} onChange={(c) => setForm((f) => ({ ...f, city: c }))} />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField id="planting_month" label={t("crop.form.plantingMonth")} required>
                  <select id="planting_month" value={form.planting_month} onChange={set("planting_month")}>
                    {MONTH_NUMBERS.map((n) => <option key={n} value={n}>{monthLong(n)}</option>)}
                  </select>
                </FormField>
                <FormField id="selling_month" label={t("crop.form.sellingMonth")} required>
                  <select id="selling_month" value={form.selling_month} onChange={set("selling_month")}>
                    {MONTH_NUMBERS.map((n) => <option key={n} value={n}>{monthLong(n)}</option>)}
                  </select>
                </FormField>
              </div>
              <div className="duration-pill" role="status">
                <Clock3 size={15} aria-hidden="true" />
                <div>
                  <span>{t(growMonths > 1 ? "crop.form.monthsToSell" : "crop.form.monthToSell", { n: growMonths })}</span>
                  <small>{t("crop.form.sellingIn", { month: `${monthShort(sell)} ${sellYear}` })}</small>
                  <MonthTimeline plant={plant} sell={sell} />
                </div>
              </div>

              <FormField id="area_acres" label={t("crop.form.area")} unit={t("crop.form.areaUnit")} required
                hint={t("crop.form.areaConvert", { acres: Number.isFinite(acres) ? acres : 0, guntha })} error={shown("area_acres")}>
                <div className="stepper">
                  <button type="button" onClick={() => bumpArea(-0.5)} aria-label={t("crop.form.areaLess")}><Minus size={16} aria-hidden="true" /></button>
                  <input id="area_acres" type="number" inputMode="decimal" step="0.1" min={AREA_MIN} max={AREA_MAX} value={form.area_acres}
                    onChange={set("area_acres")} onBlur={touch("area_acres")} onWheel={(e) => e.currentTarget.blur()} />
                  <button type="button" onClick={() => bumpArea(0.5)} aria-label={t("crop.form.areaMore")}><Plus size={16} aria-hidden="true" /></button>
                </div>
              </FormField>
              <p className="muted small !mt-[-0.5rem] !mb-0">{t("crop.form.areaHint")}</p>

              <FormField id="soil_type" label={t("crop.form.soilType")}>
                <select id="soil_type" value={form.soil_type} onChange={set("soil_type")}>
                  <option value="">{t("crop.form.soilNone")}</option>
                  {SOILS.map((s) => <option key={s} value={s}>{t(`crop.form.soil.${s}`)}</option>)}
                </select>
              </FormField>
            </div>
          </section>

          <section className="cf-card cf-weather" aria-labelledby="weather-title">
            <SectionHead id="weather-title" icon={CloudSun} title={t("crop.form.weatherTitle")} note={t(manual ? "crop.form.weatherNoteManual" : "crop.form.weatherNote")}
              action={(
                <button type="button" className="wx-toggle" onClick={() => setManual((m) => !m)} aria-pressed={manual}>
                  {manual ? <Wand2 size={14} aria-hidden="true" /> : <Pencil size={14} aria-hidden="true" />}
                  {t(manual ? "crop.form.weatherAuto" : "crop.form.weatherEdit")}
                </button>
              )} />
            {manual
              ? <div className="cf-grid cf-grid-1">{FIELDS.filter((f) => f.group === "weather").map(renderField)}</div>
              : <WeatherCards weather={weather} onRetry={weather.retry} onManual={() => setManual(true)} city={form.city} ranges={ranges} />}
            {fits && (
              <div className="fit-preview" role="status">
                <div className="fit-preview-head"><Sprout size={16} aria-hidden="true" /><strong>{t("crop.form.fitsTitle")}</strong></div>
                {fits.length
                  ? <ul className="fit-chips">{fits.map((c) => <li key={c.crop}>{cropName(t, c.crop)}</li>)}</ul>
                  : <p className="fit-none">{t("crop.form.fitsNone")}</p>}
                <span className="fit-preview-tag">{t("crop.form.fitsPreview")}</span>
              </div>
            )}
          </section>
        </div>

        <div className="cf-card cf-bottom">
          <div className="crop-chips-box">
            <p className="muted small !mb-2">{t("crop.form.checklistNote")}</p>
            <ul className="crop-chips">
              {crops.map((c) => {
                const r = READY[c.status];
                return (
                  <li key={c.crop} className={`crop-chip ${r.cls}`}>
                    <CropArt crop={c.crop} size={24} decorative />
                    <span className="crop-chip-name">{cropName(t, c.crop)}</span>
                    <r.icon size={15} aria-hidden="true" />
                    <span className="sr-only">{t(r.text)}</span>
                  </li>
                );
              })}
            </ul>
            <p className="crop-legend">
              <span className="is-ok"><CircleCheck size={13} aria-hidden="true" />{t("crop.form.legendReady")}</span>
              <span className="is-stored"><Package size={13} aria-hidden="true" />{t("crop.form.legendStorage")}</span>
              <span className="is-no"><CircleX size={13} aria-hidden="true" />{t("crop.form.legendNo")}</span>
            </p>
          </div>

          <div className="cf-submit">
            <button type="submit" className="btn btn-lg cf-submit-btn" disabled={submitting || invalid}>
              {submitting ? <SproutSpinner inButton /> : <TrendingUp size={18} aria-hidden="true" />}
              {submitting ? t("crop.form.submitting") : t("crop.form.submit")}
            </button>
            <p className="cf-submit-note" aria-live="polite">{invalid ? t("crop.form.submitIncomplete") : t("crop.form.submitNote")}</p>
          </div>
        </div>
      </form>
    </>
  );
}
