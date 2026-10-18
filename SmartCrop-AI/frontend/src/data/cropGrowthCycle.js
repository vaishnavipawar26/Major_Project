/**
 * Typical biological growing cycle of each supported crop, independent of the user's dates.
 *
 * All day ranges are TYPICAL ESTIMATES for Maharashtra-type conditions and common varieties;
 * real durations vary with variety, season, climate and management. Days are counted from the day
 * the crop goes into the field (transplanting for nursery-raised crops, sowing/planting otherwise).
 * `nurseryDays` is the time in the nursery before transplanting (null = sown directly in the field).
 *
 * Each stage: { key, from, to } in days after field planting, as [min, max] ranges where the
 * timing varies. `harvest.firstDays` is when the first harvest typically starts and
 * `harvest.lastDays` when harvesting typically ends (for crops picked repeatedly).
 *
 * `compareWithCycle` uses these day ranges (not the user's selling month) to place the crop's typical
 * harvest on the calendar and compare it with the selling month. Whether a crop can be stored, and for
 * how long, comes from the backend crop calendar (dataset/crop_recommendation/crop_season_calendar.csv,
 * returned in `timeline.storable` / `timeline.max_storage_months`).
 */
export const GROWTH_CYCLE = {
  Brinjal: {
    nurseryDays: [30, 35],
    stages: [
      { key: "establish", from: [0, 0], to: [10, 15] },
      { key: "vegetative", from: [10, 15], to: [40, 45] },
      { key: "flowering", from: [40, 45], to: [55, 60] },
    ],
    harvest: { firstDays: [55, 60], lastDays: [120, 150], repeated: true },
    sources: ["tnauBrinjal"],
  },
  Tomato: {
    nurseryDays: [25, 30],
    stages: [
      { key: "establish", from: [0, 0], to: [10, 15] },
      { key: "vegetative", from: [10, 15], to: [30, 40] },
      { key: "flowering", from: [30, 40], to: [60, 75] },
    ],
    harvest: { firstDays: [60, 75], lastDays: [120, 150], repeated: true },
    sources: ["generalVeg"],
  },
  Cabbage: {
    nurseryDays: [25, 35],
    stages: [
      { key: "establish", from: [0, 0], to: [10, 15] },
      { key: "vegetative", from: [10, 15], to: [45, 55] },
      { key: "head", from: [45, 55], to: [80, 110] },
    ],
    harvest: { firstDays: [80, 110], lastDays: [90, 120], repeated: false },
    sources: ["generalVeg", "appCalendar"],
  },
  Cauliflower: {
    nurseryDays: [25, 35],
    stages: [
      { key: "establish", from: [0, 0], to: [10, 15] },
      { key: "vegetative", from: [10, 15], to: [45, 60] },
      { key: "curd", from: [45, 60], to: [80, 120] },
    ],
    harvest: { firstDays: [80, 120], lastDays: [90, 130], repeated: false },
    sources: ["generalVeg", "appCalendar"],
  },
  Onion: {
    nurseryDays: [42, 63], // about 6-7 weeks (Kharif) to 8-9 weeks (Rabi)
    stages: [
      { key: "establish", from: [0, 0], to: [10, 15] },
      { key: "vegetative", from: [10, 15], to: [50, 60] },
      { key: "bulb", from: [50, 60], to: [90, 130] },
    ],
    harvest: { firstDays: [90, 130], lastDays: [100, 130], repeated: false },
    sources: ["nhbOnion", "nhrdfOnion"],
  },
  Potato: {
    nurseryDays: null,
    stages: [
      { key: "emergence", from: [0, 0], to: [10, 20] },
      { key: "vegetative", from: [10, 20], to: [35, 45] },
      { key: "tuber", from: [35, 45], to: [75, 110] },
    ],
    harvest: { firstDays: [75, 110], lastDays: [85, 120], repeated: false },
    sources: ["cpriPotato"],
  },
  Wheat: {
    nurseryDays: null,
    stages: [
      { key: "emergence", from: [0, 0], to: [20, 25] },
      { key: "tillering", from: [20, 25], to: [60, 75] },
      { key: "heading", from: [60, 75], to: [85, 95] },
      { key: "grainFill", from: [85, 95], to: [105, 125] },
    ],
    harvest: { firstDays: [105, 125], lastDays: [110, 135], repeated: false },
    sources: ["tnauWheat", "mpkvWheat", "tnauWheatStages", "faoWheat"],
  },
};

/** Reference documents behind the numbers (shown under the timeline). */
export const SOURCES = {
  tnauBrinjal: { label: "TNAU Agritech Portal — Brinjal", url: "https://agritech.tnau.ac.in/horticulture/horti_vegetables_brinjal.html" },
  nhbOnion: { label: "National Horticulture Board — Onion", url: "https://nhb.gov.in/pdf/vegetable/onion/oni011.pdf" },
  nhrdfOnion: { label: "NHRDF onion varieties (via ICAR Indian Horticulture)", url: "https://epubs.icar.org.in/index.php/IndHort/article/download/115081/44852/473200" },
  cpriPotato: { label: "ICAR-CPRI potato varieties", url: "https://indianpotato.com/potato-varieties-india/cpri/" },
  tnauWheat: { label: "TNAU Agritech Portal — Wheat varieties", url: "https://agritech.tnau.ac.in/agriculture/agri_seasonandvarieties_wheat.html" },
  mpkvWheat: { label: "MPKV Rahuri — Wheat research (Maharashtra)", url: "https://mpkv.ac.in/Uploads/Research/04%20-%20Wheat_20250822024052.pdf" },
  tnauWheatStages: { label: "TNAU Agritech Portal — Wheat irrigation and growth stages", url: "https://agritech.tnau.ac.in/agriculture/agri_irrigationmgt_wheat.html" },
  faoWheat: { label: "FAO — Wheat growth stages", url: "https://www.fao.org/4/Y4011E/y4011e06.htm" },
  generalVeg: { label: "General vegetable production guides (nursery and harvest ranges vary between sources)", url: null },
  appCalendar: { label: "SmartCrop crop calendar (dataset/crop_recommendation/crop_season_calendar.csv)", url: null },
};

/** The growth cycle for a crop name from the API, or null when no reliable data is available. */
export function growthCycleFor(cropName) {
  if (!cropName) return null;
  const key = Object.keys(GROWTH_CYCLE).find((k) => k.toLowerCase() === String(cropName).trim().toLowerCase());
  return key ? { crop: key, ...GROWTH_CYCLE[key] } : null;
}

const DAY = 86400000;
export const DAYS_PER_MONTH = 30.4;
/** Planting/transplanting is assumed to happen around the middle of the planting month. */
export const PLANTING_DAY = 15;
const ymParts = (ym) => ym.split("-").map(Number);
const utc = (y, m, d) => Date.UTC(y, m - 1, d);

/**
 * Month -> Indian cropping season, the same convention as backend/app/ml/common/seasons.py
 * (Kharif Jun–Sep, Rabi Oct–Jan, Zaid Feb–May).
 */
const SEASON_OF_MONTH = { 6: "kharif", 7: "kharif", 8: "kharif", 9: "kharif", 10: "rabi", 11: "rabi", 12: "rabi", 1: "rabi",
  2: "zaid", 3: "zaid", 4: "zaid", 5: "zaid" };

/**
 * The crop's main planting window from its usual planting months (backend crop calendar,
 * `timeline.planting_months`): the longest run of consecutive months, wrapping over December.
 * Crops planted in several seasons (e.g. brinjal: Jun–Jul, Sep–Nov, Jan–Feb) get their longest run;
 * ties go to the run that starts first in the agricultural year (June onwards).
 * Returns { months: [...in order], season } or null when no months are known.
 */
export function mainPlantingWindow(plantingMonths) {
  const set = new Set((plantingMonths || []).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12));
  if (!set.size) return null;
  const next = (m) => (m % 12) + 1;
  const prev = (m) => ((m + 10) % 12) + 1;
  const runs = [];
  if (set.size === 12) runs.push([6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5]);
  else {
    for (const start of set) {
      if (set.has(prev(start))) continue; // not the first month of a run
      const run = [start];
      while (set.has(next(run.at(-1)))) run.push(next(run.at(-1)));
      runs.push(run);
    }
  }
  const agriOrder = (m) => (m - 6 + 12) % 12; // June = 0
  runs.sort((x, y) => y.length - x.length || agriOrder(x[0]) - agriOrder(y[0]));
  const months = runs[0];
  const count = {};
  months.forEach((m) => { count[SEASON_OF_MONTH[m]] = (count[SEASON_OF_MONTH[m]] || 0) + 1; });
  const season = ["kharif", "rabi", "zaid"].reduce((best, s) => ((count[s] || 0) > (count[best] || 0) ? s : best), SEASON_OF_MONTH[months[0]]);
  return { months, season };
}

const mid = ([a, b]) => (a + b) / 2;

/**
 * Typical calendar months of every growth stage, worked out from the crop's day ranges and its main
 * planting window — never from the user's dates. Planting is taken from the middle of the first to
 * the middle of the last planting month; each stage then runs from (earliest planting + typical start)
 * to (latest planting + typical end), using the middle of each day range. Real dates are used, so
 * stages that run past December land in the next year (`refYear` is the year planting starts).
 *
 * Returns { season, stages: [{ key, start: {year, month}, end: {year, month}, span }] }, where span is
 * the number of calendar months covered; or null when the crop has no stage data or no planting months.
 */
export function stageCalendar(cycle, plantingMonths, refYear = 2026) {
  const win = mainPlantingWindow(plantingMonths);
  if (!cycle || !win) return null;
  const first = win.months[0];
  const last = win.months.at(-1);
  const early = utc(refYear, first, PLANTING_DAY);
  const late = utc(refYear + (last < first ? 1 : 0), last, PLANTING_DAY);
  const at = (t) => { const d = new Date(t); return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }; };
  const stage = (key, from, to) => {
    const start = at(from);
    const end = at(to);
    return { key, start, end, span: (end.year - start.year) * 12 + end.month - start.month + 1 };
  };
  const h = cycle.harvest;
  const stages = [
    ...(cycle.nurseryDays ? [stage("nursery", early - mid(cycle.nurseryDays) * DAY, late)] : []),
    stage(cycle.nurseryDays ? "transplant" : "sowing", early, late),
    ...cycle.stages.map((s) => stage(s.key, early + mid(s.from) * DAY, late + mid(s.to) * DAY)),
    stage("harvest", early + mid(h.firstDays) * DAY, late + mid(h.lastDays) * DAY),
  ];
  return { season: win.season, repeated: h.repeated, stages };
}

/** "55–60" or "60" for a [min, max] range. */
export const rangeText = ([a, b]) => (a === b ? `${a}` : `${a}–${b}`);

/** "YYYY-MM" of the date `days` after the planting date. */
const ymAfter = (planted, days) => {
  const d = new Date(planted + days * DAY);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/**
 * Compare the user's selling month with the crop's TYPICAL BIOLOGICAL harvest timing.
 *
 * The harvest window is placed on the calendar from the crop's own day ranges, counted from planting
 * (or transplanting) on day PLANTING_DAY of the planting month — the selling month is never used to
 * work it out. Real dates are used, so a selling month in the following year is handled correctly.
 *
 * `plantingYm` / `sellingYm` are "YYYY-MM" (the API timeline's `planting` and `selling`).
 * `storage` = { storable, maxMonths } from the backend crop calendar.
 *
 * verdict:
 *   "early"      the selling month ends before even the earliest typical first harvest
 *   "borderline" the selling month ends before the middle of the first-harvest range, so only
 *                early-maturing fields would be ready
 *   "within"     the selling month overlaps the typical harvest (or picking) period
 *   "later"      the selling month starts after the latest typical end of harvest; then
 *                storage = "possible" | "tooLong" | "perishable"
 * Returns null when the crop has no growth data or the dates are missing.
 */
export function compareWithCycle(cycle, plantingYm, sellingYm, storage = {}) {
  if (!cycle || !plantingYm || !sellingYm) return null;
  const [py, pm] = ymParts(plantingYm);
  const [sy, sm] = ymParts(sellingYm);
  const planted = utc(py, pm, PLANTING_DAY);
  const sellStart = Math.round((utc(sy, sm, 1) - planted) / DAY);
  const sellEnd = Math.round((utc(sy, sm + 1, 0) - planted) / DAY); // last day of the selling month
  const { firstDays, lastDays, repeated } = cycle.harvest;
  const out = {
    sellStart, sellEnd, repeated,
    harvestStart: ymAfter(planted, firstDays[0]), // earliest typical first harvest
    harvestEnd: ymAfter(planted, lastDays[1]), // latest typical end of harvest
  };
  if (sellEnd < firstDays[0]) return { ...out, verdict: "early", daysShort: firstDays[0] - sellEnd };
  if (sellEnd < (firstDays[0] + firstDays[1]) / 2) return { ...out, verdict: "borderline" };
  if (sellStart <= lastDays[1]) return { ...out, verdict: "within" };
  const daysAfter = sellStart - lastDays[1];
  const monthsAfter = Math.max(1, Math.round(daysAfter / DAYS_PER_MONTH));
  const maxDays = (storage.maxMonths || 0) * DAYS_PER_MONTH;
  const kind = !storage.storable || !storage.maxMonths ? "perishable" : daysAfter <= maxDays ? "possible" : "tooLong";
  return { ...out, verdict: "later", daysAfter, monthsAfter, storage: kind };
}

/** Same verdict family as the API's month-calendar status (fresh / not_ready / stored / spoiled). */
export const calendarVerdict = (status) => ({ fresh: "within", not_ready: "early", stored: "later", spoiled: "later" }[status] || null);
