import { describe, expect, it } from "vitest";
import { kmhToMps, plausibleWindMps } from "../src/units.js";

describe("kmhToMps", () => {
  it("converts km/h to m/s", () => {
    expect(kmhToMps(36)).toBeCloseTo(10, 12);
    expect(kmhToMps(0)).toBe(0);
  });
});

describe("plausibleWindMps", () => {
  it("passes the plausible range through unchanged, bounds included", () => {
    expect(plausibleWindMps(0, "adapter")).toBe(0);
    expect(plausibleWindMps(37.2, "adapter")).toBe(37.2);
    expect(plausibleWindMps(140, "adapter")).toBe(140);
  });

  it("refuses an implausible speed and names the subject", () => {
    expect(() => plausibleWindMps(-0.1, "the records road")).toThrowError(
      "the records road returned an invalid wind speed",
    );
    expect(() => plausibleWindMps(140.1, "the records road")).toThrowError(
      "the records road returned an invalid wind speed",
    );
  });
});
