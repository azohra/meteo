import { inDirectionArcs, solarEventsForDate } from "@azohra/meteo.core";
import type { HistoryPoint } from "../contract.js";
import { compassDirection, speedToMps } from "../derive.js";
import type { SpeedThresholds, SpeedUnit } from "../derive.js";
import type { FavorableDirection } from "../instruments.js";
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
import { el, keyed, type SceneChild, type SceneNode } from "./node.js";
import type { TickAnchor } from "./chart.js";

/** A plot label: the anchor is the SVG attribute, spelled as the DOM does. */
export function plotText(
  attrs: { class: string },
  anchor: TickAnchor,
  x: number,
  y: number,
  text: string,
): SceneNode {
  return el("text", { ...attrs, "text-anchor": anchor, x, y }, text);
}

export function plotLine(
  attrs: { class: string },
  x1: number,
  x2: number,
  y1: number,
  y2: number,
): SceneNode {
  return el("line", { ...attrs, x1, x2, y1, y2 });
}

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
): SceneChild[] {
  return [0, 0.5, 1].map((fraction) => {
    const gridY = frame.plotBottom - fraction * (frame.plotBottom - frame.plotTop);
    return keyed(
      String(fraction),
      "g",
      undefined,
      plotLine({ class: "meteo-grid-line" }, frame.left, frame.right, gridY, gridY),
      plotText(
        { class: "meteo-grid-label" },
        "end",
        frame.left - 6,
        gridY + 5,
        String(shown(scales.scaleMax * fraction)),
      ),
    );
  });
}

export function windThresholdGuides(
  thresholds: SpeedThresholds | undefined,
  boundsMps: number[] | null,
  unit: SpeedUnit,
  frame: ChartFrame,
  scales: ChartScales,
  shown: (speedMps: number) => number,
): SceneChild[] {
  if (thresholds == null || boundsMps == null) return [];
  return boundsMps
    .map((boundMps, index) => ({
      boundMps,
      label: unit === thresholds.unit ? String(thresholds.values[index]) : String(shown(boundMps)),
    }))
    .filter(({ boundMps }) => boundMps > 0 && boundMps <= scales.scaleMax)
    .map(({ boundMps, label }) =>
      keyed(
        String(boundMps),
        "g",
        undefined,
        plotLine(
          { class: `meteo-wind-threshold meteo-band-${speedBand(boundMps, boundsMps)}` },
          frame.left,
          frame.right,
          scales.yAt(boundMps),
          scales.yAt(boundMps),
        ),
        plotText(
          { class: `meteo-wind-threshold-label meteo-band-${speedBand(boundMps, boundsMps)}` },
          "end",
          frame.right - 3,
          scales.yAt(boundMps) - 3,
          label,
        ),
      ),
    );
}

export function windZoneRects(
  boundsMps: number[] | null,
  frame: ChartFrame,
  scales: ChartScales,
): SceneChild[] {
  if (boundsMps == null) return [];
  const cuts = [
    0,
    ...boundsMps.filter((bound) => bound > 0 && bound < scales.scaleMax),
    scales.scaleMax,
  ];
  return cuts.slice(0, -1).map((lower, index) => {
    const upper = cuts[index + 1] as number;
    return keyed(String(lower), "rect", {
      class: `meteo-wind-zone meteo-band-${speedBand((lower + upper) / 2, boundsMps)}`,
      height: scales.yAt(lower) - scales.yAt(upper),
      width: frame.right - frame.left,
      x: frame.left,
      y: scales.yAt(upper),
    });
  });
}

export function vaneGuideLines(
  vanes: ReadonlyArray<Vane>,
  frame: ChartFrame,
  scales: ChartScales,
): SceneChild[] {
  return vanes.map((vane) => ({
    ...plotLine(
      { class: "meteo-wind-guide" },
      scales.xAtMs(vane.midMs),
      scales.xAtMs(vane.midMs),
      frame.plotTop,
      frame.vaneRow - 9,
    ),
    key: String(vane.midMs),
  }));
}

export function gapHatchPattern(hatchId: string): SceneNode {
  return el(
    "pattern",
    {
      height: "6",
      id: hatchId,
      patternTransform: "rotate(45)",
      patternUnits: "userSpaceOnUse",
      width: "6",
    },
    el("line", { class: "meteo-wind-gap-hatch", x1: "0", x2: "0", y1: "0", y2: "6" }),
  );
}

export function gapHatchRect(
  hatchId: string,
  frame: ChartFrame,
  key: number,
  x: number,
  width: number,
): SceneNode {
  return keyed(String(key), "rect", {
    class: "meteo-wind-gap",
    fill: `url(#${hatchId})`,
    height: frame.plotBottom - frame.plotTop,
    width,
    x,
    y: frame.plotTop,
  });
}

export function gradedMeanTrace(
  points: ReadonlyArray<HistoryPoint>,
  scales: ChartScales,
  boundsMps: number[] | null,
): SceneChild[] {
  if (boundsMps == null) {
    return [el("polyline", { class: "meteo-wind-mean", points: averagePoints(points, scales) })];
  }
  return points.slice(1).map((point, index) => {
    const previous = points[index] as HistoryPoint;
    return {
      ...plotLine(
        {
          class: `meteo-wind-mean-segment meteo-band-${speedBand(
            (previous.windAvgMps + point.windAvgMps) / 2,
            boundsMps,
          )}`,
        },
        scales.xAt(previous.observedAt),
        scales.xAt(point.observedAt),
        scales.yAt(previous.windAvgMps),
        scales.yAt(point.windAvgMps),
      ),
      key: point.observedAt,
    };
  });
}

export function calmNoteText(frame: ChartFrame, words: StationStrings): SceneNode {
  return plotText(
    { class: "meteo-wind-calm-note" },
    "middle",
    (frame.left + frame.right) / 2,
    (frame.plotTop + frame.plotBottom) / 2 + 4,
    words.calmHistory,
  );
}

export function windRowLabels(frame: ChartFrame, words: StationStrings): SceneChild[] {
  return [
    {
      ...plotText(
        { class: "meteo-wind-row-label" },
        "end",
        frame.left - 8,
        frame.vaneRow + 4,
        words.toLabel,
      ),
      key: "to",
    },
    {
      ...plotText(
        { class: "meteo-wind-row-label" },
        "end",
        frame.left - 8,
        frame.valueRow + 4,
        words.avgLabel,
      ),
      key: "avg",
    },
  ];
}

/* Night shading: gray columns from each sunset to the next sunrise. No
 * coordinates, no shading; polar day and night draw nothing. */
export function nightRects(
  points: ReadonlyArray<HistoryPoint>,
  frame: ChartFrame,
  scales: ChartScales,
  night: { latitude: number | null; longitude: number | null } | null | undefined,
): SceneChild[] {
  if (night?.latitude == null || night?.longitude == null || points.length < 2) return [];
  const startMs = Date.parse((points[0] as HistoryPoint).observedAt);
  const endMs = Date.parse((points[points.length - 1] as HistoryPoint).observedAt);
  const rects: SceneChild[] = [];
  const dayMs = 86_400_000;
  for (
    let dayStart = Math.floor(startMs / dayMs - 1) * dayMs;
    dayStart <= endMs;
    dayStart += dayMs
  ) {
    const today = solarEventsForDate(
      new Date(dayStart).toISOString().slice(0, 10),
      night.latitude,
      night.longitude,
    );
    const tomorrow = solarEventsForDate(
      new Date(dayStart + dayMs).toISOString().slice(0, 10),
      night.latitude,
      night.longitude,
    );
    if (today == null || tomorrow == null) continue;
    const darkFrom = Math.max(today.sunset.getTime(), startMs);
    const darkTo = Math.min(tomorrow.sunrise.getTime(), endMs);
    if (darkFrom >= darkTo) continue;
    const x = scales.xAtMs(darkFrom);
    rects.push(
      keyed(String(dayStart), "rect", {
        class: "meteo-night",
        height: frame.plotBottom - frame.plotTop,
        width: scales.xAtMs(darkTo) - x,
        x,
        y: frame.plotTop,
      }),
    );
  }
  return rects;
}

export type VaneCell = {
  key: number;
  mark: SceneNode;
  /** Null when the width cannot seat this vane's label; the arrow still draws. */
  label: SceneNode | null;
  value: SceneNode | null;
};

/* Px one label needs beside its neighbours (TRIAL, measured at shipped sizes). */
const COMPASS_LABEL_PX = 30;
const VALUE_LABEL_PX = 24;
const TIME_LABEL_PX = 76;

export function vaneCells(
  vanes: ReadonlyArray<Vane>,
  frame: ChartFrame,
  scales: ChartScales,
  valueText: (vane: Vane) => string,
  favorableDirections?: ReadonlyArray<FavorableDirection>,
): VaneCell[] {
  /* Verdict classes appear only when the consumer supplied arcs; a calm
   * vane never carries one — calm has no direction to judge. */
  const verdict = (directionDeg: number) =>
    favorableDirections == null || favorableDirections.length === 0
      ? ""
      : inDirectionArcs(directionDeg, favorableDirections)
        ? " meteo-wind-vane-favorable"
        : " meteo-wind-vane-unfavorable";
  /* Below label pitch only every Nth vane is labeled; the newest always is. */
  const pitch = vanes.length === 0 ? Infinity : (frame.right - frame.left) / vanes.length;
  const step = (needPx: number) => Math.max(1, Math.ceil(needPx / pitch));
  const labelStep = step(COMPASS_LABEL_PX);
  const valueStep = step(VALUE_LABEL_PX);
  const speaks = (index: number, every: number) => (vanes.length - 1 - index) % every === 0;
  return vanes.map((vane, index) => ({
    key: vane.midMs,
    mark:
      vane.windDirectionDeg == null
        ? plotText(
            { class: "meteo-wind-vane-calm" },
            "middle",
            scales.xAtMs(vane.midMs),
            frame.vaneRow + 4,
            EM_DASH,
          )
        : el("path", {
            class: `meteo-wind-vane${verdict(vane.windDirectionDeg)}`,
            d: vanePath(scales.xAtMs(vane.midMs), frame.vaneRow, vane.windDirectionDeg),
          }),
    label: speaks(index, labelStep)
      ? plotText(
          { class: "meteo-wind-vane-label" },
          "middle",
          scales.xAtMs(vane.midMs),
          frame.vaneLabelRow + 4,
          vane.windDirectionDeg == null ? EM_DASH : compassDirection(vane.windDirectionDeg),
        )
      : null,
    value: speaks(index, valueStep)
      ? plotText(
          { class: "meteo-wind-vane-value" },
          "middle",
          scales.xAtMs(vane.midMs),
          frame.valueRow + 4,
          valueText(vane),
        )
      : null,
  }));
}

export function vaneTickTexts(
  vanes: ReadonlyArray<Vane>,
  frame: ChartFrame,
  scales: ChartScales,
  labelText: (timeMs: number) => string,
): SceneChild[] {
  const ticks = vaneTicks(vanes, scales, Math.floor((frame.right - frame.left) / TIME_LABEL_PX));
  return ticks.map(({ index, timeMs, x }) => ({
    ...plotText(
      { class: "meteo-tick" },
      tickAnchor(index, ticks.length - 1),
      x,
      frame.labelRow,
      labelText(timeMs),
    ),
    key: String(index),
  }));
}
