import type { ForecastHour } from "../../contract.js";
import { p50 } from "../../derive/ensemble.js";
import type { ThermalWindowFinding } from "./thermal-window.js";
import { climbBandMaxWind } from "./wind-summary.js";
import { round2, type CitedInstant, type Context, type LocalDayKey } from "./shared.js";

/**
 * Maximal runs of thermalWindow hours whose surface wind, gust, or
 * climb-band wind stands at or above a caller-supplied ceiling
 * (`AnalyzeOptions.windCeilings`). The package never owns a ceiling — a
 * quantity without one emits nothing, and gust runs are extracted only
 * when the document declares its gust semantics and the caller supplied
 * that class's ceiling, never a silently misread threshold. A day
 * without a window emits nothing whatever the wind.
 */
export interface WindExceedanceFinding {
  kind: "windExceedance";
  day: LocalDayKey;
  quantity: "surfaceWind" | "gust" | "bandWind";
  /** The caller's ceiling, echoed verbatim — the value actually applied. */
  thresholdMps: number;
  /** The document's semantics.gust echo; present iff quantity is "gust". */
  gustSemantics?: "hourMax" | "instant";
  /** The widest covered step among the day's scope hours — the quantization bound on every run length below. */
  stepHours: number;
  runs: Array<{
    start: CitedInstant;
    end: CitedInstant;
    /** Covered span of the run's cited hours at the actual cadence. */
    hours: number;
    peakMps: number;
    peakAt: CitedInstant;
  }>;
  /** The per-hour series over exactly the day's thermalWindow hours (null where the hour publishes no value for the quantity). */
  evidence: { hours: string[]; valueMps: (number | null)[] };
}

export function findWindExceedance(
  context: Context,
  windows: ThermalWindowFinding[],
): WindExceedanceFinding[] {
  const ceilings = context.windCeilings;
  if (!ceilings) return [];
  const { profile, launchReferenceM, steps } = context;
  const { bandMarginM } = context.thresholds.windSummary;

  const hourByValidAt = new Map(profile.hours.map((hour) => [hour.validAt, hour]));
  const windowHoursByDay = new Map<string, string[]>();
  for (const window of windows) {
    const bucket = windowHoursByDay.get(window.day) ?? [];
    bucket.push(...window.evidence.hours);
    windowHoursByDay.set(window.day, bucket);
  }

  const gustSemantics = profile.semantics?.gust;
  const gustCeilingMps =
    gustSemantics === "hourMax"
      ? ceilings.gust?.hourMaxMps
      : gustSemantics === "instant"
        ? ceilings.gust?.instantMps
        : undefined;
  const quantities: Array<{
    quantity: WindExceedanceFinding["quantity"];
    thresholdMps: number;
    gustSemantics?: "hourMax" | "instant";
    valueOf: (hour: ForecastHour) => number | null;
  }> = [];
  if (ceilings.surfaceMps !== undefined) {
    quantities.push({
      quantity: "surfaceWind",
      thresholdMps: ceilings.surfaceMps,
      valueOf: (hour) => p50(hour.surface.windSpeedMps),
    });
  }
  if (gustSemantics !== undefined && gustCeilingMps !== undefined) {
    quantities.push({
      quantity: "gust",
      thresholdMps: gustCeilingMps,
      gustSemantics,
      valueOf: (hour) => p50(hour.surface.windGustMps),
    });
  }
  if (ceilings.bandMps !== undefined) {
    quantities.push({
      quantity: "bandWind",
      thresholdMps: ceilings.bandMps,
      valueOf: (hour) => climbBandMaxWind(hour, launchReferenceM, bandMarginM)?.windMps ?? null,
    });
  }
  if (quantities.length === 0) return [];

  const findings: WindExceedanceFinding[] = [];
  for (const [day, windowHours] of windowHoursByDay) {
    const indices = windowHours.map((validAt) => steps.indexOf.get(validAt)!);
    for (const entry of quantities) {
      const values = windowHours.map((validAt) => entry.valueOf(hourByValidAt.get(validAt)!));

      const runs: WindExceedanceFinding["runs"] = [];
      let index = 0;
      while (index < windowHours.length) {
        const value = values[index];
        if (value === null || value < entry.thresholdMps) {
          index += 1;
          continue;
        }
        let last = index;
        while (
          last + 1 < windowHours.length &&
          indices[last + 1] === indices[last] + 1 &&
          values[last + 1] !== null &&
          values[last + 1]! >= entry.thresholdMps
        ) {
          last += 1;
        }
        let peakIndex = index;
        let coveredHours = 0;
        for (let i = index; i <= last; i += 1) {
          coveredHours += steps.after[indices[i]];
          if (values[i]! > values[peakIndex]!) peakIndex = i;
        }
        runs.push({
          start: context.cite(windowHours[index]),
          end: context.cite(windowHours[last]),
          hours: coveredHours,
          peakMps: round2(values[peakIndex]!),
          peakAt: context.cite(windowHours[peakIndex]),
        });
        index = last + 1;
      }
      if (runs.length === 0) continue;

      findings.push({
        kind: "windExceedance",
        day,
        quantity: entry.quantity,
        thresholdMps: entry.thresholdMps,
        ...(entry.gustSemantics ? { gustSemantics: entry.gustSemantics } : {}),
        stepHours: Math.max(...indices.map((i) => steps.after[i])),
        runs,
        evidence: {
          hours: [...windowHours],
          valueMps: values.map((value) => (value === null ? null : round2(value))),
        },
      });
    }
  }
  return findings;
}
