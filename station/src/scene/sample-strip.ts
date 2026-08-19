import type { LiveSample, LiveSamples } from "../contract.js";
import { compassDirection, isCalm, speedToMps } from "../derive.js";
import type { SpeedUnit } from "../derive.js";
import { roundSpeed } from "../format.js";
import { sampleRuns, samplePoints, sampleScales, thinSampleVanes } from "../samples.js";
import type { ChartFrame, ChartScales } from "../geometry.js";
import type { FavorableDirection } from "../instruments.js";
import { EM_DASH } from "../strings.js";
import type { FormatTime, StationStrings } from "../strings.js";
import type { ReadoutPart } from "./chart.js";
import type { TickAnchor } from "./chart.js";
import {
  calmNoteText,
  speedGridLines,
  stretchedChartFrame,
  vaneCells,
  vaneGuideLines,
  vaneTickTexts,
  windRowLabels,
} from "./wind-plot.js";
import type { SceneLine, SceneText, VaneCell } from "./wind-plot.js";

/* The sample strip is the history chart's live sibling: the same frame,
 * grid, labelled vane rows, and edge-anchored ticks, drawn over the rolling
 * sample window. Samples are instants — no band, no grading, and a dropout
 * splits the trace into runs rather than drawing a zero. */

export const SAMPLE_STRIP_CLASS = "meteo-sample-strip";

export type SampleStripGate =
  | { kind: "draw"; samples: LiveSamples }
  | { kind: "note"; className: string; text: string };

export function sampleStripGate(
  samples: LiveSamples | null | undefined,
  words: StationStrings,
): SampleStripGate {
  if (samples == null || samples.points.length < 2) {
    return {
      kind: "note",
      className: `${SAMPLE_STRIP_CLASS} meteo-sample-strip-na`,
      text: words.noSamples,
    };
  }
  return { kind: "draw", samples };
}

export type SampleStripInspection = {
  readout: { strong: string; span: ReadoutPart[] };
  cursor: {
    line: SceneLine;
    dot: { className: string; cx: number; cy: number; r: number };
  } | null;
};

export type SampleStripTracePart =
  | { kind: "dot"; key: string; className: string; cx: number; cy: number; r: number }
  | { kind: "polyline"; key: string; className: string; points: string };

export type SampleStripScene = {
  frame: ChartFrame;
  scales: ChartScales;
  points: ReadonlyArray<LiveSample>;
  readout: { ariaLabel: string; className: string };
  svg: { ariaLabel: string; className: string; height: number; viewBox: string; width: number };
  grid: Array<{ key: number; line: SceneLine; label: SceneText }>;
  vaneGuides: Array<{
    key: number;
    className: string;
    x1: number;
    x2: number;
    y1: number;
    y2: number;
  }>;
  trace: SampleStripTracePart[];
  calmNote: SceneText | null;
  rowLabels: { to: SceneText; avg: SceneText };
  vanes: VaneCell[];
  ticks: Array<{
    key: number;
    className: string;
    anchor: TickAnchor;
    x: number;
    y: number;
    text: string;
  }>;
  hit: { className: string; fill: string; height: number; width: number; x: number; y: number };
  inspect: (activeIndex: number | null) => SampleStripInspection;
};

export function sampleStripScene(input: {
  favorableDirections?: FavorableDirection[] | undefined;
  formatTime: FormatTime;
  plotHeight: number | undefined;
  samples: LiveSamples;
  stationName: string;
  unit: SpeedUnit;
  width: number;
  words: StationStrings;
}): SampleStripScene {
  const { formatTime, plotHeight, samples, stationName, unit, width, words } = input;
  const points = samples.points;
  const shown = (speedMps: number) => roundSpeed(speedMps, unit);

  const frame = stretchedChartFrame(width, plotHeight);
  const scales = sampleScales(samples, frame, {
    niceStepMps: speedToMps(5, unit),
    floorMps: speedToMps(10, unit),
  });
  const runs = sampleRuns(samples);
  const vanes = thinSampleVanes(points);

  return {
    frame,
    scales,
    points,
    readout: {
      ariaLabel: words.aria.readout(stationName),
      className: "meteo-sample-strip-readout",
    },
    svg: {
      ariaLabel: words.aria.sampleStrip(stationName),
      className: "meteo-sample-strip-svg",
      height: frame.height,
      viewBox: `0 0 ${frame.width} ${frame.height}`,
      width: frame.width,
    },
    grid: speedGridLines(frame, scales, shown),
    vaneGuides: vaneGuideLines(vanes, frame, scales),
    trace: runs.map((run) =>
      run.length === 1
        ? {
            kind: "dot" as const,
            key: (run[0] as LiveSample).observedAt,
            className: "meteo-sample-dot",
            cx: scales.xAt((run[0] as LiveSample).observedAt),
            cy: scales.yAt((run[0] as LiveSample).windMps),
            r: 2,
          }
        : {
            kind: "polyline" as const,
            key: (run[0] as LiveSample).observedAt,
            className: "meteo-sample-trace",
            points: samplePoints(run, scales),
          },
    ),
    calmNote: points.every((sample) => isCalm(sample.windMps)) ? calmNoteText(frame, words) : null,
    rowLabels: windRowLabels(frame, words),
    vanes: vaneCells(
      vanes,
      frame,
      scales,
      (vane) => String(shown(vane.windAvgMps)),
      input.favorableDirections,
    ),
    ticks: vaneTickTexts(vanes, frame, scales, (timeMs) => formatTime(new Date(timeMs))),
    hit: {
      className: "meteo-hit",
      fill: "transparent",
      height: frame.height,
      width: frame.width,
      x: 0,
      y: 0,
    },
    inspect: (activeIndex) => {
      const active = activeIndex == null ? undefined : points[activeIndex];
      if (active == null) {
        return {
          readout: {
            strong: `${formatTime(new Date(scales.startMs))}–${formatTime(new Date(scales.endMs))}`,
            span: [{ kind: "text", text: words.inspectHint }],
          },
          cursor: null,
        };
      }
      const lead = `${shown(active.windMps)} ${words.speedUnits[unit]} · `;
      const span: ReadoutPart[] = isCalm(active.windMps)
        ? [{ kind: "text", text: `${lead}${words.calm}` }]
        : active.windDirectionDeg == null
          ? [{ kind: "text", text: `${lead}${EM_DASH}` }]
          : [
              { kind: "text", text: `${lead}${words.fromLabel} ` },
              { kind: "arrow", deg: active.windDirectionDeg },
              {
                kind: "text",
                text: ` ${compassDirection(active.windDirectionDeg)} ${Math.round(active.windDirectionDeg)}°`,
              },
            ];
      const x = scales.xAt(active.observedAt);
      return {
        readout: { strong: formatTime(new Date(active.observedAt)), span },
        cursor: {
          line: {
            className: "meteo-cursor",
            x1: x,
            x2: x,
            y1: frame.plotTop,
            y2: frame.vaneRow + 9,
          },
          dot: { className: "meteo-cursor-dot", cx: x, cy: scales.yAt(active.windMps), r: 3 },
        },
      };
    },
  };
}
