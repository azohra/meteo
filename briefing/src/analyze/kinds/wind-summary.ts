import type { ForecastHour } from "../../contract.js";
import { localDateKey } from "../../derive/day-window.js";
import { p50 } from "../../derive/ensemble.js";
import type { ThermalWindowFinding } from "./thermal-window.js";
import { round1, round2, type CitedInstant, type Context, type LocalDayKey } from "./shared.js";

/**
 * Strongest surface gust (with declared semantics) and strongest
 * climb-band wind per local day, with altitude and persistence. Whole-day
 * maxima cover every published hour; duringWindow covers airborne hours.
 * No hazard verdicts — safety judgment is downstream's.
 */
export interface WindSummaryFinding {
  kind: "windSummary";
  day: LocalDayKey;
  maxGust?: {
    gustMps: number;
    meanWindMps: number | null;
    at: CitedInstant;
    /** The document's own semantics.gust echo — never pool the classes. */
    semantics?: "hourMax" | "instant";
  };
  maxWindInBand?: {
    windMps: number;
    directionDeg: number | null;
    /** Null when the winning level's pressure position has no median (full ensemble dropout). */
    pressureHpa: number | null;
    heightM: number;
    at: CitedInstant;
    persistenceHours: number;
  };
  /** Window-scoped wind — present only when the day has at least one thermalWindow; `windowHours` is the scope for every number in the block, and a clipped window's scope is a data boundary, not a forecast of calm outside it. */
  duringWindow?: {
    windowHours: string[];
    maxGust?: {
      gustMps: number;
      meanWindMps: number | null;
      at: CitedInstant;
      /** Same echo as the whole-day maxGust. */
      semantics?: "hourMax" | "instant";
    };
    maxWindInBand?: {
      windMps: number;
      directionDeg: number | null;
      heightM: number;
      at: CitedInstant;
    };
    evidence: {
      hours: string[];
      windGustMps: (number | null)[];
      bandMaxWindMps: (number | null)[];
    };
  };
  thresholds: { bandMarginM: number; persistenceFractionOfMax: number };
}

/**
 * The strongest wind at any level inside the climb band — launch to lift
 * top, padded by `bandMarginM` — for one hour; null when the hour has no
 * published lift top or no level in the band. The one construction every
 * band-wind consumer reads through.
 */
export function climbBandMaxWind(
  hour: ForecastHour,
  launchReferenceM: number,
  bandMarginM: number,
): {
  windMps: number;
  directionDeg: number | null;
  heightM: number;
  pressureHpa: number | null;
} | null {
  const top = p50(hour.derived.usableLiftTopM);
  if (top === null) return null;
  let best: ReturnType<typeof climbBandMaxWind> = null;
  for (const level of hour.levels) {
    const heightM = p50(level.heightM);
    const windMps = p50(level.windSpeedMps);
    if (heightM === null || windMps === null) continue;
    if (heightM < launchReferenceM - bandMarginM || heightM > top + bandMarginM) continue;
    if (best === null || windMps > best.windMps) {
      best = {
        windMps,
        directionDeg: p50(level.windDirectionDeg),
        heightM,
        pressureHpa: p50(level.pressureHpa),
      };
    }
  }
  return best;
}

export function findWindSummaries(
  context: Context,
  windows: ThermalWindowFinding[],
): WindSummaryFinding[] {
  const { profile, thresholds, launchReferenceM } = context;
  const { bandMarginM, persistenceFractionOfMax } = thresholds.windSummary;

  const byDay = new Map<string, ForecastHour[]>();
  for (const hour of profile.hours) {
    const day = localDateKey(hour.validAt, context.timeZone);
    const bucket = byDay.get(day) ?? [];
    bucket.push(hour);
    byDay.set(day, bucket);
  }

  const bandMax = (hour: ForecastHour) => climbBandMaxWind(hour, launchReferenceM, bandMarginM);

  const hourByValidAt = new Map(profile.hours.map((hour) => [hour.validAt, hour]));
  const windowHoursByDay = new Map<string, string[]>();
  for (const window of windows) {
    const bucket = windowHoursByDay.get(window.day) ?? [];
    bucket.push(...window.evidence.hours);
    windowHoursByDay.set(window.day, bucket);
  }

  const findings: WindSummaryFinding[] = [];
  for (const [day, hours] of byDay) {
    const finding: WindSummaryFinding = {
      kind: "windSummary",
      day,
      thresholds: { bandMarginM, persistenceFractionOfMax },
    };

    let gustAt: ForecastHour | null = null;
    let gust = -Infinity;
    for (const hour of hours) {
      const value = p50(hour.surface.windGustMps);
      if (value !== null && value > gust) {
        gust = value;
        gustAt = hour;
      }
    }
    if (gustAt !== null) {
      const mean = p50(gustAt.surface.windSpeedMps);
      finding.maxGust = {
        gustMps: round2(gust),
        meanWindMps: mean === null ? null : round2(mean),
        at: context.cite(gustAt.validAt),
        ...(profile.semantics?.gust ? { semantics: profile.semantics.gust } : {}),
      };
    }

    const bandMaxima = hours.map((hour) => ({ hour, max: bandMax(hour) }));
    const withBand = bandMaxima.filter(
      (entry): entry is { hour: ForecastHour; max: NonNullable<ReturnType<typeof bandMax>> } =>
        entry.max !== null,
    );
    if (withBand.length > 0) {
      const peakEntry = withBand.reduce((best, entry) =>
        entry.max.windMps > best.max.windMps ? entry : best,
      );
      const peakIndex = bandMaxima.findIndex((entry) => entry === peakEntry);
      const floor = peakEntry.max.windMps * persistenceFractionOfMax;
      let runFirst = peakIndex;
      let runLast = peakIndex;
      for (let i = peakIndex - 1; i >= 0 && (bandMaxima[i].max?.windMps ?? -1) >= floor; i -= 1) {
        runFirst = i;
      }
      for (
        let i = peakIndex + 1;
        i < bandMaxima.length && (bandMaxima[i].max?.windMps ?? -1) >= floor;
        i += 1
      ) {
        runLast = i;
      }
      const { steps } = context;
      let persistenceHours = 0;
      for (let i = runFirst; i <= runLast; i += 1) {
        persistenceHours += steps.after[steps.indexOf.get(bandMaxima[i].hour.validAt)!];
      }
      finding.maxWindInBand = {
        windMps: round2(peakEntry.max.windMps),
        directionDeg:
          peakEntry.max.directionDeg === null ? null : Math.round(peakEntry.max.directionDeg),
        heightM: round1(peakEntry.max.heightM),
        pressureHpa: peakEntry.max.pressureHpa,
        at: context.cite(peakEntry.hour.validAt),
        persistenceHours,
      };
    }

    const windowHours = windowHoursByDay.get(day);
    if (windowHours) {
      const scoped = windowHours.map((validAt) => {
        const hour = hourByValidAt.get(validAt)!;
        return { hour, gust: p50(hour.surface.windGustMps), band: bandMax(hour) };
      });

      const duringWindow: NonNullable<WindSummaryFinding["duringWindow"]> = {
        windowHours: [...windowHours],
        evidence: {
          hours: [...windowHours],
          windGustMps: scoped.map((entry) => (entry.gust === null ? null : round2(entry.gust))),
          bandMaxWindMps: scoped.map((entry) =>
            entry.band === null ? null : round2(entry.band.windMps),
          ),
        },
      };

      const gustPeak = scoped.reduce(
        (best: (typeof scoped)[number] | null, entry) =>
          entry.gust !== null && (best === null || entry.gust > best.gust!) ? entry : best,
        null,
      );
      if (gustPeak !== null) {
        const mean = p50(gustPeak.hour.surface.windSpeedMps);
        duringWindow.maxGust = {
          gustMps: round2(gustPeak.gust!),
          meanWindMps: mean === null ? null : round2(mean),
          at: context.cite(gustPeak.hour.validAt),
          ...(profile.semantics?.gust ? { semantics: profile.semantics.gust } : {}),
        };
      }

      const bandPeak = scoped.reduce(
        (best: (typeof scoped)[number] | null, entry) =>
          entry.band !== null && (best === null || entry.band.windMps > best.band!.windMps)
            ? entry
            : best,
        null,
      );
      if (bandPeak !== null) {
        duringWindow.maxWindInBand = {
          windMps: round2(bandPeak.band!.windMps),
          directionDeg:
            bandPeak.band!.directionDeg === null ? null : Math.round(bandPeak.band!.directionDeg),
          heightM: round1(bandPeak.band!.heightM),
          at: context.cite(bandPeak.hour.validAt),
        };
      }

      finding.duringWindow = duringWindow;
    }

    if (finding.maxGust || finding.maxWindInBand || finding.duringWindow) findings.push(finding);
  }
  return findings;
}
