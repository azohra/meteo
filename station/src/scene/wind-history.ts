import type { History, HistoryPoint, Station } from "../contract.js";
import { compassDirection, isCalm, thresholdsToMps } from "../derive.js";
import type { SpeedThresholds, SpeedUnit } from "../derive.js";
import { roundSpeed } from "../format.js";
import {
  bandPoints,
  compareTracePoints,
  compareWindow,
  historyGaps,
  isCalmHistory,
  thinVanes,
  windowPoints,
} from "../geometry.js";
import type { ChartFrame, ChartScales } from "../geometry.js";
import { EM_DASH } from "../strings.js";
import type { FavorableDirection } from "../instruments.js";
import type { FormatTime, StationStrings } from "../strings.js";
import type { ReadoutPart, TickAnchor } from "./chart.js";
import {
  calmNoteText,
  displaySpeedScales,
  gapHatchPattern,
  gapHatchRect,
  gradedMeanTrace,
  speedGridLines,
  stretchedChartFrame,
  nightRects,
  vaneCells,
  vaneGuideLines,
  vaneTickTexts,
  windRowLabels,
  windThresholdGuides,
  windZoneRects,
} from "./wind-plot.js";
import type {
  GapHatchPattern,
  GradedMeanTrace,
  SceneLine,
  SceneText,
  VaneCell,
} from "./wind-plot.js";

export const WIND_CHART_CLASS = "meteo-wind-chart";

export type WindChartGate =
  | { kind: "draw"; history: History }
  | { kind: "hidden" }
  | { kind: "note"; className: string; text: string };

export function windChartGate(station: Station, words: StationStrings): WindChartGate {
  if (!station.capabilities.history) return { kind: "hidden" };
  const history = station.status === "ok" ? station.history : null;
  if (history == null || history.points.length < 2) {
    return {
      kind: "note",
      className: `${WIND_CHART_CLASS} meteo-wind-chart-na`,
      text: words.noHistory,
    };
  }
  return { kind: "draw", history };
}

export type WindChartInspection = {
  readout: { strong: string; span: ReadoutPart[] };
  cursor: {
    line: SceneLine;
    dot: { className: string; cx: number; cy: number; r: number };
  } | null;
};

export type WindChartScene = {
  frame: ChartFrame;
  scales: ChartScales;
  points: ReadonlyArray<HistoryPoint>;
  readout: { ariaLabel: string; className: string };
  svg: { ariaLabel: string; className: string; height: number; viewBox: string; width: number };
  defs: {
    pattern: GapHatchPattern;
    clip: { id: string; rect: { height: number; width: number; x: number; y: number } };
  };
  zones: Array<{
    key: number;
    className: string;
    height: number;
    width: number;
    x: number;
    y: number;
  }>;
  nightRects: Array<{
    key: number;
    className: string;
    height: number;
    width: number;
    x: number;
    y: number;
  }>;
  grid: Array<{ key: number; line: SceneLine; label: SceneText }>;
  thresholdGuides: Array<{ key: number; line: SceneLine; label: SceneText }>;
  vaneGuides: Array<{
    key: number;
    className: string;
    x1: number;
    x2: number;
    y1: number;
    y2: number;
  }>;
  gaps: Array<{
    key: number;
    className: string;
    fill: string;
    height: number;
    width: number;
    x: number;
    y: number;
  }>;
  band: { className: string; points: string } | null;
  compare: { className: string; clipPath: string; points: string } | null;
  mean: GradedMeanTrace;
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
  inspect: (activeIndex: number | null) => WindChartInspection;
};

export function windChartScene(input: {
  compareOffsetDays: number | undefined;
  favorableDirections?: FavorableDirection[] | undefined;
  formatTime: FormatTime;
  hatchId: string;
  history: History;
  /** Coordinates for night shading; absent or incomplete draws none. */
  night?: { latitude: number | null; longitude: number | null } | null | undefined;
  plotHeight: number | undefined;
  stationName: string;
  thresholds: SpeedThresholds | undefined;
  unit: SpeedUnit;
  width: number;
  windowHours: number | undefined;
  words: StationStrings;
}): WindChartScene {
  const {
    compareOffsetDays,
    formatTime,
    hatchId,
    history,
    plotHeight,
    stationName,
    thresholds,
    unit,
    width,
    windowHours,
    words,
  } = input;
  const points = windowPoints(history.points, windowHours);
  const shown = (speedMps: number) => roundSpeed(speedMps, unit);

  const frame = stretchedChartFrame(width, plotHeight);
  const scales = displaySpeedScales(points, frame, unit);
  const band = bandPoints(points, scales);
  const vanes = thinVanes(points);
  const gaps = historyGaps({ ...history, points: points as HistoryPoint[] });

  const comparePoints =
    compareOffsetDays == null
      ? null
      : compareWindow(history.points, compareOffsetDays, windowHours);
  const compareTrace =
    comparePoints == null || compareOffsetDays == null
      ? null
      : compareTracePoints(comparePoints, scales, compareOffsetDays);

  const boundsMps = thresholds == null ? null : thresholdsToMps(thresholds);

  return {
    frame,
    scales,
    points,
    readout: { ariaLabel: words.aria.readout(stationName), className: "meteo-wind-chart-readout" },
    svg: {
      ariaLabel: words.aria.chart(stationName),
      className: "meteo-wind-chart-svg",
      height: frame.height,
      viewBox: `0 0 ${frame.width} ${frame.height}`,
      width: frame.width,
    },
    defs: {
      pattern: gapHatchPattern(hatchId),
      clip: {
        id: `${hatchId}-plot`,
        rect: {
          height: frame.plotBottom - frame.plotTop,
          width: frame.right - frame.left,
          x: frame.left,
          y: frame.plotTop,
        },
      },
    },
    zones: windZoneRects(boundsMps, frame, scales),
    nightRects: nightRects(points, frame, scales, input.night),
    grid: speedGridLines(frame, scales, shown),
    thresholdGuides: windThresholdGuides(thresholds, boundsMps, unit, frame, scales, shown),
    vaneGuides: vaneGuideLines(vanes, frame, scales),
    gaps: gaps.map(([startMs, endMs]) =>
      gapHatchRect(
        hatchId,
        frame,
        startMs,
        scales.xAtMs(startMs),
        scales.xAtMs(endMs) - scales.xAtMs(startMs),
      ),
    ),
    band: band == null ? null : { className: "meteo-wind-band", points: band },
    compare:
      compareTrace == null
        ? null
        : {
            className: "meteo-wind-compare",
            clipPath: `url(#${hatchId}-plot)`,
            points: compareTrace,
          },
    mean: gradedMeanTrace(points, scales, boundsMps),
    calmNote: isCalmHistory(points) ? calmNoteText(frame, words) : null,
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
      const lead = `${words.avgLabel} ${shown(active.windAvgMps)} · ${words.lullLabel} ${
        active.windLullMps == null ? EM_DASH : shown(active.windLullMps)
      } · ${words.gustLabel} ${
        active.windGustMps == null ? EM_DASH : shown(active.windGustMps)
      } ${words.speedUnits[unit]} · `;
      const span: ReadoutPart[] = isCalm(active.windAvgMps)
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
          dot: { className: "meteo-cursor-dot", cx: x, cy: scales.yAt(active.windAvgMps), r: 3 },
        },
      };
    },
  };
}
