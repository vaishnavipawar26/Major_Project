// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import real from "../../utils/fixtures/influence.real.json";
import { buildInfluence } from "../../utils/influence";
import { translate } from "../../i18n/LanguageContext";
import InfluencePanel from "./InfluencePanel";

globalThis.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
afterEach(cleanup);
const t = (k, v) => translate("en", k, v);
const make = (name) => {
  const { req, response } = real[name];
  return buildInfluence(response.results[0], response, { nitrogen: req.nitrogen, phosphorus: req.phosphorus, potassium: req.potassium,
    temperature: req.temperature, humidity: req.humidity, ph: req.ph, rainfall: req.rainfall }, t);
};

describe("InfluencePanel", () => {
  it.each([["nashik", "Estimated net profit"], ["wheat", "Location and regional suitability"]])("%s: the card names the factor the ranking numbers pick", (name, factor) => {
    render(<InfluencePanel inf={make(name)} />);
    const card = screen.getByRole("group", { name: "Strongest influence on this recommendation" });
    expect(card.textContent).toContain(factor);
    expect(screen.getByText("What influences your crop recommendation?")).toBeTruthy();
    expect(screen.queryByText("Why this crop?")).toBeNull();
  });
});
