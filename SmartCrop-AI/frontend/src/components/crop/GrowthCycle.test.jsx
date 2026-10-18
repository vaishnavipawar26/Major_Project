// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import TimelineSection from "./TimelineSection";

afterEach(cleanup);

// `timeline` objects exactly as the API returned them (recommendation_service.analyze, Kolhapur inputs)
const TL = {
  brinjalJunOct: { planting: "2027-06", harvest_start: "2027-09", harvest_end: "2027-11", storage_until: null, selling: "2027-10", selling_offset: 4, growth_months_min: 3, growth_months_max: 5, max_storage_months: 0, storable: false, status: "fresh", months_stored: 0, planting_months: [6, 7, 9, 10, 11, 1, 2], planting_in_window: true },
  brinjalJunJul: { planting: "2027-06", harvest_start: "2027-09", harvest_end: "2027-11", storage_until: null, selling: "2027-07", selling_offset: 1, growth_months_min: 3, growth_months_max: 5, max_storage_months: 0, storable: false, status: "not_ready", months_stored: 0, planting_months: [6, 7, 9, 10, 11, 1, 2], planting_in_window: true },
  wheatOctSep: { planting: "2026-10", harvest_start: "2027-02", harvest_end: "2027-03", storage_until: "2027-12", selling: "2027-09", selling_offset: 11, growth_months_min: 4, growth_months_max: 5, max_storage_months: 9, storable: true, status: "stored", months_stored: 6, planting_months: [10, 11, 12], planting_in_window: true },
  brinjalOctSep: { planting: "2026-10", harvest_start: "2027-01", harvest_end: "2027-03", storage_until: null, selling: "2027-09", selling_offset: 11, growth_months_min: 3, growth_months_max: 5, max_storage_months: 0, storable: false, status: "spoiled", months_stored: 6, planting_months: [6, 7, 9, 10, 11, 1, 2], planting_in_window: true },
};
const show = (crop, timeline) => render(<TimelineSection result={{ crop_name: crop, timeline }} />).container;
const stageLabels = (c) => [...c.querySelectorAll(".gc-stages .gc-label")].map((n) => n.textContent);
const stageMonths = (c) => [...c.querySelectorAll(".gc-stages .gc-value")].map((n) => n.textContent);

describe("Original Crop Growing Timeline next to the user's timeline", () => {
  // the four selling-month cases from earlier testing: the comparison section is gone in every one,
  // while the user's timeline and the original growth timeline still render
  it.each([
    ["Brinjal", "brinjalJunOct"], ["Brinjal", "brinjalJunJul"], ["Wheat", "wheatOctSep"], ["Brinjal", "brinjalOctSep"],
  ])("%s (%s): no comparison section; both timelines still shown", (crop, key) => {
    const c = show(crop, TL[key]);
    expect(c.querySelector(".gc-compare")).toBeNull();
    expect(c.textContent).not.toMatch(/Your schedule compared with the typical cycle|A\. Your plan|B\. Typical crop cycle/);
    expect(c.textContent).not.toMatch(/assumes planting or transplanting|month-based crop calendar|Selling does not have to happen/);
    expect(c.querySelectorAll(".tl-stages > li")).toHaveLength(5); // existing planting -> selling timeline
    expect(c.querySelector(".tl-status")).not.toBeNull(); // its own conclusion line is untouched
    expect(c.querySelector("#gc-title").textContent).toBe("Original Crop Growing Timeline");
    expect(c.querySelectorAll(".gc-stages > li").length).toBeGreaterThan(3);
  });

  it("nothing is rendered below the original timeline's stages", () => {
    const c = show("Wheat", TL.wheatOctSep);
    const gc = c.querySelector(".gc");
    expect([...gc.children].map((n) => n.className)).toEqual(["gc-head", "gc-stages"]);
    expect(gc.lastElementChild.className).toBe("gc-stages");
    expect(gc.nextElementSibling).toBeNull(); // last thing in the timeline section
  });

  it("keeps the existing user-selected timeline unchanged above the new section", () => {
    const c = show("Brinjal", TL.brinjalJunOct);
    expect(c.querySelectorAll(".tl-stages > li")).toHaveLength(5);
    const existing = c.querySelector(".tl-stages");
    const gc = c.querySelector(".gc");
    expect(existing.compareDocumentPosition(gc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("labels the months as a typical estimate for the main season; sources and variability in the tooltip", () => {
    const c = show("Wheat", TL.wheatOctSep);
    const chip = c.querySelector(".gc-chip");
    expect(chip.textContent).toBe("Typical estimate · Rabi");
    expect(chip.title).toMatch(/vary by region, variety and climate/);
    expect(chip.title).toMatch(/TNAU/);
    expect(chip.title).toMatch(/FAO/);
  });

  it("Wheat shows calendar months for each stage (not day counts) and no extra text blocks", () => {
    const c = show("Wheat", TL.wheatOctSep);
    expect(stageLabels(c)).toEqual(["Sowing / planting", "Germination / establishment", "Tillering", "Heading and flowering",
      "Grain filling and ripening", "Harvest"]);
    expect(stageMonths(c)[0]).toBe("Oct – Dec");
    stageMonths(c).forEach((m) => expect(m).toMatch(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)( – (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))?$/));
    expect(c.querySelector(".gc-stages").textContent).not.toMatch(/Day|days/);
    // only the heading with its label, and the timeline
    expect([...c.querySelector(".gc").children].map((n) => n.className)).toEqual(["gc-head", "gc-stages"]);
  });

  it("Brinjal shows its own stages and months: nursery, transplanting, flowering/fruiting, repeated picking", () => {
    const c = show("Brinjal", TL.brinjalJunOct);
    expect(stageLabels(c)).toEqual(["Nursery", "Transplanting", "Establishment", "Vegetative growth", "Flowering and fruiting",
      "Harvest (repeated pickings)"]);
    expect(stageMonths(c)[1]).toBe("Sep – Nov"); // brinjal's main planting window from its own calendar
  });

  it("changing the crop updates the original timeline; changing the user's months does not", () => {
    const { container, rerender } = render(<TimelineSection result={{ crop_name: "Wheat", timeline: TL.wheatOctSep }} />);
    const wheat = container.querySelector(".gc-stages").textContent;
    rerender(<TimelineSection result={{ crop_name: "Brinjal", timeline: TL.brinjalOctSep }} />);
    expect(container.querySelector(".gc-stages").textContent).not.toBe(wheat);
    const brinjalOctSep = container.querySelector(".gc-stages").textContent;
    rerender(<TimelineSection result={{ crop_name: "Brinjal", timeline: TL.brinjalJunJul }} />);
    expect(container.querySelector(".gc-stages").textContent).toBe(brinjalOctSep);
  });

  it("a crop with stage data but no planting months shows a fallback instead of invented months", () => {
    const c = show("Wheat", { ...TL.wheatOctSep, planting_months: [] });
    expect(c.querySelector(".gc-stages")).toBeNull();
    expect(c.querySelector(".gc > .tl-status").textContent).toMatch(/not available/);
  });

  it("an unknown crop shows a safe message and no invented stages", () => {
    const c = show("Mango", TL.wheatOctSep);
    expect(c.querySelector(".gc-stages")).toBeNull();
    expect(c.querySelector(".gc-compare")).toBeNull();
    expect(c.querySelector(".gc").textContent).toMatch(/not available in SmartCrop yet/);
    expect(c.querySelectorAll(".tl-stages > li")).toHaveLength(5); // existing timeline still shown
  });
});
