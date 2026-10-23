/** Field size: acres internally (what the API takes), with guntha as a way to type and read it. 1 acre = 40 guntha. */
export const GUNTHA_PER_ACRE = 40;
// The API accepts any area above 0 and up to 1,000 acres. The form's floor is the smallest size in the guntha table (1/2 guntha),
// so a very small plot is allowed but "0" and rounding-to-nothing are not.
export const AREA_MIN = 0.0125;
export const AREA_MAX = 1000;

export const factorOf = (unit) => (unit === "guntha" ? GUNTHA_PER_ACRE : 1);

/** A number with at most 4 decimals and no trailing zeros ("0.5", "20", "0.025", "0.0125"): 1/2 guntha is 0.0125 acre, which needs the fourth. */
export const fmtNum = (n) => String(Number(Number(n).toFixed(4)));
/** Same, with Indian digit grouping for big values ("40,000"). */
export const fmtBig = (n) => Number(fmtNum(n)).toLocaleString("en-IN", { maximumFractionDigits: 4 });

/** Text typed in `unit` -> the acres string sent on ("" stays "", text that is not a number is passed through so validation can name it). */
export function toAcres(text, unit) {
  const s = String(text ?? "").trim();
  if (s === "") return "";
  const n = Number(s);
  return Number.isFinite(n) ? String(Number((n / factorOf(unit)).toFixed(6))) : s;
}

/** Acres string -> the text to show in `unit`. */
export const fromAcres = (acres, unit) => (Number.isFinite(Number(acres)) && String(acres).trim() !== "" ? fmtNum(Number(acres) * factorOf(unit)) : String(acres ?? ""));

/** The same area in the other unit for the line under the input ("= 20 guntha" / "= 0.5 acre"), or null when the text is not a usable number. */
export function otherUnit(text, unit) {
  const n = Number(String(text ?? "").trim());
  if (String(text ?? "").trim() === "" || !Number.isFinite(n) || n <= 0) return null;
  return unit === "guntha" ? { value: fmtNum(n / GUNTHA_PER_ACRE), unit: "acre" } : { value: fmtNum(n * GUNTHA_PER_ACRE), unit: "guntha" };
}

/** Step: 1 in guntha, 0.5 in acres; stays within the limits. Returns the new text in `unit`. */
export function bump(text, unit, dir) {
  const f = factorOf(unit), step = unit === "guntha" ? 1 : 0.5;
  const n = Number(String(text ?? "").trim());
  const cur = Number.isFinite(n) ? n : 0;
  const next = Math.min(AREA_MAX * f, Math.max(AREA_MIN * f, cur + dir * step));
  return fmtNum(next);
}

/** The guntha-to-acre table: [guntha, acres]. */
export const TABLE = [0.5, 1, 10, 20, 40].map((g) => [g, g / GUNTHA_PER_ACRE]);

/** Friendly error in the selected unit for the raw acres string, or null. `t` is the translator. */
export function areaError(acres, unit, t) {
  const label = t("crop.form.validLabel.area_acres");
  if (acres === "" || acres == null) return t("valid.required", { label });
  const n = Number(acres);
  if (Number.isNaN(n)) return t("valid.number", { label });
  if (n < AREA_MIN || n > AREA_MAX) {
    const f = factorOf(unit);
    return t("crop.form.areaRange", { min: fmtBig(AREA_MIN * f), max: fmtBig(AREA_MAX * f), unit: t(unit === "guntha" ? "crop.form.gunthaWord" : "crop.form.acresWord") });
  }
  return null;
}
