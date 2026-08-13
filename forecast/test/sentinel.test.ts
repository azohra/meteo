import { describe, expect, it } from "vitest";
import { SENTINEL_TOLERANCE, isSentinel, maskSentinel } from "../src/sentinel.js";

describe("sentinel", () => {
  it("masks the RDPS/GDPS 9999 sentinel and its packing noise", () => {
    expect(maskSentinel(9999.0, 9999.0)).toBeNull();
    expect(maskSentinel(9998.8, 9999.0)).toBeNull();
    expect(maskSentinel(9999.2, 9999.0)).toBeNull();
  });

  it("masks the HRDPS minus-one sentinel", () => {
    expect(maskSentinel(-1.0, -1.0)).toBeNull();
    expect(maskSentinel(-0.9, -1.0)).toBeNull();
  });

  it("never masks a legitimate zero CAPE", () => {
    expect(SENTINEL_TOLERANCE).toBeLessThan(1.0);
    expect(maskSentinel(0.0, -1.0)).toBe(0.0);
  });

  it("passes real values through untouched", () => {
    expect(maskSentinel(850.0, 9999.0)).toBe(850.0);
    expect(maskSentinel(-120.0, 9999.0)).toBe(-120.0);
    expect(maskSentinel(6380.0, -1.0)).toBe(6380.0);
  });

  it("isSentinel is the masking predicate", () => {
    expect(isSentinel(9999.0, 9999.0)).toBe(true);
    expect(isSentinel(9997.0, 9999.0)).toBe(false);
  });
});
