import { describe, expect, it } from "vitest";
import { priceSourceKey } from "./format";

const src = (o) => ({ kind: "market", method: "trained_model", fallback: false, ...o });

describe("priceSourceKey", () => {
  it("shows nothing for the usual case: this market, recent reports, trained model", () => {
    expect(priceSourceKey(src({}))).toBeNull();
    expect(priceSourceKey(undefined)).toBeNull();
  });
  it("labels older reports from the same market, the state median and another market", () => {
    expect(priceSourceKey(src({ fallback: true }))).toBe("price.src.market");
    expect(priceSourceKey(src({ fallback: true, kind: "state_median" }))).toBe("price.src.state");
    expect(priceSourceKey(src({ fallback: true, kind: "other_market" }))).toBe("price.src.other");
  });
  it("calls a historical estimate indicative, whatever source it came from", () => {
    expect(priceSourceKey(src({ fallback: true, method: "historical_baseline", kind: "state_median" }))).toBe("price.src.estimate");
  });
});
