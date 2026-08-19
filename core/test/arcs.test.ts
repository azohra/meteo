import { describe, expect, it } from "vitest";
import { directionArcSpanDeg, inDirectionArcs } from "../src/arcs.js";

describe("inDirectionArcs", () => {
  it("holds a plain arc inclusively at both boundaries", () => {
    const arcs = [{ fromDeg: 260, toDeg: 340 }];
    expect(inDirectionArcs(260, arcs)).toBe(true);
    expect(inDirectionArcs(300, arcs)).toBe(true);
    expect(inDirectionArcs(340, arcs)).toBe(true);
    expect(inDirectionArcs(259.9, arcs)).toBe(false);
    expect(inDirectionArcs(340.1, arcs)).toBe(false);
  });

  it("wraps through north when fromDeg exceeds toDeg", () => {
    const arcs = [{ fromDeg: 315, toDeg: 45 }];
    expect(inDirectionArcs(0, arcs)).toBe(true);
    expect(inDirectionArcs(315, arcs)).toBe(true);
    expect(inDirectionArcs(45, arcs)).toBe(true);
    expect(inDirectionArcs(44.9, arcs)).toBe(true);
    expect(inDirectionArcs(180, arcs)).toBe(false);
  });

  it("holds arcs stations declare in the wild", () => {
    /* A south-launch window wrapping west through north (170 → 0). */
    const southThroughNorth = [{ fromDeg: 170, toDeg: 0 }];
    expect(inDirectionArcs(200, southThroughNorth)).toBe(true);
    expect(inDirectionArcs(0, southThroughNorth)).toBe(true);
    expect(inDirectionArcs(90, southThroughNorth)).toBe(false);
    /* An everything-goes declaration (0 → 359). */
    const everything = [{ fromDeg: 0, toDeg: 359 }];
    expect(inDirectionArcs(123, everything)).toBe(true);
    expect(inDirectionArcs(359, everything)).toBe(true);
  });

  it("takes the union over several arcs", () => {
    const arcs = [
      { fromDeg: 80, toDeg: 100 },
      { fromDeg: 260, toDeg: 280 },
    ];
    expect(inDirectionArcs(90, arcs)).toBe(true);
    expect(inDirectionArcs(270, arcs)).toBe(true);
    expect(inDirectionArcs(180, arcs)).toBe(false);
    expect(inDirectionArcs(0, [])).toBe(false);
  });

  it("normalizes out-of-range bearings on both sides", () => {
    expect(inDirectionArcs(-90, [{ fromDeg: 260, toDeg: 280 }])).toBe(true);
    expect(inDirectionArcs(270, [{ fromDeg: -100, toDeg: -80 }])).toBe(true);
  });
});

describe("directionArcSpanDeg", () => {
  it("measures the clockwise span, wrap included", () => {
    expect(directionArcSpanDeg({ fromDeg: 315, toDeg: 45 })).toBe(90);
    expect(directionArcSpanDeg({ fromDeg: 170, toDeg: 0 })).toBe(190);
    expect(directionArcSpanDeg({ fromDeg: 0, toDeg: 359 })).toBe(359);
  });

  it("reads a degenerate arc as a single bearing", () => {
    expect(directionArcSpanDeg({ fromDeg: 90, toDeg: 90 })).toBe(0);
  });
});
