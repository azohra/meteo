import { describe, expect, it } from "vitest";
import { windChartScene } from "../src/scene/index.js";
import { defaultStrings } from "../src/index.js";
import type { HistoryPoint } from "../src/index.js";
import { iso, makePoints } from "./fixtures.js";

describe("night shading", () => {
  const twoDays = (): HistoryPoint[] =>
    makePoints(48, (point, index) => ({
      ...point,
      observedAt: iso(Date.parse("2026-06-20T00:00:00Z") + index * 3_600_000),
    }));

  const scene = (night: { latitude: number | null; longitude: number | null } | null) =>
    windChartScene({
      compareOffsetDays: undefined,
      formatTime: () => "t",
      hatchId: "hatch",
      history: { periodMinutes: 60, points: twoDays() },
      night,
      plotHeight: undefined,
      stationName: "Bluff",
      thresholds: undefined,
      unit: "kmh",
      width: 600,
      windowHours: undefined,
      words: defaultStrings,
    });

  it("draws one gray column per real night, clipped to the plot", () => {
    const withNight = scene({ latitude: 49.07, longitude: -117.8 });
    expect(withNight.nightRects.length).toBeGreaterThanOrEqual(1);
    for (const rect of withNight.nightRects) {
      expect(rect.className).toBe("meteo-night");
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.x).toBeGreaterThanOrEqual(withNight.frame.left);
      expect(rect.x + rect.width).toBeLessThanOrEqual(withNight.frame.right + 1);
    }
  });

  it("draws nothing without coordinates and nothing in polar day", () => {
    expect(scene(null).nightRects).toEqual([]);
    expect(scene({ latitude: null, longitude: -117.8 }).nightRects).toEqual([]);
    expect(scene({ latitude: 78, longitude: 15 }).nightRects).toEqual([]);
  });
});
