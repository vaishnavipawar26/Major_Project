import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { useNarrow } from "../../hooks/useNarrow";
import { useT } from "../../i18n/LanguageContext";
import { fmtDate, fmtDateTime } from "../../utils/format";
import { fmtCoords } from "./GrowingLocationField";

const BRAND = "var(--brand)";
/**
 * Each number is drawn against ITS OWN range, never against another factor's: the bar shows where the value sits inside that factor's own scale.
 * (Bar lengths of different rows are therefore not comparable, and the range is printed under every label.)
 */
const RANGES = { temperature: [0, 50, "°C"], humidity: [0, 100, "%"], rainfall: [0, 50, "mm"], ph: [0, 14, ""] };
const clampPct = (id, v) => { const [lo, hi] = RANGES[id]; return Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100)); };

/** One row of the chart, drawn from that row's data: a bar with its value beside it, a categorical pill, or a dashed "Unavailable" track. */
function RowShape({ x, y, width, height, payload }) {
  const { id, kind, status, pct, valueText } = payload;
  const cy = y + height / 2, h = 14;
  const g = { "data-testid": `fc-${id}`, "data-status": status };
  if (status === "ok" && kind === "num") {
    const filled = Math.max(8, (width * pct) / 100);
    return (
      <g {...g}>
        <rect x={x} y={cy - h / 2} width={width} height={h} rx={h / 2} fill="var(--grid, #e6e6dc)" />
        <rect x={x} y={cy - h / 2} width={filled} height={h} rx={h / 2} fill={BRAND} />
        <text x={x + width + 8} y={cy + 4.5} fontSize={13} fontWeight={700} fill="var(--text)" data-testid={`fc-${id}-value`}>{valueText}</text>
      </g>
    );
  }
  if (status === "ok") {   // a category (soil type): a labelled pill, with no bar and no number
    const w = Math.min(width, 26 + valueText.length * 7.5);
    return (
      <g {...g}>
        <rect x={x} y={cy - 12} width={w} height={24} rx={12} fill="#e6f0e8" stroke={BRAND} strokeWidth={1.25} />
        <text x={x + w / 2} y={cy + 4.5} textAnchor="middle" fontSize={13} fontWeight={700} fill={BRAND} data-testid={`fc-${id}-value`}>{valueText}</text>
      </g>
    );
  }
  return (   // unavailable or still loading: a dashed, empty track, so a missing value can never be mistaken for a short bar
    <g {...g}>
      <rect x={x} y={cy - h / 2} width={width} height={h} rx={h / 2} fill="none" stroke="var(--muted, #8a8f86)" strokeWidth={1.25} strokeDasharray="4 3" />
      <text x={x + 10} y={cy + 4} fontSize={12} fontStyle="italic" fill="var(--muted, #6b7068)" data-testid={`fc-${id}-value`}>{valueText}</text>
    </g>
  );
}

/** Row label with the factor's own range printed beneath it. A long name is split over two lines so it is never cut off. */
function RowLabel({ x, y, payload, rows }) {
  const r = rows.find((q) => q.id === payload.value);
  const words = r.label.split(" ");
  const lines = r.label.length > 12 && words.length > 1 ? [words.slice(0, Math.ceil(words.length / 2)).join(" "), words.slice(Math.ceil(words.length / 2)).join(" ")] : [r.label];
  const top = y - (lines.length > 1 ? 7 : 1);
  return (
    <g>
      {lines.map((l, i) => <text key={i} x={x - 4} y={top + i * 14} textAnchor="end" fontSize={12.5} fontWeight={600} fill="var(--text)">{l}</text>)}
      {r.range && <text x={x - 4} y={top + lines.length * 14 - 1} textAnchor="end" fontSize={10.5} fill="var(--muted, #6b7068)">{r.range}</text>}
    </g>
  );
}

/** The growing location to show: the prediction's own ``growing_location`` factor, else the place the weather or soil answer was for. */
function growingInfo(growing, w, sd) {
  if (growing) return growing;
  const d = [w, sd].find((x) => x?.place_kind === "growing_location" && x.place);
  return d ? { available: true, value: d.place, latitude: d.latitude, longitude: d.longitude, source: null } : null;
}

/**
 * "Field Conditions": ONE horizontal bar chart with a row per condition (temperature, humidity, rainfall, soil pH, soil type, growing location).
 * Temperature, humidity and rainfall come from the weather service for the farmer's growing location and the selling date (recorded, forecast
 * or, for older requests at a market, typical); soil pH and soil type are regional SoilGrids estimates, not field measurements. Requests made
 * before the growing location existed use the selling market's town and say so. Numbers use their own scale, soil type is a category label,
 * and anything missing is a dashed "Unavailable" row, never 0. The conditions are shown for context only: the price model does not use them,
 * and nothing here is a SHAP value, a score, a correlation or a price effect.
 */
export default function FieldConditionsOverview({ weather, soil, growing = null }) {
  const t = useT();
  const narrow = useNarrow();
  const w = weather?.data;
  const wxLoading = weather?.state === "loading";
  const wxOk = weather?.state === "ok" && w && w.status !== "unavailable" && w.temperature_c != null;
  const sd = soil?.data;
  const soilLoading = soil?.state === "loading";
  const soilOk = soil?.state === "ok" && sd && sd.status === "estimate";
  const wxStatus = wxOk ? "ok" : wxLoading ? "loading" : "unavailable";
  const phStatus = soilOk && sd.ph != null ? "ok" : soilLoading ? "loading" : "unavailable";
  const soilStatus = soilOk && sd.soil_type ? "ok" : soilLoading ? "loading" : "unavailable";
  const missing = (status) => (status === "loading" ? "…" : t("fc.unavailable"));
  const range = (id) => `${RANGES[id][0]}–${RANGES[id][1]}${RANGES[id][2] ? ` ${RANGES[id][2]}` : ""}`;
  const g = growingInfo(growing, w, sd);
  const gOk = Boolean(g?.available && g.value);
  const gShort = gOk ? String(g.value).split(",")[0] : null;     // the place name itself; the full label is in the source line below
  const locStatus = gOk ? "ok" : (wxLoading || soilLoading) && !g ? "loading" : "unavailable";
  const locText = gOk ? gShort : locStatus === "loading" ? "…" : g || narrow ? t("fc.unavailable") : t("fc.locationValue");

  const num = (id, label, status, v, text) => ({ id, label, kind: "num", status, span: 100, range: range(id),
    pct: status === "ok" ? clampPct(id, v) : null, valueText: status === "ok" ? text : missing(status) });
  const rows = [
    num("temperature", t("fc.temperature"), wxStatus, w?.temperature_c, `${w?.temperature_c} °C`),
    num("humidity", t("fc.humidity"), wxStatus, w?.humidity_pct, `${w?.humidity_pct}%`),
    num("rainfall", t("fc.rainfall"), wxStatus, w?.rainfall_mm, `${w?.rainfall_mm} mm`),
    num("ph", t("fc.ph"), phStatus, sd?.ph, `${sd?.ph}`),
    { id: "soil", label: t("fc.soil"), kind: "cat", status: soilStatus, span: 100, range: null, pct: null, valueText: soilStatus === "ok" ? sd.soil_type : missing(soilStatus) },
    { id: "location", label: t("fc.location"), kind: "cat", status: locStatus, span: 100, range: null, pct: null, valueText: locText },
  ];
  // where each group of values came from, in plain words: what it is, for which date, from which source, and whether it was just fetched
  // or saved earlier. When nothing trustworthy exists, a friendly reason instead of an error message.
  const served = (d) => (d.served_from === "cache" && d.retrieved_at ? t("fc.prov.cache", { when: fmtDateTime(d.retrieved_at) })
    : d.served_from === "stored_history" ? t("fc.prov.history") : t("fc.prov.live"));
  const reasonText = (r) => t(`fc.reason.${r || "no_data"}`);
  const weatherLine = wxLoading ? null : wxOk
    ? t(`fc.prov.weather.${w.status}`, { date: fmtDate(w.date), source: w.source, served: served(w) })
      + (w.status === "typical" && w.reason === "service_unreachable" ? ` ${t("fc.reason.typicalBecauseDown")}` : "")
    : t("fc.prov.weatherNone", { why: reasonText(w?.reason || (weather?.state === "error" ? "service_unreachable" : null)) });
  const soilLine = soilLoading ? null : soilOk
    ? t("fc.prov.soil", { scope: t(`fc.scope.${sd.place_kind === "growing_location" ? "growing." : ""}${sd.ph_scope || "town_centre"}`, { km: sd.ph_area_km ?? 2 }), served: served(sd) })
      + (sd.ph == null ? ` ${t(`fc.reason.ph.${sd.ph_reason || "not_in_map"}`)}` : "")
    : t("fc.prov.soilNone", { why: reasonText(sd?.reason || (soil?.state === "error" ? "service_unreachable" : null)) });
  const locationLine = gOk
    ? t("fc.prov.location", { place: g.value, coords: g.latitude != null ? fmtCoords(g.latitude, g.longitude) : "", source: g.source || t("fc.prov.locationSearch") })
    : g ? t("fc.prov.locationNone", { place: g.entered || "", why: reasonText(g.reason) })
      : locStatus === "loading" ? null : t("fc.srcLocationShort");
  const sources = [["location", locationLine], ["weather", weatherLine], ["soil", soilLine]].filter(([, line]) => line);

  return (
    <div data-testid="field-conditions">
      <div style={{ width: "100%", height: rows.length * 46 + 8 }} role="img" aria-label={t("fc.title")}>
        <ResponsiveContainer>
          <BarChart layout="vertical" data={rows} margin={{ top: 4, right: narrow ? 74 : 92, bottom: 4, left: 0 }} barCategoryGap="22%">
            <XAxis type="number" domain={[0, 100]} hide />
            <YAxis type="category" dataKey="id" width={narrow ? 92 : 112} tickLine={false} axisLine={false} interval={0}
              tick={(p) => <RowLabel {...p} rows={rows} />} />
            <Bar dataKey="span" isAnimationActive={false} barSize={26} shape={(p) => <RowShape {...p} />} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="muted small" style={{ margin: "0.1rem 0 0" }} data-testid="fc-scale-note">{t("fc.scaleNote")}</p>
      <ul className="muted small" style={{ margin: "0.3rem 0 0", paddingLeft: "1.1rem" }} data-testid="fc-sources">
        {sources.map(([id, line]) => <li key={id} data-testid={`fc-src-${id}`}>{line}</li>)}
      </ul>
      <p className="small" style={{ margin: "0.5rem 0 0", padding: "0.6rem 0.8rem", background: "#f1f0e3", borderRadius: 12, lineHeight: 1.5 }} data-testid="fc-note">{t("fc.note")}</p>
    </div>
  );
}
