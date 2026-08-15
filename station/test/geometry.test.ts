import { describe, expect, it } from "vitest";
import {
  METEOROLOGICAL_SEASON_MONTHS,
  averagePoints,
  chartFrame,
  chartScales,
  compareTracePoints,
  compareWindow,
  dailyPattern,
  filterByMonth,
  filterByTimeOfDay,
  historyMeanDirectionDeg,
  thinVanes,
  windowPoints,
} from "../src/index.js";
import { stretchFrame, vectorMeanWind } from "../src/geometry.js";
import type { HistoryPoint } from "../src/index.js";
import { BASE_MS, MINUTE_MS, iso, makePoints } from "./fixtures.js";

const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const point = (overrides: Partial<HistoryPoint>): HistoryPoint => ({
  observedAt: iso(0),
  windAvgMps: 5,
  windGustMps: null,
  windLullMps: null,
  windDirectionDeg: 0,
  temperatureC: null,
  ...overrides,
});

describe("vectorMeanWind", () => {
  it("reports zero speed and no direction for an empty window", () => {
    expect(vectorMeanWind([])).toEqual({ windDirectionDeg: null, speedMps: 0 });
  });

  it("averages a steady wind to itself", () => {
    const points = [
      point({ windAvgMps: 10, windDirectionDeg: 270 }),
      point({ windAvgMps: 10, windDirectionDeg: 270 }),
    ];
    const result = vectorMeanWind(points);
    expect(result.speedMps).toBeCloseTo(10, 5);
    expect(result.windDirectionDeg).toBeCloseTo(270, 5);
  });

  it("cancels two equal, opposite samples toward calm", () => {
    const points = [
      point({ windAvgMps: 10, windDirectionDeg: 0 }),
      point({ windAvgMps: 10, windDirectionDeg: 180 }),
    ];
    const result = vectorMeanWind(points);
    expect(result.speedMps).toBeCloseTo(0, 5);
    expect(result.windDirectionDeg).toBeNull();
  });

  it("pulls the resultant down when a calm sample (no direction) shares the window", () => {
    const points = [
      point({ windAvgMps: 10, windDirectionDeg: 90 }),
      point({ windAvgMps: 0.1, windDirectionDeg: null }),
    ];
    const result = vectorMeanWind(points);
    expect(result.speedMps).toBeCloseTo(5, 5);
    expect(result.windDirectionDeg).toBeCloseTo(90, 5);
  });

  it("never walks the long way from 350° to 10°", () => {
    const points = [
      point({ windAvgMps: 8, windDirectionDeg: 350 }),
      point({ windAvgMps: 8, windDirectionDeg: 10 }),
    ];
    const result = vectorMeanWind(points);
    expect(result.windDirectionDeg).toBeCloseTo(0, 3);
  });
});

describe("historyMeanDirectionDeg", () => {
  it("averages only the blowing points that carry a direction", () => {
    const points = [
      point({ windDirectionDeg: 10 }),
      point({ windDirectionDeg: 30 }),
      point({ windAvgMps: 0, windDirectionDeg: 180 }),
      point({ windDirectionDeg: null }),
    ];
    expect(historyMeanDirectionDeg(points)).toBeCloseTo(20, 5);
  });

  it("stays null when every point is calm or directionless", () => {
    const points = [point({ windAvgMps: 0 }), point({ windDirectionDeg: null })];
    expect(historyMeanDirectionDeg(points)).toBeNull();
    expect(historyMeanDirectionDeg([])).toBeNull();
  });
});

describe("dailyPattern", () => {
  it("rejects a slot width that does not divide a day evenly", () => {
    expect(() => dailyPattern([], { slotMinutes: 100 })).toThrow(/evenly/);
  });

  it("defaults to eight 3-hour slots covering the whole day", () => {
    const slots = dailyPattern([]);
    expect(slots).toHaveLength(8);
    expect(slots.map((slot) => slot.startMinuteOfDay)).toEqual([
      0, 180, 360, 540, 720, 900, 1080, 1260,
    ]);
    expect(slots.every((slot) => slot.sampleCount === 0)).toBe(true);
  });

  it("buckets by time-of-day alone, merging samples from different days", () => {
    const points = [
      point({
        observedAt: iso(Date.parse("2026-01-01T01:00:00Z")),
        windAvgMps: 4,
        windDirectionDeg: 90,
      }),
      point({
        observedAt: iso(Date.parse("2026-06-15T01:30:00Z")),
        windAvgMps: 6,
        windDirectionDeg: 90,
      }),
      point({
        observedAt: iso(Date.parse("2026-01-01T13:00:00Z")),
        windAvgMps: 20,
        windDirectionDeg: 270,
      }),
    ];
    const slots = dailyPattern(points, { slotMinutes: 60 });
    expect(slots).toHaveLength(24);
    expect(slots[1]?.sampleCount).toBe(2);
    expect(slots[1]?.speedMps).toBeCloseTo(5, 5);
    expect(slots[13]?.sampleCount).toBe(1);
    expect(slots[13]?.speedMps).toBeCloseTo(20, 5);
  });

  it("shifts buckets by a plain UTC offset, not an IANA zone", () => {
    const points = [
      point({
        observedAt: iso(Date.parse("2026-01-01T23:30:00Z")),
        windAvgMps: 9,
        windDirectionDeg: 0,
      }),
    ];
    const utc = dailyPattern(points, { slotMinutes: 60 });
    const shifted = dailyPattern(points, { slotMinutes: 60, utcOffsetMinutes: 120 });
    expect(utc[23]?.sampleCount).toBe(1);
    expect(shifted[1]?.sampleCount).toBe(1);
  });

  it("stays finite over a long, mixed history", () => {
    const slots = dailyPattern(makePoints(500));
    expect(slots.reduce((total, slot) => total + slot.sampleCount, 0)).toBe(500);
  });
});

describe("filterByMonth", () => {
  const points = [
    point({ observedAt: iso(Date.parse("2026-01-15T00:00:00Z")) }),
    point({ observedAt: iso(Date.parse("2026-07-04T00:00:00Z")) }),
    point({ observedAt: iso(Date.parse("2026-08-20T00:00:00Z")) }),
    point({ observedAt: iso(Date.parse("2026-12-25T00:00:00Z")) }),
  ];

  it("keeps only the named months, merging years", () => {
    expect(filterByMonth(points, [1, 12])).toHaveLength(2);
    expect(filterByMonth(points, METEOROLOGICAL_SEASON_MONTHS.summer)).toHaveLength(2);
  });

  it("shifts the month boundary by a plain UTC offset near midnight", () => {
    const nearMidnight = [point({ observedAt: iso(Date.parse("2026-08-01T00:30:00Z")) })];
    expect(filterByMonth(nearMidnight, [8])).toHaveLength(1);
    expect(filterByMonth(nearMidnight, [7], -60)).toHaveLength(1);
  });
});

describe("filterByTimeOfDay", () => {
  const atHour = (hour: number) =>
    point({ observedAt: iso(Date.parse(`2026-08-09T${String(hour).padStart(2, "0")}:00:00Z`)) });
  const points = [atHour(3), atHour(11), atHour(14), atHour(22)];

  it("keeps a plain [from, to) window", () => {
    const midday = filterByTimeOfDay(points, 9 * 60, 15 * 60);
    expect(midday).toHaveLength(2);
  });

  it("wraps a night window across midnight", () => {
    const night = filterByTimeOfDay(points, 21 * 60, 6 * 60);
    expect(night).toHaveLength(2);
  });

  it("shifts by a plain UTC offset", () => {
    expect(filterByTimeOfDay([atHour(22)], 0, 6 * 60)).toHaveLength(0);
    expect(filterByTimeOfDay([atHour(22)], 0, 6 * 60, 5 * 60)).toHaveLength(1);
  });
});

describe("thinVanes", () => {
  it("reports each vane's window as [startIndex, endIndex) and its scalar-mean speed", () => {
    const points = [point({ windAvgMps: 2 }), point({ windAvgMps: 4 }), point({ windAvgMps: 6 })];
    const vanes = thinVanes(points, 1);
    expect(vanes).toHaveLength(1);
    expect(vanes[0]).toMatchObject({ startIndex: 0, endIndex: 3 });
    expect(vanes[0]?.windAvgMps).toBeCloseTo(4, 5);
  });

  it("tiles the points array across windows with no gap and no overlap", () => {
    const points = makePoints(6);
    const vanes = thinVanes(points, 3);
    expect(vanes.map((vane) => vane.startIndex)).toEqual([0, 2, 4]);
    expect(vanes.map((vane) => vane.endIndex)).toEqual([2, 4, 6]);
  });
});

describe("windowPoints", () => {
  const points = makePoints(24);

  it("is a no-op when hours is omitted — every binding's unchanged default", () => {
    expect(windowPoints(points, undefined)).toBe(points);
  });

  it("keeps only the trailing N hours, measured off the array's own last point", () => {
    const windowed = windowPoints(points, 1);
    expect(windowed).toHaveLength(13);
    expect(windowed[0]?.observedAt).toBe(points[11]?.observedAt);
  });
});

function hourlyPoints(hours: number): HistoryPoint[] {
  return Array.from({ length: hours }, (_, index) =>
    point({
      windAvgMps: index,
      observedAt: iso(BASE_MS - (hours - 1 - index) * HOUR_MS),
    }),
  );
}

describe("compareWindow", () => {
  it("finds yesterday's matching span when the array reaches back far enough", () => {
    const points = hourlyPoints(100);
    const compare = compareWindow(points, 1, 6);
    expect(compare).not.toBeNull();
    const matched = compare as HistoryPoint[];
    expect(matched[0]?.observedAt).toBe(iso(BASE_MS - 30 * HOUR_MS));
    expect(matched[matched.length - 1]?.observedAt).toBe(iso(BASE_MS - 24 * HOUR_MS));
  });

  it("is null — never a fabricated short trace — when history doesn't reach back far enough", () => {
    const points = hourlyPoints(10);
    expect(compareWindow(points, 1, 6)).toBeNull();
  });

  it("is null when only a stray point lands in the requested span (coverage, not just presence)", () => {
    const dense = Array.from({ length: 361 }, (_, index) =>
      point({ windAvgMps: index, observedAt: iso(BASE_MS - (360 - index) * MINUTE_MS) }),
    );
    const stray = point({ windAvgMps: 99, observedAt: iso(BASE_MS - 27 * HOUR_MS) });
    expect(compareWindow([stray, ...dense], 1, 6)).toBeNull();
  });

  it("treats an omitted windowHours as the whole array being the display window", () => {
    const points = hourlyPoints(100);
    expect(compareWindow(points, 1)).toBeNull();
  });
});

describe("compareTracePoints", () => {
  it("shifts each point's real timestamp forward by offsetDays onto the CURRENT scale's own x-positions", () => {
    const today = [
      point({ windAvgMps: 3, observedAt: iso(BASE_MS - 2 * HOUR_MS) }),
      point({ windAvgMps: 5, observedAt: iso(BASE_MS - 1 * HOUR_MS) }),
      point({ windAvgMps: 7, observedAt: iso(BASE_MS) }),
    ];
    const yesterday = today.map((entry) => ({
      ...entry,
      observedAt: iso(Date.parse(entry.observedAt) - DAY_MS),
    }));
    const frame = chartFrame(360);
    const scales = chartScales(today, frame);
    expect(compareTracePoints(yesterday, scales, 1)).toBe(averagePoints(today, scales));
  });
});

describe("chartFrame / stretchFrame: the persistent label and value rows", () => {
  it("orders every row within the existing plotBottom..height budget", () => {
    const frame = chartFrame(360);
    expect(frame.plotBottom).toBeLessThan(frame.vaneLabelRow);
    expect(frame.vaneLabelRow).toBeLessThan(frame.vaneRow);
    expect(frame.vaneRow).toBeLessThan(frame.valueRow);
    expect(frame.valueRow).toBeLessThan(frame.labelRow);
    expect(frame.labelRow).toBeLessThan(frame.height);
  });

  it("shifts the new rows by the same delta as the vane row when the plot stretches", () => {
    const frame = chartFrame(360);
    const stretched = stretchFrame(frame, frame.plotBottom - frame.plotTop + 20);
    const delta = stretched.vaneRow - frame.vaneRow;
    expect(delta).toBe(20);
    expect(stretched.vaneLabelRow - frame.vaneLabelRow).toBe(delta);
    expect(stretched.valueRow - frame.valueRow).toBe(delta);
  });
});
