// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/priceService", () => ({ priceService: { options: vi.fn(), predict: vi.fn() } }));
vi.mock("../services/api", () => ({ errorMessage: (e) => e.message }));
vi.mock("../components/PageHero", () => ({ default: ({ title }) => <h1>{title}</h1> }));

import Footer from "../components/Footer";
import { priceService } from "../services/priceService";
import PricePrediction from "./PricePrediction";

const options = {
  today: "2026-10-20", data_end: "2025-12-31", max_horizon_days: 60, inflation_annual_pct: 5, unsupported_series: 182, min_listed_days: 30,
  commodities: [{ commodity: "Onion", states: ["Maharashtra"], validated_horizons: [10],
    markets: [{ market: "All markets (state median)", is_state_aggregate: true, varieties: ["All"], default_variety: "All", first_date: "2023-01-01", last_date: "2025-12-31" },
      { market: "APMC Pune", is_state_aggregate: false, varieties: ["Other"], default_variety: "Other", first_date: "2023-01-01", last_date: "2025-12-31" }] }],
};
afterEach(cleanup);
const renderForm = async () => {
  priceService.options.mockResolvedValue(options);
  render(<MemoryRouter><PricePrediction /></MemoryRouter>);
  await waitFor(() => expect(screen.getByLabelText("Crop")).toBeTruthy());
};

describe("price prediction form", () => {
  it("shows only the essentials, with placeholders and the live starting date", async () => {
    await renderForm();
    expect(screen.getByRole("option", { name: "Choose a crop" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Choose a market" })).toBeTruthy();
    expect(document.querySelector(".date-ph").getAttribute("data-placeholder")).toBe("Choose a selling date");
    expect(screen.getByText("Forecast starting point: 20 Oct 2026")).toBeTruthy();
    expect(screen.queryByLabelText("State")).toBeNull();
    const text = document.body.textContent;
    for (const gone of ["The crop you want to sell", "Choose one APMC market", "most reliable choice", "available for Maharashtra only",
      "available up to", "adjusted for about", "market price series are not listed", "are required", "Good to know"]) {
      expect(text, gone).not.toContain(gone);
    }
  });

  it("keeps the button disabled until crop, market and a valid date are chosen, then sends the same request", async () => {
    await renderForm();
    const btn = screen.getByRole("button", { name: "Show expected price" });
    expect(btn.disabled).toBe(true);
    expect(screen.getByLabelText("Market (mandi)").disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Crop"), { target: { value: "Onion" } });
    expect(screen.getByLabelText("Market (mandi)").disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Market (mandi)"), { target: { value: "APMC Pune" } });
    fireEvent.change(document.getElementById("target_date"), { target: { value: "2026-12-30" } });   // 71 days ahead: outside the 60-day limit
    expect(btn.disabled).toBe(true);
    fireEvent.change(document.getElementById("target_date"), { target: { value: "2026-11-05" } });
    expect(btn.disabled).toBe(false);
    priceService.predict.mockResolvedValue({ input_date: "2026-10-20" });
    fireEvent.click(btn);
    await waitFor(() => expect(priceService.predict).toHaveBeenCalledWith(
      { state: "Maharashtra", market: "APMC Pune", commodity: "Onion", variety: "Other", target_date: "2026-11-05" }));
  });

  it("the footer drops 'Good to know' on this page only", () => {
    const at = (path) => render(<MemoryRouter initialEntries={[path]}><Footer /></MemoryRouter>);
    at("/price-prediction");
    expect(screen.queryByText("Good to know")).toBeNull();
    cleanup();
    at("/history");
    expect(screen.getByText("Good to know")).toBeTruthy();
  });
});
