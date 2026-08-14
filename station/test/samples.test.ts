import { describe, expect, it } from "vitest";
import {
  chartFrame,
  nearestIndex,
  samplePoints,
  sampleRuns,
  sampleScales,
  sampleMeanDirectionDeg,
  samplesSummary,
  thinSampleVanes,
  vaneTicks,
  type LiveSample,
  type LiveSamples,
} from "../src/index.js";
import { BASE_MS, iso } from "./fixtures.js";

function sample(
  offsetSeconds: number,
  windMps: number,
  windDirectionDeg: number | null = 270,
): LiveSample {
  return { observedAt: iso(BASE_MS + offsetSeconds * 1_000), windMps, windDirectionDeg };
}

function window(points: LiveSample[], intervalSeconds = 3): LiveSamples {
  return { intervalSeconds, points };
}

describe("sampleRuns", () => {
  it("keeps evenly spaced samples in one run", () => {
    const runs = sampleRuns(window([sample(0, 2), sample(3, 3), sample(6, 4)]));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(3);
  });

  it("splits at a dropout — beyond 2.5 intervals is a gap, never a zero", () => {
    const runs = sampleRuns(window([sample(0, 2), sample(3, 3), sample(12, 4), sample(15, 5)]));
    expect(runs.map((run) => run.length)).toEqual([2, 2]);
    expect(runs[1]?.[0]?.observedAt).toBe(iso(BASE_MS + 12_000));
  });

  it("tolerates jitter inside the tolerance factor", () => {
    const runs = sampleRuns(window([sample(0, 2), sample(7, 3)]));
    expect(runs).toHaveLength(1);
  });

  it("returns no runs for an empty window", () => {
    expect(sampleRuns(window([]))).toEqual([]);
  });
});

describe("sampleScales", () => {
  const frame = chartFrame(360);

  it("returns the shared ChartScales shape over the window's span", () => {
    const scales = sampleScales(window([sample(0, 2), sample(600, 4)]), frame);
    expect(scales.startMs).toBe(BASE_MS);
    expect(scales.endMs).toBe(BASE_MS + 600_000);
    expect(scales.xAt(iso(BASE_MS))).toBe(frame.left);
    expect(scales.xAt(iso(BASE_MS + 600_000))).toBe(frame.right);
  });

  it("tops the scale at the fastest sample, snapped to a nice step", () => {
    const scales = sampleScales(window([sample(0, 2), sample(3, 3.4)]), frame);
    /* 3.4 m/s ≈ 12.2 km/h snaps up to 15 km/h. */
    expect(scales.scaleMax * 3.6).toBeCloseTo(15, 6);
  });

  it("holds a calm window to the readable floor", () => {
    const scales = sampleScales(window([sample(0, 0), sample(3, 0.2)]), frame);
    expect(scales.scaleMax * 3.6).toBeCloseTo(10, 6);
    expect(scales.yAt(0)).toBe(frame.plotBottom);
    expect(scales.yAt(scales.scaleMax)).toBe(frame.plotTop);
  });
});

describe("samplePoints", () => {
  it("draws one run against the shared scales", () => {
    const frame = chartFrame(360);
    const points = [sample(0, 0), sample(600, 10 / 3.6)];
    const scales = sampleScales(window(points), frame);
    expect(samplePoints(points, scales)).toBe(
      `${frame.left.toFixed(1)},${frame.plotBottom.toFixed(1)} ` +
        `${frame.right.toFixed(1)},${frame.plotTop.toFixed(1)}`,
    );
  });
});

describe("sampleMeanDirectionDeg", () => {
  it("averages only the blowing samples, circularly", () => {
    const mean = sampleMeanDirectionDeg([
      sample(0, 3, 350),
      sample(3, 3, 10),
      sample(6, 0.2, 180) /* calm — contributes nothing */,
    ]);
    expect(mean).toBeCloseTo(0, 6);
  });

  it("stays null for an all-calm window", () => {
    expect(sampleMeanDirectionDeg([sample(0, 0.1, 90), sample(3, 0.2, 95)])).toBeNull();
  });
});

describe("thinSampleVanes", () => {
  it("thins to the shared Vane shape and composes with vaneTicks", () => {
    const points = Array.from({ length: 200 }, (_, index) => sample(index * 3, 2, 270));
    const vanes = thinSampleVanes(points);
    expect(vanes.length).toBeGreaterThan(10);
    expect(vanes.length).toBeLessThan(20);
    expect(vanes[0]?.windAvgMps).toBe(2);
    expect(vanes[0]?.windDirectionDeg).toBe(270);

    const frame = chartFrame(360);
    const scales = sampleScales(window(points), frame);
    const ticks = vaneTicks(vanes, scales);
    expect(ticks).toHaveLength(5);
    expect(ticks[0]?.x).toBeGreaterThanOrEqual(frame.left);
    expect(ticks[4]?.x).toBeLessThanOrEqual(frame.right);
  });

  it("gives a calm bucket a speed but no bearing", () => {
    const vanes = thinSampleVanes([sample(0, 0.1, 90), sample(3, 0.2, 95)], 1);
    expect(vanes).toHaveLength(1);
    expect(vanes[0]?.windDirectionDeg).toBeNull();
    expect(vanes[0]?.windAvgMps).toBeCloseTo(0.15, 6);
  });

  it("returns nothing for an empty window", () => {
    expect(thinSampleVanes([])).toEqual([]);
  });
});

describe("nearestIndex over samples", () => {
  it("inspects live samples through the same cursor math as history", () => {
    const points = [sample(0, 2), sample(300, 3), sample(600, 4)];
    const frame = chartFrame(360);
    const scales = sampleScales(window(points), frame);
    expect(nearestIndex(points, frame.left, frame, scales)).toBe(0);
    expect(nearestIndex(points, (frame.left + frame.right) / 2, frame, scales)).toBe(1);
    expect(nearestIndex(points, frame.right, frame, scales)).toBe(2);
    expect(nearestIndex([], frame.left, frame, scales)).toBeNull();
  });
});

describe("samplesSummary", () => {
  it("reduces the window to latest, peak, mean, and bearing", () => {
    const summary = samplesSummary(
      window([sample(0, 2, 260), sample(3, 5, 270), sample(6, 3, 280)]),
    );
    expect(summary).not.toBeNull();
    if (summary == null) return;
    expect(summary.latest.observedAt).toBe(iso(BASE_MS + 6_000));
    expect(summary.peakMps).toBe(5);
    expect(summary.peakAt).toBe(iso(BASE_MS + 3_000));
    expect(summary.meanMps).toBeCloseTo(10 / 3, 6);
    expect(summary.meanDirectionDeg).toBeCloseTo(270, 0);
    expect(summary.spanSeconds).toBe(6);
  });

  it("keeps an all-calm window's bearing null", () => {
    const summary = samplesSummary(window([sample(0, 0.1, 90), sample(3, 0.2, 95)]));
    expect(summary?.meanDirectionDeg).toBeNull();
  });

  it("has nothing to say about an empty window", () => {
    expect(samplesSummary(window([]))).toBeNull();
  });
});
