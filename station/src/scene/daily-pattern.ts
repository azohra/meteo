import type { HistoryPoint, Station } from "../contract.js";
import { isCalm, thresholdsToMps } from "../derive.js";
import type { SpeedThresholds, SpeedUnit } from "../derive.js";
import { roundSpeed } from "../format.js";
import { dailyPattern, thinVanes } from "../geometry.js";
import type { DailyPatternSlot } from "../geometry.js";
import type { FavorableDirection } from "../instruments.js";
import { EM_DASH } from "../strings.js";
import type { StationStrings } from "../strings.js";
import { el, type SceneChild } from "./node.js";
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

export const DAILY_PATTERN_CLASS = "meteo-daily-pattern";

const SYNTHETIC_EPOCH_MS = Date.parse("2000-01-01T00:00:00Z");

export function dailyPatternSource(
  points: HistoryPoint[] | undefined,
  station: Station | undefined,
): { source: HistoryPoint[]; periodMinutes: number | null } {
  const source = points ?? (station?.status === "ok" ? station.history?.points : null) ?? [];
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

export function dailyPatternScene(input: {
  favorableDirections?: FavorableDirection[] | undefined;
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
}): SceneChild[] {
  const { periodMinutes, points, slotMinutes, utcOffsetMinutes } = input;
  const slots = dailyPattern(points, { slotMinutes, utcOffsetMinutes });
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
  return dailyPatternSlotsScene({
    ...input,
    slots,
    coverage: {
      totalSamples,
      percent:
        expectedSamples != null && expectedSamples > 0
          ? Math.round((totalSamples / expectedSamples) * 100)
          : null,
    },
  });
}

/** The same scene from pre-aggregated slots — the climatology cube's road:
 * the caller owns the aggregation and the coverage words' inputs. */
export function dailyPatternSlotsScene(input: {
  coverage: { totalSamples: number; percent: number | null };
  favorableDirections?: FavorableDirection[] | undefined;
  hatchId: string;
  plotHeight: number | undefined;
  slotMinutes: number;
  slots: ReadonlyArray<DailyPatternSlot>;
  stationName: string | undefined;
  thresholds: SpeedThresholds | undefined;
  unit: SpeedUnit;
  width: number;
  words: StationStrings;
}): SceneChild[] {
  const {
    coverage,
    hatchId,
    plotHeight,
    slotMinutes,
    slots,
    stationName,
    thresholds,
    unit,
    width,
    words,
  } = input;
  const shown = (speedMps: number) => roundSpeed(speedMps, unit);
  const synthetic = slots.map((slot) => slotPoint(slot, slotMinutes));
  const { totalSamples, percent } = coverage;

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

  const vaneCellList = vaneCells(
    vanes,
    frame,
    scales,
    (vane) =>
      slots.slice(vane.startIndex, vane.endIndex).every((slot) => slot.sampleCount === 0)
        ? EM_DASH
        : String(shown(vane.windAvgMps)),
    input.favorableDirections,
  );

  return [
    el(
      "output",
      { class: "meteo-daily-pattern-caption" },
      percent != null
        ? words.dailyPatternCoverage(totalSamples, percent)
        : words.dailyPatternSamples(totalSamples),
    ),
    el(
      "svg",
      {
        "aria-label": stationName
          ? words.aria.dailyPattern(stationName)
          : words.aria.dailyPatternGeneric,
        class: "meteo-daily-pattern-svg",
        height: frame.height,
        role: "img",
        viewBox: `0 0 ${frame.width} ${frame.height}`,
        width: frame.width,
      },
      el("defs", undefined, gapHatchPattern(hatchId)),
      windZoneRects(boundsMps, frame, scales),
      speedGridLines(frame, scales, shown),
      windThresholdGuides(thresholds, boundsMps, unit, frame, scales, shown),
      vaneGuideLines(vanes, frame, scales),
      voidSpans.map(([startX, endX]) =>
        gapHatchRect(hatchId, frame, startX, startX, endX - startX),
      ),
      gradedMeanTrace(synthetic, scales, boundsMps),
      calm ? calmNoteText(frame, words) : null,
      windRowLabels(frame, words)[0],
      vaneCellList.map((vane) => ({ ...vane.mark, key: String(vane.key) })),
      vaneCellList.flatMap((vane) =>
        vane.label == null ? [] : [{ ...vane.label, key: String(vane.key) }],
      ),
      windRowLabels(frame, words)[1],
      vaneCellList.flatMap((vane) =>
        vane.value == null ? [] : [{ ...vane.value, key: String(vane.key) }],
      ),
      vaneTickTexts(vanes, frame, scales, (timeMs) =>
        formatMinuteOfDay((timeMs - SYNTHETIC_EPOCH_MS) / 60_000),
      ),
    ),
  ];
}
