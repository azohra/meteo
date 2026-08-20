import type { LiveSample, LiveSamples } from "./contract.js";
import {
  HISTORY_GAP_TOLERANCE_FACTOR,
  VANE_TARGET,
  chartScalesOf,
  meanDirectionDegOf,
  thinVanesOf,
  tracePointsOf,
  type ChartFrame,
  type ChartScaleOptions,
  type ChartScales,
  type Vane,
} from "./geometry.js";

/* Sample-typed bindings of the history chart's math (geometry.ts owns it),
 * returning the same ChartScales and Vane shapes so vanePath, vaneTicks,
 * and the frame helpers serve both. Samples are instants: no band, and a
 * dropout is a gap, never a zero. */

const speedOf = (sample: LiveSample) => sample.windMps;
const directionOf = (sample: LiveSample) => sample.windDirectionDeg;

/* One gap rule platform-wide: spacing beyond 2.5 sample intervals is a
 * dropout, the same tolerance the history chart holds records to. */
export const SAMPLE_GAP_TOLERANCE_FACTOR = HISTORY_GAP_TOLERANCE_FACTOR;

/* Gap-split runs, oldest first. Rendering each run separately draws
 * outages as absence — the same honesty rule the wire states for the
 * points array itself. */
export function sampleRuns(
  samples: LiveSamples,
  toleranceFactor: number = SAMPLE_GAP_TOLERANCE_FACTOR,
): LiveSample[][] {
  const limitMs = samples.intervalSeconds * 1_000 * toleranceFactor;
  const runs: LiveSample[][] = [];
  let previousMs = Number.NEGATIVE_INFINITY;
  for (const sample of samples.points) {
    const ms = Date.parse(sample.observedAt);
    const run = runs[runs.length - 1];
    if (run && ms - previousMs <= limitMs) {
      run.push(sample);
    } else {
      runs.push([sample]);
    }
    previousMs = ms;
  }
  return runs;
}

/* History-chart scales from instantaneous speeds: top of scale is the
 * fastest sample. */
export function sampleScales(
  samples: LiveSamples,
  frame: ChartFrame,
  options: ChartScaleOptions = {},
): ChartScales {
  return chartScalesOf(samples.points, frame, speedOf, options);
}

/* One polyline's points for one run — the sample counterpart of
 * averagePoints. */
export function samplePoints(run: ReadonlyArray<LiveSample>, scales: ChartScales): string {
  return tracePointsOf(run, scales, speedOf);
}

/* The sample counterpart of meanDirectionDeg. */
export function sampleMeanDirectionDeg(samples: ReadonlyArray<LiveSample>): number | null {
  return meanDirectionDegOf(samples, speedOf, directionOf);
}

/* The sample counterpart of thinVanes: the same Vane shape the history
 * chart thins to, so vanePath and vaneTicks draw either. */
export function thinSampleVanes(
  samples: ReadonlyArray<LiveSample>,
  target: number = VANE_TARGET,
): Vane[] {
  return thinVanesOf(samples, speedOf, directionOf, target);
}

export type SamplesSummary = {
  /* Newest sample. */
  latest: LiveSample;
  peakMps: number;
  peakAt: string;
  meanMps: number;
  /* Circular mean over the blowing samples; null when the window was calm. */
  meanDirectionDeg: number | null;
  /* The window the numbers cover, first sample to last. */
  spanSeconds: number;
};

/* Null when the window is empty. */
export function samplesSummary(samples: LiveSamples): SamplesSummary | null {
  const points = samples.points;
  const latest = points[points.length - 1];
  const first = points[0];
  if (latest == null || first == null) return null;
  let peak = first;
  let sum = 0;
  for (const sample of points) {
    sum += sample.windMps;
    if (sample.windMps > peak.windMps) peak = sample;
  }
  return {
    latest,
    peakMps: peak.windMps,
    peakAt: peak.observedAt,
    meanMps: sum / points.length,
    meanDirectionDeg: sampleMeanDirectionDeg(points),
    spanSeconds: (Date.parse(latest.observedAt) - Date.parse(first.observedAt)) / 1_000,
  };
}
