import { describe, expect, it } from "vitest";
import { nightRects, stretchedChartFrame } from "../src/scene/index.js";
import { displaySpeedScales } from "../src/scene/index.js";
import type { HistoryPoint } from "../src/index.js";
import { iso, makePoints } from "./fixtures.js";

describe("night shading", () => {
  const twoDays = (): HistoryPoint[] =>
    makePoints(48, (point, index) => ({
      ...point,
      observedAt: iso(Date.parse("2026-06-20T00:00:00Z") + index * 3_600_000),
    }));

  const frame = stretchedChartFrame(600, undefined);

  const rectsFor = (night: { latitude: number | null; longitude: number | null } | null) => {
    const points = twoDays();
    return nightRects(points, frame, displaySpeedScales(points, frame, "kmh"), night);
  };

  it("draws one gray column per real night, clipped to the plot", () => {
    const rects = rectsFor({ latitude: 49.07, longitude: -117.8 });
    expect(rects.length).toBeGreaterThanOrEqual(1);
    for (const rect of rects) {
      const attrs = (rect as { attrs: Record<string, number | string> }).attrs;
      expect(attrs["class"]).toBe("meteo-night");
      expect(attrs["width"]).toBeGreaterThan(0);
      expect(attrs["x"]).toBeGreaterThanOrEqual(frame.left);
      expect((attrs["x"] as number) + (attrs["width"] as number)).toBeLessThanOrEqual(
        frame.right + 1,
      );
    }
  });

  it("draws nothing without coordinates and nothing in polar day", () => {
    expect(rectsFor(null)).toEqual([]);
    expect(rectsFor({ latitude: null, longitude: -117.8 })).toEqual([]);
    expect(rectsFor({ latitude: 78, longitude: 15 })).toEqual([]);
  });
});
