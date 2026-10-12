import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CircleCheck, CircleX, Clock3, CloudRain, CloudSun, Droplets, FlaskConical, Lightbulb, MapPin, Package, Sprout, TestTubeDiagonal, Thermometer,
} from "lucide-react";
import Alert from "../components/Alert";
import FormField from "../components/FormField";
import Loader from "../components/Loader";
import PageHero from "../components/PageHero";
import SproutSpinner from "../components/SproutSpinner";
import fieldPhoto from "../assets/photos/field.webp";
import { useAsync } from "../hooks/useAsync";
import { useT } from "../i18n/LanguageContext";
import { errorMessage } from "../services/api";
import { cropService } from "../services/cropService";
import { cropName, monthLong } from "../utils/format";
import { numberInRange } from "../utils/validation";

export const LAST_CROP_RESULT_KEY = "smartcrop_last_crop_result";

// min/max = what the API accepts; "typical" = range of the training dataset.
// `label` is the original English field name; the on-screen label, unit, help and validation wording come from the dictionary.
const FIELDS = [
  { key: "nitrogen", label: "Nitrogen (N)", min: 0, max: 300, typical: "0–140", step: "1", group: "soil", icon: TestTubeDiagonal, unit: "kg/ha" },
  { key: "phosphorus", label: "Phosphorus (P)", min: 0, max: 300, typical: "5–145", step: "1", group: "soil", icon: TestTubeDiagonal, unit: "kg/ha" },
  { key: "potassium", label: "Potassium (K)", min: 0, max: 400, typical: "5–205", step: "1", group: "soil", icon: TestTubeDiagonal, unit: "kg/ha" },
  { key: "ph", label: "Soil pH", min: 0, max: 14, typical: "3.5–9.9", step: "0.1", group: "soil", icon: FlaskConical },
  { key: "temperature", label: "Temperature (°C)", min: -10, max: 55, typical: "8.8–43.7 °C", step: "0.1", group: "weather", icon: Thermometer, unit: "°C" },
  { key: "humidity", label: "Humidity (%)", min: 0, max: 100, typical: "14–100 %", step: "0.1", group: "weather", icon: Droplets, unit: "%" },
  { key: "rainfall", label: "Rainfall (mm / month)", min: 0, max: 3000, typical: "20–299 mm", step: "0.1", group: "weather", icon: CloudRain, unit: "mm / month" },
];
const FIELD_ORDER = [...FIELDS.map((f) => f.key), "area_acres"];
const MONTH_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const EXAMPLES = {
  "Onion field, Nashik": { nitrogen: 80, phosphorus: 45, potassium: 85, ph: 6.8, temperature: 23, humidity: 58, rainfall: 70, city: "Nashik", planting_month: 11, selling_month: 3 },
  "Vegetable plot, Pune": { nitrogen: 115, phosphorus: 65, potassium: 70, ph: 6.4, temperature: 21, humidity: 70, rainfall: 85, city: "Pune", planting_month: 9, selling_month: 12 },
  "Wheat field, Nagpur": { nitrogen: 90, phosphorus: 45, potassium: 40, ph: 7.4, temperature: 20, humidity: 45, rainfall: 30, city: "Nagpur", planting_month: 11, selling_month: 3 },
};

// Ready-in-time status for the crop checklist (icon + colour + label, never colour alone)
const READY = {
  ok: { icon: CircleCheck, cls: "text-good", text: "crop.form.readyOk" },
  stored: { icon: Package, cls: "text-ink-2", text: "crop.form.readyStored" },
  early: { icon: CircleX, cls: "text-bad", text: "crop.form.readyNo" },
  late: { icon: CircleX, cls: "text-bad", text: "crop.form.readyNo" },
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

export default function CropRecommendation() {
  const t = useT();
  const navigate = useNavigate();
  const { data: opts, loading, error: optsError, reload } = useAsync(() => cropService.options(), []);
  const thisMonth = new Date().getMonth() + 1;
  const [form, setForm] = useState({
    nitrogen: "", phosphorus: "", potassium: "", ph: "", temperature: "", humidity: "", rainfall: "",
    city: "Pune", planting_month: thisMonth, selling_month: ((thisMonth + 3) % 12) + 1,
    area_acres: "1", soil_type: "",
  });
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const growMonths = monthsBetween(Number(form.planting_month), Number(form.selling_month));
  const crops = useMemo(() => readyCrops(opts?.calendar, Number(form.planting_month), Number(form.selling_month)),
    [opts, form.planting_month, form.selling_month]);

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    FIELDS.forEach((f) => {
      const err = numberInRange(form[f.key], f.min, f.max, t(`crop.form.validLabel.${f.key}`), t);
      if (err) errs[f.key] = err;
    });
    const areaErr = numberInRange(form.area_acres, 0.1, 1000, t("crop.form.validLabel.area_acres"), t);
    if (areaErr) errs.area_acres = areaErr;
    setErrors(errs);
    if (Object.keys(errs).length) { focusFirstError(errs); return; }

    const req = {
      ...Object.fromEntries(FIELDS.map((f) => [f.key, Number(form[f.key])])),
      city: form.city, planting_month: Number(form.planting_month),
      selling_month: Number(form.selling_month), area_acres: Number(form.area_acres),
      state: "Maharashtra", soil_type: form.soil_type.trim() || null,
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

  const renderField = (f) => (
    <FormField key={f.key} id={f.key} required unit={f.unit && cropName(t, f.unit, "unit")} error={errors[f.key]}
      label={<span className="inline-icon"><f.icon size={15} className="text-ink-muted" aria-hidden="true" />{t(`crop.form.field.${f.key}`)}</span>}
      help={t(`crop.form.help.${f.key}`)} hint={t("crop.form.typical", { range: f.typical })}>
      <input id={f.key} type="number" inputMode="decimal" step={f.step} min={f.min} max={f.max}
        value={form[f.key]} onChange={set(f.key)} />
    </FormField>
  );

  if (loading) return <Loader label={t("crop.form.loading")} />;
  if (optsError) return <Alert type="error" action={<button className="btn btn-secondary" onClick={reload}>{t("common.retry")}</button>}>{optsError}</Alert>;

  const errorCount = Object.keys(errors).length;

  return (
    <>
      <PageHero image={fieldPhoto} alt={t("art.fieldAlt")} title={t("crop.form.title")}>{t("crop.form.subtitle")}</PageHero>

      <div className="example-box mb-4">
        <p className="inline-icon !mb-1 font-semibold"><Lightbulb size={17} className="text-brand" aria-hidden="true" />{t("crop.form.examplesTitle")}</p>
        <p className="muted small !mb-2">{t("crop.form.examplesNote")}</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(EXAMPLES).map(([name, ex], i) => (
            <button key={name} type="button" className="btn btn-secondary example-btn"
              onClick={() => { setForm((f) => ({ ...f, ...Object.fromEntries(Object.entries(ex).map(([k, v]) => [k, String(v)])) })); setErrors({}); }}>
              {t(`crop.form.example.${i}`)}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={submit} noValidate className="grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2 !mt-0">
          {apiError && <div className="mb-4"><Alert type="error">{apiError}</Alert></div>}
          {errorCount > 0 && <div className="mb-4"><Alert type="error">{t("form.fixErrors", { n: errorCount })}</Alert></div>}
          <p className="required-note">{t("form.requiredNote")}</p>
          <div className="form-section">
            <h2 className="section-title form-step"><Sprout size={19} aria-hidden="true" />{t("crop.form.soilTitle")}</h2>
            <p className="muted small">{t("crop.form.soilNote")}</p>
            <div className="form-grid">{FIELDS.filter((f) => f.group === "soil").map(renderField)}</div>
          </div>
          <div className="form-section">
            <h2 className="section-title form-step"><CloudSun size={19} aria-hidden="true" />{t("crop.form.weatherTitle")}</h2>
            <p className="muted small">{t("crop.form.weatherNote")}</p>
            <div className="form-grid">{FIELDS.filter((f) => f.group === "weather").map(renderField)}</div>
          </div>
        </div>

        <div className="card !mt-0 flex flex-col">
          <div className="form-section">
            <h2 className="section-title form-step"><MapPin size={19} aria-hidden="true" />{t("crop.form.placeTitle")}</h2>
            <div className="grid gap-4">
              <FormField id="state" label={t("crop.form.state")}><input id="state" value={cropName(t, "Maharashtra", "state")} disabled /></FormField>
              <FormField id="city" label={t("crop.form.city")} required help={t("crop.form.cityHelp")}>
                <select id="city" value={form.city} onChange={set("city")}>
                  {opts.cities.map((c) => <option key={c} value={c}>{cropName(t, c, "city")}</option>)}
                </select>
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
              <FormField id="area_acres" label={t("crop.form.area")} unit={t("crop.form.areaUnit")} required
                hint={t("crop.form.areaHint")} error={errors.area_acres}>
                <input id="area_acres" type="number" step="0.1" min="0.1" value={form.area_acres} onChange={set("area_acres")} />
              </FormField>
              <FormField id="soil_type" label={t("crop.form.soilType")} hint={t("crop.form.soilTypeHint")}>
                <input id="soil_type" value={form.soil_type} onChange={set("soil_type")} placeholder={t("crop.form.soilTypePlaceholder")} />
              </FormField>
            </div>
          </div>

          <div className="rounded-lg border border-line bg-brand-soft/40 p-3 text-sm">
            <p className="!mb-2 inline-icon font-semibold"><Clock3 size={16} aria-hidden="true" />
              {t(growMonths > 1 ? "crop.form.monthsToSell" : "crop.form.monthToSell", { n: growMonths })}</p>
            <p className="muted small !mb-2">{t("crop.form.checklistNote")}</p>
            <ul className="m-0 grid list-none grid-cols-2 gap-1 p-0">
              {crops.map((c) => {
                const r = READY[c.status];
                return (
                  <li key={c.crop} className="flex items-center gap-1.5">
                    <r.icon size={15} className={r.cls} aria-hidden="true" />
                    <span className={c.status === "early" || c.status === "late" ? "text-ink-muted line-through" : ""}>{cropName(t, c.crop)}</span>
                    <span className="sr-only">{t(r.text)}</span>
                  </li>
                );
              })}
            </ul>
            <p className="!mb-0 !mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
              <span className="inline-icon"><CircleCheck size={13} className="text-good" aria-hidden="true" />{t("crop.form.legendReady")}</span>
              <span className="inline-icon"><Package size={13} aria-hidden="true" />{t("crop.form.legendStorage")}</span>
              <span className="inline-icon"><CircleX size={13} className="text-bad" aria-hidden="true" />{t("crop.form.legendNo")}</span>
            </p>
          </div>

          <div className="mt-auto pt-4">
            <button type="submit" className="btn btn-primary btn-lg w-full" disabled={submitting}>
              {submitting && <SproutSpinner inButton />}{submitting ? t("crop.form.submitting") : t("crop.form.submit")}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
