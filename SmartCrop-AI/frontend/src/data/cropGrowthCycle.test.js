import { describe, expect, it } from "vitest";
import {
  calendarVerdict, compareWithCycle, GROWTH_CYCLE, growthCycleFor, mainPlantingWindow, PLANTING_DAY, stageCalendar,
} from "./cropGrowthCycle";

const DAY = 86400000;
const brinjal = growthCycleFor("Brinjal");
const wheat = growthCycleFor("Wheat");
// storage facts as the backend crop calendar returns them (crop_season_calendar.csv)
const PERISHABLE = { storable: false, maxMonths: 0 };
const WHEAT_STORE = { storable: true, maxMonths: 9 };

/** Days from planting (day PLANTING_DAY) to the first and last day of the selling month — independent re-computation. */
const sellDays = (plantYm, sellYm) => {
  const [py, pm] = plantYm.split("-").map(Number);
  const [sy, sm] = sellYm.split("-").map(Number);
  const planted = Date.UTC(py, pm - 1, PLANTING_DAY);
  return [(Date.UTC(sy, sm - 1, 1) - planted) / DAY, (Date.UTC(sy, sm, 0) - planted) / DAY];
};

describe("growth data", () => {
  it.each(Object.entries(GROWTH_CYCLE))("%s: stages are contiguous and end where harvest starts", (_, c) => {
    c.stages.forEach((s, i) => {
      expect(s.from[0]).toBeLessThanOrEqual(s.to[0]);
      expect(s.from[1]).toBeLessThanOrEqual(s.to[1]);
      if (i > 0) expect(s.from).toEqual(c.stages[i - 1].to);
    });
    expect(c.stages.at(-1).to).toEqual(c.harvest.firstDays);
    expect(c.harvest.firstDays[1]).toBeLessThanOrEqual(c.harvest.lastDays[1]);
    expect(c.sources.length).toBeGreaterThan(0);
  });

  it("brinjal is picked repeatedly; wheat is harvested once", () => {
    expect(brinjal.harvest.repeated).toBe(true);
    expect(wheat.harvest.repeated).toBe(false);
  });

  it("unknown crops give no data instead of a guess; names match case-insensitively", () => {
    expect(growthCycleFor("Mango")).toBeNull();
    expect(growthCycleFor(null)).toBeNull();
    expect(growthCycleFor(" wheat ").crop).toBe("Wheat");
  });
});

describe("compareWithCycle — the four requested cases", () => {
  it("Test 1: Brinjal planted June, sold October is within the repeated picking period", () => {
    const c = compareWithCycle(brinjal, "2027-06", "2027-10", PERISHABLE);
    const [start, end] = sellDays("2027-06", "2027-10");
    // what the data says: October overlaps first-harvest..end-of-picking
    expect(end >= brinjal.harvest.firstDays[1] && start <= brinjal.harvest.lastDays[1]).toBe(true);
    expect(c.verdict).toBe("within");
    expect(c.repeated).toBe(true);
  });

  it("Test 2: Brinjal planted June, sold July is too early — and only because the data says so", () => {
    const c = compareWithCycle(brinjal, "2027-06", "2027-07", PERISHABLE);
    const [, end] = sellDays("2027-06", "2027-07");
    expect(end).toBeLessThan(brinjal.harvest.firstDays[0]); // whole of July is before the earliest first picking
    expect(c.verdict).toBe("early");
    expect(c.daysShort).toBe(brinjal.harvest.firstDays[0] - end);
  });

  it("Test 3: Wheat planted October, sold next September — harvested months earlier; storage only as a condition", () => {
    const c = compareWithCycle(wheat, "2026-10", "2027-09", WHEAT_STORE);
    const [start] = sellDays("2026-10", "2027-09");
    expect(c.verdict).toBe("later");
    expect(c.daysAfter).toBe(start - wheat.harvest.lastDays[1]);
    expect(c.monthsAfter).toBe(Math.round(c.daysAfter / 30.4));
    expect(c.storage).toBe("possible"); // within the 9-month storage limit, so selling then is *possible* with storage
    // the harvest window is placed from the crop's own durations, in the year after planting
    expect(c.harvestStart.startsWith("2027-0")).toBe(true);
    expect(c.harvestEnd < "2027-09").toBe(true);
  });

  it("Test 4: Brinjal planted October, sold next September — far later than one planting cycle, and perishable", () => {
    const c = compareWithCycle(brinjal, "2026-10", "2027-09", PERISHABLE);
    expect(c.verdict).toBe("later");
    expect(c.storage).toBe("perishable");
    expect(c.monthsAfter).toBeGreaterThanOrEqual(3); // "substantially later"
  });
});

describe("compareWithCycle — calendar and edge cases", () => {
  it("handles a selling month in the following calendar year", () => {
    // Nov 15 2026 -> Feb 2027: days 78..105 after planting, not negative
    const c = compareWithCycle(growthCycleFor("Potato"), "2026-11", "2027-02", { storable: true, maxMonths: 3 });
    expect([c.sellStart, c.sellEnd]).toEqual(sellDays("2026-11", "2027-02"));
    expect(c.sellStart).toBeGreaterThan(0);
    expect(c.harvestStart.startsWith("2027-")).toBe(true);
  });

  it("the selling month does not change the crop's own harvest window", () => {
    const a = compareWithCycle(wheat, "2026-10", "2027-01", WHEAT_STORE);
    const b = compareWithCycle(wheat, "2026-10", "2027-09", WHEAT_STORE);
    expect([a.harvestStart, a.harvestEnd]).toEqual([b.harvestStart, b.harvestEnd]);
  });

  it.each(Object.keys(GROWTH_CYCLE))("%s: a month entirely before first harvest is early, entirely after harvest is later", (name) => {
    const cyc = growthCycleFor(name);
    // planting in January 2027; pick months by the data, not by hand
    const monthAt = (days) => { const d = new Date(Date.UTC(2027, 0, PLANTING_DAY) + days * DAY); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
    const beforeHarvest = monthAt(cyc.harvest.firstDays[0] - 40);
    const afterHarvest = monthAt(cyc.harvest.lastDays[1] + 40);
    expect(compareWithCycle(cyc, "2027-01", beforeHarvest, PERISHABLE).verdict).toBe("early");
    expect(compareWithCycle(cyc, "2027-01", afterHarvest, PERISHABLE).verdict).toBe("later");
  });

  it("ending before the middle of the first-harvest range is 'borderline', not 'too early' and not 'ready'", () => {
    // planted Jan 15; March ends on day 75
    const at = (first) => compareWithCycle({ harvest: { firstDays: first, lastDays: [120, 150], repeated: true } }, "2027-01", "2027-03", PERISHABLE).verdict;
    expect(at([55, 60])).toBe("within"); // day 75 is past the whole first-harvest range
    expect(at([70, 90])).toBe("borderline"); // past the earliest (70) but before the middle (80)
    expect(at([60, 80])).toBe("within"); // past the middle (70)
    expect(at([80, 90])).toBe("early"); // before even the earliest first harvest
  });

  it("storable crops kept longer than their storage limit are flagged", () => {
    const c = compareWithCycle(growthCycleFor("Onion"), "2026-10", "2027-09", { storable: true, maxMonths: 4 });
    expect(c.verdict).toBe("later");
    expect(c.storage).toBe("tooLong");
  });

  it("returns null without data or dates, and maps the API calendar status", () => {
    expect(compareWithCycle(null, "2027-01", "2027-03")).toBeNull();
    expect(compareWithCycle(brinjal, null, "2027-03")).toBeNull();
    expect(calendarVerdict("not_ready")).toBe("early");
    expect(calendarVerdict("spoiled")).toBe("later");
    expect(calendarVerdict("unknown")).toBeNull();
  });
});

// usual planting months exactly as the backend crop calendar returns them (crop_season_calendar.csv)
const PLANTING = {
  Brinjal: [6, 7, 9, 10, 11, 1, 2], Cabbage: [6, 7, 9, 10, 11, 1], Cauliflower: [6, 7, 8, 9, 10, 11],
  Onion: [6, 7, 9, 10, 11, 12, 1], Potato: [6, 7, 10, 11, 12], Tomato: [6, 7, 9, 10, 11, 12, 1, 2], Wheat: [10, 11, 12],
};
const ym = (p) => p.year * 12 + p.month; // comparable month index

describe("mainPlantingWindow", () => {
  it("picks the longest run of consecutive planting months, wrapping over December", () => {
    expect(mainPlantingWindow(PLANTING.Wheat)).toEqual({ months: [10, 11, 12], season: "rabi" });
    expect(mainPlantingWindow(PLANTING.Onion).months).toEqual([9, 10, 11, 12, 1]); // Sep..Jan crosses the year
    expect(mainPlantingWindow(PLANTING.Brinjal).months).toEqual([9, 10, 11]); // longest of Jun-Jul / Sep-Nov / Jan-Feb
  });
  it("breaks ties by the agricultural year (June first) and labels the season by most months", () => {
    expect(mainPlantingWindow([6, 7, 10, 11])).toEqual({ months: [6, 7], season: "kharif" });
    expect(mainPlantingWindow([6, 7, 8, 9, 10, 11]).season).toBe("kharif");
  });
  it("returns null when no planting months are known", () => {
    expect(mainPlantingWindow([])).toBeNull();
    expect(mainPlantingWindow(undefined)).toBeNull();
    expect(mainPlantingWindow([0, 13])).toBeNull();
  });
});

describe("stageCalendar — typical months of each stage", () => {
  it("Wheat in its Rabi season: sown Oct–Dec, harvested in the following Feb–Apr", () => {
    const cal = stageCalendar(wheat, PLANTING.Wheat, 2026);
    expect(cal.season).toBe("rabi");
    const by = Object.fromEntries(cal.stages.map((s) => [s.key, s]));
    expect(cal.stages.map((s) => s.key)).toEqual(["sowing", "emergence", "tillering", "heading", "grainFill", "harvest"]);
    expect([by.sowing.start, by.sowing.end]).toEqual([{ year: 2026, month: 10 }, { year: 2026, month: 12 }]);
    // harvest is worked out from the crop's day ranges and lands in the next calendar year
    expect(by.harvest.start.year).toBe(2027);
    expect(by.harvest.start.month).toBeGreaterThanOrEqual(1);
    expect(by.harvest.end.month).toBeLessThanOrEqual(4);
  });

  it("Brinjal: nursery and transplanting first, a flowering/fruiting stage, then repeated picking", () => {
    const cal = stageCalendar(brinjal, PLANTING.Brinjal, 2026);
    expect(cal.repeated).toBe(true);
    expect(cal.stages.map((s) => s.key)).toEqual(["nursery", "transplant", "establish", "vegetative", "flowering", "harvest"]);
    expect(cal.stages[0].start.month).toBe(8); // nursery sown about a month before the Sep transplanting
  });

  it("uses crop-appropriate stages (no flowering label forced on wheat, potato, onion, cabbage or cauliflower)", () => {
    const keys = (c) => stageCalendar(growthCycleFor(c), PLANTING[c]).stages.map((s) => s.key);
    expect(keys("Wheat")).not.toContain("flowering");
    expect(keys("Potato")).toEqual(["sowing", "emergence", "vegetative", "tuber", "harvest"]);
    expect(keys("Onion")).toContain("bulb");
    expect(keys("Cabbage")).toContain("head");
    expect(keys("Cauliflower")).toContain("curd");
  });

  it.each(Object.keys(GROWTH_CYCLE))("%s: stages are in calendar order and each start is not after its end", (name) => {
    const cal = stageCalendar(growthCycleFor(name), PLANTING[name], 2026);
    cal.stages.forEach((s, i) => {
      expect(ym(s.start)).toBeLessThanOrEqual(ym(s.end));
      expect(s.span).toBe(ym(s.end) - ym(s.start) + 1);
      if (i > 0) expect(ym(s.start)).toBeGreaterThanOrEqual(ym(cal.stages[i - 1].start));
    });
    expect(cal.stages.at(-1).key).toBe("harvest");
  });

  it("months that run past December move into the next year (Onion planted Sep–Jan)", () => {
    const cal = stageCalendar(growthCycleFor("Onion"), PLANTING.Onion, 2026);
    const transplant = cal.stages.find((s) => s.key === "transplant");
    expect(transplant.start).toEqual({ year: 2026, month: 9 });
    expect(transplant.end).toEqual({ year: 2027, month: 1 });
    expect(cal.stages.find((s) => s.key === "harvest").end.year).toBe(2027);
  });

  it("does not depend on the user's selling month (it has no input for it) and changes with the crop", () => {
    expect(stageCalendar(wheat, PLANTING.Wheat)).toEqual(stageCalendar(wheat, PLANTING.Wheat));
    expect(stageCalendar(wheat, PLANTING.Wheat)).not.toEqual(stageCalendar(brinjal, PLANTING.Brinjal));
  });

  it("missing stage data or planting months give null (the UI shows a fallback)", () => {
    expect(stageCalendar(null, PLANTING.Wheat)).toBeNull();
    expect(stageCalendar(wheat, [])).toBeNull();
    expect(stageCalendar(growthCycleFor("Mango"), [6, 7])).toBeNull();
  });
});
