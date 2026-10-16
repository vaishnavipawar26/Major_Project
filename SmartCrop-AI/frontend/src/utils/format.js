const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export const rupees = (v) => (v == null || Number.isNaN(v) ? "—" : `₹${inr.format(v)}`);
export const perQuintal = (v) => (v == null ? "—" : `${rupees(v)} / quintal`);
export const pct = (v, digits = 1) =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(digits)}%`;
export const score = (v) => (v == null ? "—" : Math.round(v).toString());

// Display locale for dates and month names, set by the language provider. Digits stay 0-9 in every
// language ("-u-nu-latn") so prices and dates read the same as on mandi slips. Numbers always use en-IN.
let dateLocale = "en-IN";
let uiLang = "en";
export function setFormatLanguage(lang) {
  uiLang = lang;
  dateLocale = lang === "en" ? "en-IN" : `${lang}-IN-u-nu-latn`;
}

export function fmtDate(iso, opts = { day: "numeric", month: "short", year: "numeric" }) {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(dateLocale, opts);
}
export const shortDate = (iso) => fmtDate(iso, { day: "numeric", month: "short" });
export const fmtDateTime = (iso) =>
  fmtDate(iso, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export const titleCase = (s) => (s ? s.replace(/\b\w/g, (c) => c.toUpperCase()) : s);

export const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const intlMonth = (m, style) => new Intl.DateTimeFormat(dateLocale, { month: style, timeZone: "UTC" }).format(Date.UTC(2020, m - 1, 1));
/** Month number 1-12 -> short name in the display language ("Mar" in English). */
export const monthShort = (m) => (uiLang === "en" ? SHORT_MONTHS[m - 1] : intlMonth(m, "short"));
/** Month number 1-12 -> full name in the display language ("March" in English). */
export const monthLong = (m) => (uiLang === "en" ? LONG_MONTHS[m - 1] : intlMonth(m, "long"));
/** "2027-03" -> "Mar 2027" */
export const monthLabel = (ym) => {
  if (!ym) return "—";
  const [y, m] = ym.split("-").map(Number);
  return `${monthShort(m)} ${y}`;
};

/** Display name of a crop or city in the chosen language; the original (API) value is never changed. */
export const cropName = (t, name, kind = "crop") => {
  if (!name) return name;
  const key = `name.${kind}.${name}`;
  const v = t(key);
  return v === key ? name : v;
};
/** Compact rupees: ₹1.2L, ₹45K */
export const compactRupees = (v) => {
  if (v == null || Number.isNaN(v)) return "—";
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${s}₹${Math.round(a / 1e3)}K`;
  return `${s}₹${Math.round(a)}`;
};
export const signedRupees = (v) => (v == null ? "—" : `${v < 0 ? "−" : ""}${rupees(Math.abs(v))}`);

/** Recommended crops of a saved recommendation (older records: the stored top 3). */
export const topCrops = (results) =>
  results.some((x) => x.recommended != null) ? results.filter((x) => x.recommended) : results.slice(0, 3);

/** ISO date arithmetic in UTC so time zones never shift the calendar day. */
export const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const daysBetween = (fromIso, toIso) =>
  Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);
/** [3, 4, 5, 9, 10] -> "3–5, 9–10" */
export const dayRanges = (days) => {
  const out = [];
  days.forEach((d) => {
    const last = out[out.length - 1];
    if (last && d === last[1] + 1) last[1] = d;
    else out.push([d, d]);
  });
  return out.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(", ");
};

/** Small source note for a price forecast, or null when it is the usual case (this market, recent reports, trained model). */
export function priceSourceKey(source) {
  if (!source || !source.fallback) return null;
  if (source.method === "historical_baseline") return "price.src.estimate";
  if (source.kind === "state_median") return "price.src.state";
  if (source.kind === "other_market") return "price.src.other";
  return "price.src.market";
}
