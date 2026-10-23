import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check, CircleAlert, CircleCheck, CircleX, CloudSun, Lightbulb, MapPin, Package, Pencil, Sprout, TrendingUp, Wand2,
} from "lucide-react";
import Alert from "../components/Alert";
import CropArt from "../components/CropArt";
import FormField from "../components/FormField";
import Loader from "../components/Loader";
import PageHero from "../components/PageHero";
import SproutSpinner from "../components/SproutSpinner";
import CitySelect from "../components/crop/CitySelect";
import RangeField from "../components/crop/RangeField";
import WeatherCards from "../components/crop/WeatherCards";
import fieldPhoto from "../assets/photos/field.webp";
import { CROP_EXAMPLES, DEFAULT_EXAMPLE, exampleLabel, exampleToForm } from "../data/cropExamples";
import { useAsync } from "../hooks/useAsync";
import { useWeather } from "../hooks/useWeather";
import { useT } from "../i18n/LanguageContext";
import { errorMessage } from "../services/api";
import { cropService } from "../services/cropService";
import { buildRanges, fieldStatus, fmtRange, likelyFits } from "../utils/featureRanges";
import { cropName, monthLong } from "../utils/format";
import { areaError } from "../utils/fieldSize";
import BudgetStep from "../components/crop/BudgetStep";
import LockedState from "../components/LockedState";
import { DEFAULT_PRIORITY, DEFAULT_RISK, budgetError, cleanBudget, missingText, planPayload } from "../utils/budgetPlan";

export const LAST_CROP_RESULT_KEY = "smartcrop_last_crop_result";

// min/max/usual ranges come from the API (see utils/featureRanges.js), never from numbers in this file; the rest is display only.
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
const FIELD_ORDER = [...SOIL_KEYS, "area_acres", "selling_month", ...WEATHER_KEYS, "budget_inr"];
const STATE = "Maharashtra";
const MONTH_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
// stored (and sent) in English; shown in the chosen language
// Soil types the model knows (the value sent to the API), in display order; "unknown" = "Not sure / skip" (the default).
export const SOILS = ["sandy_loam", "loam", "clay_loam", "alluvial", "unknown"];


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
  area_acres: "1", soil_type: "unknown",
  // optional "Budget & priorities" card; left as they are, the request is exactly the standard one
  budget_inr: "", priority: DEFAULT_PRIORITY, risk_level: DEFAULT_RISK,
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
  const [areaUnit, setAreaUnit] = useState("acre");      // how the field size is typed and shown; the value kept and sent is always acres
  const [submitting, setSubmitting] = useState(false);

  const set = (k) => (e) => {
    if (k === "planting_month" || k === "selling_month") exampleWeather.current = false;
    setForm((f) => ({ ...f, [k]: k === "budget_inr" ? cleanBudget(e.target.value) : e.target.value }));
  };
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const touch = (k) => () => setTouched((x) => ({ ...x, [k]: true }));
  const plant = Number(form.planting_month), sell = Number(form.selling_month);
  const crops = useMemo(() => readyCrops(opts?.calendar, plant, sell), [opts, plant, sell]);

  // Weather comes from the city and months (debounced); typing it by hand is the fallback.
  const weather = useWeather({ city: form.city, plantMonth: plant, sellMonth: sell });
  const [weatherFailed, setWeatherFailed] = useState(false);
  // An example brings its own weather, so the automatic lookup must not replace it; any change of place, month or mode lifts this.
  const exampleWeather = useRef(false);
  // A new answer only arrives when city, planting month or selling month change (or on Retry), so values the farmer typed by hand
  // are never overwritten in between. The real fetched numbers are shown; the API clips them to the dataset range for the model.
  useEffect(() => {
    if (weather.state === "ok") {
      if (exampleWeather.current) return;
      setForm((f) => ({ ...f, temperature: String(weather.data.temperature), humidity: String(weather.data.humidity), rainfall: String(weather.data.rainfall) }));
      if (weatherFailed) { setWeatherFailed(false); setManual(false); }   // back to automatic after a failed attempt
    } else if (weather.state === "error") {
      setWeatherFailed(true);
      setManual(true);
    } else if (!manual) {
      setForm((f) => ({ ...f, temperature: "", humidity: "", rainfall: "" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manual, weather.state, weather.data]);


  // Selling in the planting month itself leaves no growing time (the month count would wrap to 12), so ask for another month.
  const monthsError = plant === sell ? t("crop.form.sameMonth") : null;

  // " kg/ha" after a range in a message ("" for pH, which has no unit)
  const unitText = (f) => (f.unit ? ` ${cropName(t, f.unit, "unit")}` : "");

  // every error, whether shown yet or not
  const errors = useMemo(() => {
    const errs = {};
    FIELDS.forEach((f) => {
      const r = ranges[f.key], label = t(`crop.form.validLabel.${f.key}`);
      const { state } = fieldStatus(form[f.key], r);
      if (state === "required") errs[f.key] = t("valid.required", { label });
      else if (state === "invalid") errs[f.key] = Number.isNaN(Number(form[f.key])) ? t("valid.number", { label }) : t("crop.form.betweenLabel", { label, min: r.hardMin, max: r.hardMax, unit: unitText(f) });
    });
    const areaErr = areaError(form.area_acres, areaUnit, t);
    if (areaErr) errs.area_acres = areaErr;
    if (monthsError) errs.selling_month = monthsError;
    const budgetKey = budgetError(form.budget_inr);
    if (budgetKey) errs.budget_inr = t(budgetKey);
    return errs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, ranges, t, manual, monthsError, areaUnit]);
  const shown = (k) => (submitted || touched[k] ? errors[k] : undefined);
  // Soft note (never blocks): the value is outside the dataset's min/max, so the model extrapolates. Automatic weather shows it at once.
  const warnOf = (f) => {
    const auto = !manual && WEATHER_KEYS.includes(f.key);
    if (!((auto || submitted || touched[f.key]) && !errors[f.key] && fieldStatus(form[f.key], ranges[f.key]).state === "outside")) return undefined;
    // soil fields name the typical range in the message itself, since it is no longer printed under the input
    if (SOIL_KEYS.includes(f.key)) return t("crop.form.betweenLabel", { label: t(`crop.form.validLabel.${f.key}`), min: ranges[f.key].min, max: ranges[f.key].max, unit: unitText(f) });
    return t(WEATHER_KEYS.includes(f.key) ? "crop.form.outsideWeather" : "crop.form.outsideData", { range: fmtRange(ranges[f.key].min, ranges[f.key].max) });
  };

  const soilDone = SOIL_KEYS.every((k) => !errors[k]);
  const placeDone = Boolean(form.city);
  const weatherDone = WEATHER_KEYS.every((k) => !errors[k]);
  const dones = [soilDone, placeDone, weatherDone];
  // Step 4 holds the required field size (it has a default) and the optional budget: done unless one of them is wrong, so it never blocks the stepper
  const budgetDone = !errors.area_acres && !errors.budget_inr;
  const current = dones.findIndex((d) => !d);
  const invalid = Object.keys(errors).length > 0;
  // a live list of what is still missing, in the order of the form
  const missing = (() => {
    const short = (s) => s.replace(/\s*\([^)]*\)\s*$/, "");                       // "Nitrogen (N)" -> "Nitrogen"
    const label = (k) => short(k === "area_acres" ? t("crop.form.area") : k === "budget_inr" ? t("crop.form.budgetShort") : t(`crop.form.field.${k}`));
    const weatherAuto = !manual;                                                        // automatic weather fills these in once the city and months are set
    const emptyKeys = FIELDS.map((f) => f.key).filter((k) => form[k] === "" && !(weatherAuto && WEATHER_KEYS.includes(k)));
    const bad = [...FIELDS.map((f) => f.key), "area_acres", "budget_inr"].filter((k) => errors[k] && !emptyKeys.includes(k) && !(weatherAuto && WEATHER_KEYS.includes(k) && form[k] === ""));
    return { empty: emptyKeys.map(label), bad: [...new Set(bad)].map(label),
      weatherPending: weatherAuto && WEATHER_KEYS.some((k) => form[k] === ""), sameMonth: Boolean(monthsError) };
  })();
  const fits = likelyFits(form, ranges);

  // Fills every field of the form (weather too, in manual mode) so the numbers always match the crop on the button.
  const fill = (ex) => {
    exampleWeather.current = true;
    setManual(true); setWeatherFailed(false); setApiError(null);
    setForm((f) => ({ ...f, ...exampleToForm(ex) }));
    setTouched({}); setSubmitted(false);
  };
  const clearAll = () => { exampleWeather.current = false; setAreaUnit("acre"); setForm(blankForm(thisMonth)); setManual(false); setTouched({}); setSubmitted(false); setApiError(null); };

  const submit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (invalid) { focusFirstError(errors); return; }

    const req = {
      ...Object.fromEntries(FIELDS.map((f) => [f.key, Number(form[f.key])])),
      city: form.city, planting_month: plant,
      selling_month: sell, area_acres: Number(form.area_acres),
      state: STATE, soil_type: form.soil_type,
      ...planPayload(form),
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
      rangeAsPlaceholder={SOIL_KEYS.includes(f.key)} help={helpOf(f.key)} range={ranges[f.key]} value={form[f.key]} step={f.step} placeholder={f.sample}
      error={shown(f.key)} warn={warnOf(f)} onChange={set(f.key)} onBlur={touch(f.key)} />
  );

  if (loading) return <Loader label={t("crop.form.loading")} />;
  if (optsError) return <Alert type="error" action={<button className="btn btn-secondary" onClick={reload}>{t("common.retry")}</button>}>{optsError}</Alert>;

  const errorCount = submitted ? Object.keys(errors).length : 0;

  return (
    <>
      <PageHero image={fieldPhoto} alt={t("art.fieldAlt")} title={t("crop.form.title")}>{t("crop.form.subtitle")}</PageHero>

      <div className="example-box mb-4">
        <p className="inline-icon !mb-1 font-semibold"><Lightbulb size={17} className="text-brand" aria-hidden="true" />{t("crop.form.examplesTitle")}</p>
        <p className="muted small !mb-2">{t("crop.form.examplesNote")}</p>
        <div className="flex flex-wrap gap-2">
          {CROP_EXAMPLES.map((ex) => (
            <button key={ex.city} type="button" className="btn btn-secondary example-btn" onClick={() => fill(ex)}>
              {exampleLabel(ex, t)}
            </button>
          ))}
        </div>
      </div>

      <ol className="steps" aria-label={t("crop.form.stepsAria")}>
        <Step n={1} label={t("crop.form.step1")} done={dones[0]} current={current === 0} />
        <Step n={2} label={t("crop.form.step2")} done={dones[1]} current={current === 1} />
        <Step n={3} label={t("crop.form.step3")} done={dones[2]} current={current === 2} />
        <Step n={4} label={t("crop.form.step4")} done={budgetDone} current={false} />
      </ol>

      <form onSubmit={submit} noValidate>
        <div className="cf-toolbar">
          <p className="required-note !mb-0">{t("form.requiredNote")}</p>
          <div className="cf-toolbar-actions">
            <button type="button" className="btn-link small" onClick={() => fill(DEFAULT_EXAMPLE)}>{t("crop.form.fillSample")}</button>
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
              <LockedState value={STATE} />
              <FormField id="city" label={t("crop.form.city")} required>
                <CitySelect id="city" value={form.city} cities={opts.cities} onChange={(c) => { exampleWeather.current = false; setForm((f) => ({ ...f, city: c })); }} />
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
              {monthsError && <span className="error !mt-[-0.5rem]" id="months-error" role="alert"><CircleAlert size={14} aria-hidden="true" />{monthsError}</span>}

              <FormField id="soil_type" label={t("crop.form.soilType")}>
                <select id="soil_type" value={form.soil_type} onChange={set("soil_type")}>
                  {SOILS.map((s) => <option key={s} value={s}>{t(`crop.form.soil.${s}`)}</option>)}
                </select>
              </FormField>
            </div>
          </section>

          <section className="cf-card cf-weather" aria-labelledby="weather-title">
            <SectionHead id="weather-title" icon={CloudSun} title={t("crop.form.weatherTitle")} note={manual ? t("crop.form.weatherNoteManual") : ""}
              action={(
                <button type="button" className="wx-toggle" onClick={() => { exampleWeather.current = false; setManual((m) => !m); }} aria-pressed={manual}>
                  {manual ? <Wand2 size={14} aria-hidden="true" /> : <Pencil size={14} aria-hidden="true" />}
                  {t(manual ? "crop.form.weatherAuto" : "crop.form.weatherEdit")}
                </button>
              )} />
            {manual
              ? (
                <>
                  {weatherFailed && <div className="mb-3"><Alert type="warn">{t("crop.form.weatherFallback")}</Alert></div>}
                  {!weatherFailed && weather.state === "loading" && <p className="muted small" role="status">{t("crop.form.weatherLoading")}</p>}
                  <div className="cf-grid cf-grid-1">{FIELDS.filter((f) => f.group === "weather").map(renderField)}</div>
                </>
              )
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

        <BudgetStep form={form} set={set} setField={setField} error={shown("budget_inr")} onBlur={touch("budget_inr")}
          economics={opts.economics} inflationPct={opts.inflation_annual_pct} SectionHead={SectionHead}
          area={{ unit: areaUnit, onUnit: setAreaUnit, error: shown("area_acres"), onBlur: touch("area_acres"), onAcres: (v) => setForm((f) => ({ ...f, area_acres: v })) }} />

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
            <p className="cf-submit-note" aria-live="polite">{invalid || missing.weatherPending ? missingText(missing, t) : t("crop.form.submitNote")}</p>
          </div>
        </div>
      </form>
    </>
  );
}
