import type { HistoryPoint, Station } from "../contract.js";
import { isCalm, thresholdsToMps } from "../derive.js";
import type { SpeedThresholds, SpeedUnit } from "../derive.js";
import { roundSpeed } from "../format.js";
import { dailyPattern, thinVanes } from "../geometry.js";
import type { ChartFrame, ChartScales, DailyPatternSlot } from "../geometry.js";
import { EM_DASH } from "../strings.js";
import type { StationStrings } from "../strings.js";
import type { TickAnchor } from "./chart.js";
import {
  calmNoteText,
  displaySpeedScales,
  gapHatchPattern,
  gapHatchRect,
  gradedMeanTrace,
  speedGridLines,
  stretchedChartFrame,
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

export const DAILY_PATTERN_CLASS = "meteo-daily-pattern";

const SYNTHETIC_EPOCH_MS = Date.parse("2000-01-01T00:00:00Z");

export function dailyPatternSource(
  points: HistoryPoint[] | undefined,
  station: Station | undefined,
): { source: HistoryPoint[]; periodMinutes: number | null } {
  const source =
    points ?? (station?.status === "ok" ? (station.history?.points ?? null) : null) ?? [];
  const periodMinutes =
    points == null && station?.status === "ok" ? (station.history?.periodMinutes ?? null) : null;
  return { source: source as HistoryPoint[], periodMinutes };
}

export type DailyPatternGate = { kind: "draw" } | { kind: "note"; className: string; text: string };

export function dailyPatternGate(
  source: ReadonlyArray<HistoryPoint>,
  words: StationStrings,
): DailyPatternGate {
  if (source.length === 0) {
    return {
      kind: "note",
      className: `${DAILY_PATTERN_CLASS} meteo-daily-pattern-na`,
      text: words.noHistory,
    };
  }
  return { kind: "draw" };
}

function slotPoint(slot: DailyPatternSlot, slotMinutes: number): HistoryPoint {
  return {
    observedAt: new Date(
      SYNTHETIC_EPOCH_MS + (slot.startMinuteOfDay + slotMinutes / 2) * 60_000,
    ).toISOString(),
    windAvgMps: slot.speedMps,
    windGustMps: null,
    windLullMps: null,
    windDirectionDeg: slot.windDirectionDeg,
    temperatureC: null,
  };
}

function formatMinuteOfDay(minuteOfDay: number): string {
  const clamped = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440;
  const hours = String(Math.floor(clamped / 60)).padStart(2, "0");
  const minutes = String(clamped % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export type DailyPatternScene = {
  frame: ChartFrame;
  scales: ChartScales;
  caption: { className: string; text: string };
  svg: { ariaLabel: string; className: string; height: number; viewBox: string; width: number };
  defs: { pattern: GapHatchPattern };
  zones: Array<{
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
};

export function dailyPatternScene(input: {
  hatchId: string;
  periodMinutes: number | null;
  plotHeight: number | undefined;
  points: ReadonlyArray<HistoryPoint>;
  slotMinutes: number;
  stationName: string | undefined;
  thresholds: SpeedThresholds | undefined;
  unit: SpeedUnit;
  utcOffsetMinutes: number;
  width: number;
  words: StationStrings;
}): DailyPatternScene {
  const {
    hatchId,
    periodMinutes,
    plotHeight,
    points,
    slotMinutes,
    stationName,
    thresholds,
    unit,
    utcOffsetMinutes,
    width,
    words,
  } = input;
  const shown = (speedMps: number) => roundSpeed(speedMps, unit);

  const slots = dailyPattern(points, { slotMinutes, utcOffsetMinutes });
  const synthetic = slots.map((slot) => slotPoint(slot, slotMinutes));
  const totalSamples = slots.reduce((sum, slot) => sum + slot.sampleCount, 0);
  const daysSpanned =
    points.length < 2
      ? null
      : (Date.parse((points[points.length - 1] as HistoryPoint).observedAt) -
          Date.parse((points[0] as HistoryPoint).observedAt)) /
        86_400_000;
  const expectedSamples =
    periodMinutes != null && daysSpanned != null && daysSpanned > 0
      ? Math.round((slotMinutes / periodMinutes) * daysSpanned * slots.length)
      : null;

  const frame = stretchedChartFrame(width, plotHeight);
  const scales = displaySpeedScales(synthetic, frame, unit);
  const vanes = thinVanes(synthetic);
  const calm = synthetic.every((point) => isCalm(point.windAvgMps));

  const boundsMps = thresholds == null ? null : thresholdsToMps(thresholds);

  const voidSpans = slots
    .filter((slot) => slot.sampleCount === 0)
    .map((slot): [number, number] => [
      scales.xAtMs(SYNTHETIC_EPOCH_MS + slot.startMinuteOfDay * 60_000),
      scales.xAtMs(SYNTHETIC_EPOCH_MS + (slot.startMinuteOfDay + slotMinutes) * 60_000),
    ]);

  return {
    frame,
    scales,
    caption: {
      className: "meteo-daily-pattern-caption",
      text:
        expectedSamples != null
          ? words.dailyPatternCoverage(totalSamples, expectedSamples)
          : words.dailyPatternSamples(totalSamples),
    },
    svg: {
      ariaLabel: stationName
        ? words.aria.dailyPattern(stationName)
        : words.aria.dailyPatternGeneric,
      className: "meteo-daily-pattern-svg",
      height: frame.height,
      viewBox: `0 0 ${frame.width} ${frame.height}`,
      width: frame.width,
    },
    defs: { pattern: gapHatchPattern(hatchId) },
    zones: windZoneRects(boundsMps, frame, scales),
    grid: speedGridLines(frame, scales, shown),
    thresholdGuides: windThresholdGuides(thresholds, boundsMps, unit, frame, scales, shown),
    vaneGuides: vaneGuideLines(vanes, frame, scales),
    gaps: voidSpans.map(([startX, endX]) =>
      gapHatchRect(hatchId, frame, startX, startX, endX - startX),
    ),
    mean: gradedMeanTrace(synthetic, scales, boundsMps),
    calmNote: calm ? calmNoteText(frame, words) : null,
    rowLabels: windRowLabels(frame, words),
    vanes: vaneCells(vanes, frame, scales, (vane) =>
      slots.slice(vane.startIndex, vane.endIndex).every((slot) => slot.sampleCount === 0)
        ? EM_DASH
        : String(shown(vane.windAvgMps)),
    ),
    ticks: vaneTickTexts(vanes, frame, scales, (timeMs) =>
      formatMinuteOfDay((timeMs - SYNTHETIC_EPOCH_MS) / 60_000),
    ),
  };
}
