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
import type { ReadoutPart } from "./chart.js";
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
import { plotLine } from "./wind-plot.js";
import { el, type SceneAttrValue, type SceneChild, type SceneNode } from "./node.js";

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
  /** The cursor line and dot, drawn inside the plot; empty when idle. */
  cursor: SceneChild[];
};

export type WindChartScene = {
  frame: ChartFrame;
  scales: ChartScales;
  points: ReadonlyArray<HistoryPoint>;
  readout: { ariaLabel: string; className: string };
  svg: { ariaLabel: string; className: string; height: number; viewBox: string; width: number };
  /** The whole drawing; the cursor from `inspect` slots in above the hit area. */
  draw: (cursor: SceneChild[], hit: Record<string, SceneAttrValue>) => SceneNode;
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
  const vaneCellList = vaneCells(
    vanes,
    frame,
    scales,
    (vane) => String(shown(vane.windAvgMps)),
    input.favorableDirections,
  );
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
    draw: (cursor, hit) =>
      el(
        "svg",
        {
          "aria-label": words.aria.chart(stationName),
          class: "meteo-wind-chart-svg",
          height: frame.height,
          role: "img",
          viewBox: `0 0 ${frame.width} ${frame.height}`,
          width: frame.width,
        },
        el(
          "defs",
          undefined,
          gapHatchPattern(hatchId),
          el(
            "clipPath",
            { id: `${hatchId}-plot` },
            el("rect", {
              height: frame.plotBottom - frame.plotTop,
              width: frame.right - frame.left,
              x: frame.left,
              y: frame.plotTop,
            }),
          ),
        ),
        windZoneRects(boundsMps, frame, scales),
        nightRects(points, frame, scales, input.night),
        speedGridLines(frame, scales, shown),
        windThresholdGuides(thresholds, boundsMps, unit, frame, scales, shown),
        vaneGuideLines(vanes, frame, scales),
        gaps.map(([startMs, endMs]) =>
          gapHatchRect(
            hatchId,
            frame,
            startMs,
            scales.xAtMs(startMs),
            scales.xAtMs(endMs) - scales.xAtMs(startMs),
          ),
        ),
        band == null ? null : el("polygon", { class: "meteo-wind-band", points: band }),
        compareTrace == null
          ? null
          : el("polyline", {
              class: "meteo-wind-compare",
              "clip-path": `url(#${hatchId}-plot)`,
              points: compareTrace,
            }),
        gradedMeanTrace(points, scales, boundsMps),
        isCalmHistory(points) ? calmNoteText(frame, words) : null,
        windRowLabels(frame, words)[0],
        vaneCellList.map((vane) => ({ ...vane.mark, key: String(vane.key) })),
        vaneCellList.flatMap((vane) =>
          vane.label == null ? [] : [{ ...vane.label, key: String(vane.key) }],
        ),
        windRowLabels(frame, words)[1],
        vaneCellList.flatMap((vane) =>
          vane.value == null ? [] : [{ ...vane.value, key: String(vane.key) }],
        ),
        vaneTickTexts(vanes, frame, scales, (timeMs) => formatTime(new Date(timeMs))),
        cursor,
        el("rect", {
          class: "meteo-hit",
          fill: "transparent",
          height: frame.height,
          width: frame.width,
          x: 0,
          y: 0,
          ...hit,
        }),
      ),
    inspect: (activeIndex) => {
      const active = activeIndex == null ? undefined : points[activeIndex];
      if (active == null) {
        return {
          readout: {
            strong: `${formatTime(new Date(scales.startMs))}–${formatTime(new Date(scales.endMs))}`,
            span: [{ kind: "text", text: words.inspectHint }],
          },
          cursor: [],
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
        cursor: [
          plotLine({ class: "meteo-cursor" }, x, x, frame.plotTop, frame.vaneRow + 9),
          el("circle", {
            class: "meteo-cursor-dot",
            cx: x,
            cy: scales.yAt(active.windAvgMps),
            r: 3,
          }),
        ],
      };
    },
  };
}
