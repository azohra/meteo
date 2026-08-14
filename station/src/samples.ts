import type { LiveSample, LiveSamples } from "./contract.js";
import { meanDirectionDeg as meanOfDirections } from "@azohra/meteo.core";
import { isCalm, KMH_PER_MPS } from "./derive.js";
import {
  HISTORY_GAP_TOLERANCE_FACTOR,
  VANE_TARGET,
  type ChartFrame,
  type ChartScaleOptions,
  type ChartScales,
  type Vane,
} from "./geometry.js";

/* Composition primitives over the 3-second sample window — the live
 * counterparts of the history chart's machinery, returning the same
 * ChartScales and Vane shapes so vanePath, vaneTicks, and the frame
 * helpers serve both without adaptation. Samples are instants: there is
 * no band to draw, and a dropout is a gap, never a zero. */

/* One gap rule platform-wide: spacing beyond 2.5 sample intervals is a
 * dropout, the same tolerance the history chart holds records to. */
export const SAMPLE_GAP_TOLERANCE_FACTOR = HISTORY_GAP_TOLERANCE_FACTOR;

/* The history chart's axis defaults: 5 km/h steps, a 10 km/h floor. */
const DEFAULT_NICE_STEP_MPS = 5 / KMH_PER_MPS;
const DEFAULT_FLOOR_MPS = 10 / KMH_PER_MPS;

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

/* The history chart's scales, computed from instantaneous speeds: the top
 * of the scale is the fastest sample, snapped up to a nice step with a
 * floor so a calm window still draws against a readable axis. Returns
 * ChartScales, so every consumer of the history scales composes unchanged. */
export function sampleScales(
  samples: LiveSamples,
  frame: ChartFrame,
  options: ChartScaleOptions = {},
): ChartScales {
  const niceStepMps = options.niceStepMps ?? DEFAULT_NICE_STEP_MPS;
  const floorMps = options.floorMps ?? DEFAULT_FLOOR_MPS;
  const points = samples.points;
  const first = points[0];
  const startMs = first ? Date.parse(first.observedAt) : 0;
  const last = points[points.length - 1];
  const endMs = last ? Date.parse(last.observedAt) : startMs;
  const durationMs = Math.max(1, endMs - startMs);
  const top = points.reduce((max, sample) => Math.max(max, sample.windMps), 0);
  const scaleMax = Math.max(floorMps, Math.ceil(top / niceStepMps) * niceStepMps);
  const xAtMs = (ms: number) =>
    frame.left + ((ms - startMs) / durationMs) * (frame.right - frame.left);
  return {
    startMs,
    endMs,
    durationMs,
    scaleMax,
    xAtMs,
    xAt: (observedAt) => xAtMs(Date.parse(observedAt)),
    yAt: (speedMps) =>
      frame.plotBottom - (speedMps / scaleMax) * (frame.plotBottom - frame.plotTop),
  };
}

/* One polyline's points for one run — the sample counterpart of
 * averagePoints. */
export function samplePoints(run: ReadonlyArray<LiveSample>, scales: ChartScales): string {
  return run
    .map(
      (sample) =>
        `${scales.xAt(sample.observedAt).toFixed(1)},${scales.yAt(sample.windMps).toFixed(1)}`,
    )
    .join(" ");
}

/* The circular mean over the samples that were blowing; an all-calm window
 * stays null. The sample counterpart of meanDirectionDeg. */
export function sampleMeanDirectionDeg(samples: ReadonlyArray<LiveSample>): number | null {
  const blowing = samples.filter(
    (sample) => !isCalm(sample.windMps) && sample.windDirectionDeg != null,
  );
  return meanOfDirections(blowing.map((sample) => sample.windDirectionDeg as number));
}

/* Thins the window to on-chart vanes, one per bucket of samples — the same
 * Vane shape the history chart thins to, so vanePath and vaneTicks draw
 * either. The vane's speed is the bucket's mean of instants; its bearing is
 * the circular mean of the blowing ones, null when the bucket was calm. */
export function thinSampleVanes(
  samples: ReadonlyArray<LiveSample>,
  target: number = VANE_TARGET,
): Vane[] {
  if (samples.length === 0) return [];
  const step = Math.max(1, Math.round(samples.length / target));
  return Array.from({ length: Math.ceil(samples.length / step) }, (_, index) => {
    const startIndex = index * step;
    const endIndex = startIndex + step;
    const window = samples.slice(startIndex, endIndex);
    const first = Date.parse((window[0] as LiveSample).observedAt);
    const last = Date.parse((window[window.length - 1] as LiveSample).observedAt);
    return {
      windAvgMps: window.reduce((sum, sample) => sum + sample.windMps, 0) / window.length,
      windDirectionDeg: sampleMeanDirectionDeg(window),
      endIndex,
      midMs: first + (last - first) / 2,
      startIndex,
    };
  });
}

export type SamplesSummary = {
  /* The newest sample — the number a reader quotes. */
  latest: LiveSample;
  peakMps: number;
  peakAt: string;
  meanMps: number;
  /* Circular mean over the blowing samples; null when the window was calm. */
  meanDirectionDeg: number | null;
  /* The window the numbers cover, first sample to last. */
  spanSeconds: number;
};

/* The window reduced to the words a strip caption needs. Null when there is
 * nothing to summarize — an empty window has no latest sample to misquote. */
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
