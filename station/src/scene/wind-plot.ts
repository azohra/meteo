import type { HistoryPoint } from "../contract.js";
import { compassDirection, speedToMps } from "../derive.js";
import type { SpeedThresholds, SpeedUnit } from "../derive.js";
import {
  CHART_WIDE_PLOT_HEIGHT,
  CHART_WIDE_PLOT_MIN_WIDTH,
  averagePoints,
  chartFrame,
  chartScales,
  speedBand,
  stretchFrame,
  vanePath,
  vaneTicks,
} from "../geometry.js";
import type { ChartFrame, ChartScales, Vane } from "../geometry.js";
import { EM_DASH } from "../strings.js";
import type { StationStrings } from "../strings.js";
import { tickAnchor } from "./chart.js";
import type { TickAnchor } from "./chart.js";

export type SceneText = {
  className: string;
  anchor: TickAnchor;
  x: number;
  y: number;
  text: string;
};
export type SceneLine = { className: string; x1: number; x2: number; y1: number; y2: number };

export function stretchedChartFrame(width: number, plotHeight: number | undefined): ChartFrame {
  const core = chartFrame(width);
  const corePlotHeight = core.plotBottom - core.plotTop;
  return stretchFrame(
    core,
    plotHeight ??
      (width < CHART_WIDE_PLOT_MIN_WIDTH
        ? corePlotHeight
        : Math.max(corePlotHeight, CHART_WIDE_PLOT_HEIGHT)),
  );
}

export function displaySpeedScales(
  points: ReadonlyArray<HistoryPoint>,
  frame: ChartFrame,
  unit: SpeedUnit,
): ChartScales {
  return chartScales(points, frame, {
    niceStepMps: speedToMps(5, unit),
    floorMps: speedToMps(10, unit),
  });
}

export function speedGridLines(
  frame: ChartFrame,
  scales: ChartScales,
  shown: (speedMps: number) => number,
): Array<{ key: number; line: SceneLine; label: SceneText }> {
  return [0, 0.5, 1].map((fraction) => {
    const gridY = frame.plotBottom - fraction * (frame.plotBottom - frame.plotTop);
    return {
      key: fraction,
      line: { className: "meteo-grid-line", x1: frame.left, x2: frame.right, y1: gridY, y2: gridY },
      label: {
        className: "meteo-grid-label",
        anchor: "end" as TickAnchor,
        x: frame.left - 6,
        y: gridY + 5,
        text: String(shown(scales.scaleMax * fraction)),
      },
    };
  });
}

export function windThresholdGuides(
  thresholds: SpeedThresholds | undefined,
  boundsMps: number[] | null,
  unit: SpeedUnit,
  frame: ChartFrame,
  scales: ChartScales,
  shown: (speedMps: number) => number,
): Array<{ key: number; line: SceneLine; label: SceneText }> {
  if (thresholds == null || boundsMps == null) return [];
  return boundsMps
    .map((boundMps, index) => ({
      boundMps,
      label: unit === thresholds.unit ? String(thresholds.values[index]) : String(shown(boundMps)),
    }))
    .filter(({ boundMps }) => boundMps > 0 && boundMps <= scales.scaleMax)
    .map(({ boundMps, label }) => ({
      key: boundMps,
      line: {
        className: `meteo-wind-threshold meteo-band-${speedBand(boundMps, boundsMps)}`,
        x1: frame.left,
        x2: frame.right,
        y1: scales.yAt(boundMps),
        y2: scales.yAt(boundMps),
      },
      label: {
        className: `meteo-wind-threshold-label meteo-band-${speedBand(boundMps, boundsMps)}`,
        anchor: "end" as TickAnchor,
        x: frame.right - 3,
        y: scales.yAt(boundMps) - 3,
        text: label,
      },
    }));
}

export function windZoneRects(
  boundsMps: number[] | null,
  frame: ChartFrame,
  scales: ChartScales,
): Array<{ key: number; className: string; height: number; width: number; x: number; y: number }> {
  if (boundsMps == null) return [];
  const cuts = [
    0,
    ...boundsMps.filter((bound) => bound > 0 && bound < scales.scaleMax),
    scales.scaleMax,
  ];
  return cuts.slice(0, -1).map((lower, index) => {
    const upper = cuts[index + 1] as number;
    return {
      key: lower,
      className: `meteo-wind-zone meteo-band-${speedBand((lower + upper) / 2, boundsMps)}`,
      height: scales.yAt(lower) - scales.yAt(upper),
      width: frame.right - frame.left,
      x: frame.left,
      y: scales.yAt(upper),
    };
  });
}

export function vaneGuideLines(
  vanes: ReadonlyArray<Vane>,
  frame: ChartFrame,
  scales: ChartScales,
): Array<{ key: number; className: string; x1: number; x2: number; y1: number; y2: number }> {
  return vanes.map((vane) => ({
    key: vane.midMs,
    className: "meteo-wind-guide",
    x1: scales.xAtMs(vane.midMs),
    x2: scales.xAtMs(vane.midMs),
    y1: frame.plotTop,
    y2: frame.vaneRow - 9,
  }));
}

export type GapHatchPattern = {
  id: string;
  width: string;
  height: string;
  transform: string;
  units: string;
  line: { className: string; x1: string; x2: string; y1: string; y2: string };
};

export function gapHatchPattern(hatchId: string): GapHatchPattern {
  return {
    id: hatchId,
    width: "6",
    height: "6",
    transform: "rotate(45)",
    units: "userSpaceOnUse",
    line: { className: "meteo-wind-gap-hatch", x1: "0", x2: "0", y1: "0", y2: "6" },
  };
}

export function gapHatchRect(
  hatchId: string,
  frame: ChartFrame,
  key: number,
  x: number,
  width: number,
): {
  key: number;
  className: string;
  fill: string;
  height: number;
  width: number;
  x: number;
  y: number;
} {
  return {
    key,
    className: "meteo-wind-gap",
    fill: `url(#${hatchId})`,
    height: frame.plotBottom - frame.plotTop,
    width,
    x,
    y: frame.plotTop,
  };
}

export type GradedMeanTrace =
  | { kind: "polyline"; className: string; points: string }
  | {
      kind: "segments";
      segments: Array<{
        key: string;
        className: string;
        x1: number;
        x2: number;
        y1: number;
        y2: number;
      }>;
    };

export function gradedMeanTrace(
  points: ReadonlyArray<HistoryPoint>,
  scales: ChartScales,
  boundsMps: number[] | null,
): GradedMeanTrace {
  if (boundsMps == null) {
    return {
      kind: "polyline",
      className: "meteo-wind-mean",
      points: averagePoints(points, scales),
    };
  }
  return {
    kind: "segments",
    segments: points.slice(1).map((point, index) => {
      const previous = points[index] as HistoryPoint;
      return {
        key: point.observedAt,
        className: `meteo-wind-mean-segment meteo-band-${speedBand(
          (previous.windAvgMps + point.windAvgMps) / 2,
          boundsMps,
        )}`,
        x1: scales.xAt(previous.observedAt),
        x2: scales.xAt(point.observedAt),
        y1: scales.yAt(previous.windAvgMps),
        y2: scales.yAt(point.windAvgMps),
      };
    }),
  };
}

export function calmNoteText(frame: ChartFrame, words: StationStrings): SceneText {
  return {
    className: "meteo-wind-calm-note",
    anchor: "middle",
    x: (frame.left + frame.right) / 2,
    y: (frame.plotTop + frame.plotBottom) / 2 + 4,
    text: words.calmHistory,
  };
}

export function windRowLabels(
  frame: ChartFrame,
  words: StationStrings,
): { to: SceneText; avg: SceneText } {
  return {
    to: {
      className: "meteo-wind-row-label",
      anchor: "end",
      x: frame.left - 8,
      y: frame.vaneRow + 4,
      text: words.toLabel,
    },
    avg: {
      className: "meteo-wind-row-label",
      anchor: "end",
      x: frame.left - 8,
      y: frame.valueRow + 4,
      text: words.avgLabel,
    },
  };
}

export type VaneCell = {
  key: number;
  mark: { kind: "calm"; text: SceneText } | { kind: "vane"; className: string; d: string };
  label: SceneText;
  value: SceneText;
};

export function vaneCells(
  vanes: ReadonlyArray<Vane>,
  frame: ChartFrame,
  scales: ChartScales,
  valueText: (vane: Vane) => string,
): VaneCell[] {
  return vanes.map((vane) => ({
    key: vane.midMs,
    mark:
      vane.windDirectionDeg == null
        ? {
            kind: "calm" as const,
            text: {
              className: "meteo-wind-vane-calm",
              anchor: "middle" as TickAnchor,
              x: scales.xAtMs(vane.midMs),
              y: frame.vaneRow + 4,
              text: EM_DASH,
            },
          }
        : {
            kind: "vane" as const,
            className: "meteo-wind-vane",
            d: vanePath(scales.xAtMs(vane.midMs), frame.vaneRow, vane.windDirectionDeg),
          },
    label: {
      className: "meteo-wind-vane-label",
      anchor: "middle" as TickAnchor,
      x: scales.xAtMs(vane.midMs),
      y: frame.vaneLabelRow + 4,
      text: vane.windDirectionDeg == null ? EM_DASH : compassDirection(vane.windDirectionDeg),
    },
    value: {
      className: "meteo-wind-vane-value",
      anchor: "middle" as TickAnchor,
      x: scales.xAtMs(vane.midMs),
      y: frame.valueRow + 4,
      text: valueText(vane),
    },
  }));
}

export function vaneTickTexts(
  vanes: ReadonlyArray<Vane>,
  frame: ChartFrame,
  scales: ChartScales,
  labelText: (timeMs: number) => string,
): Array<{
  key: number;
  className: string;
  anchor: TickAnchor;
  x: number;
  y: number;
  text: string;
}> {
  const ticks = vaneTicks(vanes, scales);
  return ticks.map(({ index, timeMs, x }) => ({
    key: index,
    className: "meteo-tick",
    anchor: tickAnchor(index, ticks.length - 1),
    x,
    y: frame.labelRow,
    text: labelText(timeMs),
  }));
}
