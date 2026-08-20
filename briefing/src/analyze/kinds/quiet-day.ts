import type { ForecastHour } from "../../contract.js";
import { localDateKey, localHourOfDay } from "../../derive/day-window.js";
import { p50 } from "../../derive/ensemble.js";
import { windowTouchedDays, type ThermalWindowFinding } from "./thermal-window.js";
import {
  leadHoursTo,
  round1,
  round2,
  type CitedInstant,
  type Context,
  type LocalDayKey,
} from "./shared.js";

/**
 * Emitted once per covered local day without a thermalWindow finding.
 * `failed` names the floors the day's best hours missed, including
 * "coincidence" (each threshold met at some hour, never both in the same
 * hour); `context` restates upstream numbers with no causal verdict.
 */
export interface QuietDayFinding {
  kind: "quietDay";
  day: LocalDayKey;
  /** Forecast lead: hours from `run.referenceTime` to the day's peak-W* hour, falling back to the peak-depth hour, then the day's first covered hour. */
  leadHours: number;
  /** The day's best W*; null when no hour published the series. */
  peakThermalVelocityMps: number | null;
  peakThermalVelocityAt: CitedInstant | null;
  /** The day's best usable-lift depth above the launch reference; null when unpublished. */
  peakLiftDepthM: number | null;
  peakLiftDepthAt: CitedInstant | null;
  failed: Array<"wstar" | "depth" | "coincidence">;
  /** The upstream atmospheric restatements beside the quiet arithmetic; an empty context reads honestly — no atmospheric suppressor is stated. */
  context: {
    /** Present when some covered hour's published rate exceeds `minMmHr`; peak rates and timings are only comparable within one (semantics, step) class. */
    precipitation?: {
      peakMmHr: number;
      peakAt: CitedInstant;
      /** First covered hour whose rate exceeds the floor. */
      firstWetAt: CitedInstant;
      /** Covered-span hours (HourSteps convention) of the wet samples. */
      wetHours: number;
      /** The floor the block is read against — thresholds.capTiming.precipMinMmHr. */
      minMmHr: number;
      /** The document's semantics.precipitation echo, when declared. */
      semantics?: "instantRate" | "windowMeanRate";
      /** Widest step among the day's covered samples. */
      stepHours: number;
    };
    /** Total cloud cover at the peak-W* hour; null when no W* hour exists or the hour publishes no cloud cover. Never read alone — see the daytime aggregate beside it. */
    cloudCoverAtPeakWstarPercent: number | null;
    /** Mean total cloud cover over the day's covered samples falling in local 10:00–16:00 inclusive; null when no such sample publishes the series. */
    daytimeCloudCoverPercent: number | null;
    /** The day's strongest published gust; absent where the model publishes none — never zero, never calm. */
    maxGust?: {
      gustMps: number;
      at: CitedInstant;
      /** The document's semantics.gust echo. */
      semantics?: "hourMax" | "instant";
    };
    /** The day's peak published surface sensible heat flux; absent where unpublished. */
    peakSensibleHeatFluxWm2?: { valueWm2: number; at: CitedInstant };
  };
  /** The hours the claim is built from; a `truncated` quiet day is a data boundary, not a forecast, and must not vote in cross-model comparisons. */
  coverage: {
    hours: number;
    first: CitedInstant;
    last: CitedInstant;
    truncated: boolean;
  };
  thresholds: { wstarMinMps: number; depthMinM: number };
}

/**
 * Coverage block shared by quietDay and convectiveDay: covered span and
 * horizon-truncation verdict, judged at the local cadence of the day's own
 * edge hours — never a document-wide constant; cadence can widen
 * mid-horizon.
 */
export function dayCoverage(context: Context, hours: ForecastHour[]): QuietDayFinding["coverage"] {
  const { steps } = context;
  const firstIdx = steps.indexOf.get(hours[0].validAt)!;
  const lastIdx = steps.indexOf.get(hours[hours.length - 1].validAt)!;
  const firstLocalH = localHourOfDay(hours[0].validAt, context.timeZone);
  const lastLocalH = localHourOfDay(hours[hours.length - 1].validAt, context.timeZone);
  const truncated = !(
    firstLocalH < steps.before[firstIdx] && lastLocalH >= 24 - steps.after[lastIdx]
  );
  return {
    hours: steps.after.slice(firstIdx, lastIdx + 1).reduce((sum, span) => sum + span, 0),
    first: context.cite(hours[0].validAt),
    last: context.cite(hours[hours.length - 1].validAt),
    truncated,
  };
}

export function findQuietDays(
  context: Context,
  windows: ThermalWindowFinding[],
): QuietDayFinding[] {
  const { profile, launchReferenceM, thresholds, steps } = context;
  const { wstarMinMps, depthMinM } = thresholds.thermalWindow;
  const precipMinMmHr = thresholds.capTiming.precipMinMmHr;
  const windowDays = new Set(
    windows.flatMap((window) => windowTouchedDays(window, context.timeZone)),
  );
  const byDay = new Map<string, ForecastHour[]>();
  for (const hour of profile.hours) {
    const day = localDateKey(hour.validAt, context.timeZone);
    const group = byDay.get(day) ?? [];
    group.push(hour);
    byDay.set(day, group);
  }

  const findings: QuietDayFinding[] = [];
  for (const [day, hours] of byDay) {
    if (windowDays.has(day)) continue;
    let peakWstar: number | null = null;
    let peakWstarAt: string | null = null;
    let peakDepth: number | null = null;
    let peakDepthAt: string | null = null;
    for (const hour of hours) {
      const wstar = p50(hour.derived.thermalVelocityMps);
      const top = p50(hour.derived.usableLiftTopM);
      const depth = top === null ? null : top - launchReferenceM;
      if (wstar !== null && (peakWstar === null || wstar > peakWstar)) {
        peakWstar = wstar;
        peakWstarAt = hour.validAt;
      }
      if (depth !== null && (peakDepth === null || depth > peakDepth)) {
        peakDepth = depth;
        peakDepthAt = hour.validAt;
      }
    }
    const failed: QuietDayFinding["failed"] = [];
    if (peakWstar === null || peakWstar < wstarMinMps) failed.push("wstar");
    if (peakDepth === null || peakDepth < depthMinM) failed.push("depth");
    if (failed.length === 0) failed.push("coincidence");

    const context_: QuietDayFinding["context"] = {
      cloudCoverAtPeakWstarPercent: null,
      daytimeCloudCoverPercent: null,
    };
    if (peakWstarAt !== null) {
      const peakHour = hours.find((hour) => hour.validAt === peakWstarAt)!;
      const cover = p50(peakHour.surface.cloudCoverPercent);
      context_.cloudCoverAtPeakWstarPercent = cover === null ? null : round1(cover);
    }
    const daytimeCover = hours
      .filter((hour) => {
        const localH = localHourOfDay(hour.validAt, context.timeZone);
        return localH >= 10 && localH <= 16;
      })
      .map((hour) => p50(hour.surface.cloudCoverPercent))
      .filter((cover): cover is number => cover !== null);
    if (daytimeCover.length > 0) {
      context_.daytimeCloudCoverPercent = round1(
        daytimeCover.reduce((sum, cover) => sum + cover, 0) / daytimeCover.length,
      );
    }
    const wet = hours
      .map((hour) => ({ hour, rate: p50(hour.surface.precipitationMmHr) }))
      .filter(
        (entry): entry is { hour: ForecastHour; rate: number } =>
          entry.rate !== null && entry.rate > precipMinMmHr,
      );
    if (wet.length > 0) {
      const peak = wet.reduce((best, entry) => (entry.rate > best.rate ? entry : best));
      context_.precipitation = {
        peakMmHr: round2(peak.rate),
        peakAt: context.cite(peak.hour.validAt),
        firstWetAt: context.cite(wet[0].hour.validAt),
        wetHours: wet.reduce(
          (sum, entry) => sum + steps.after[steps.indexOf.get(entry.hour.validAt)!],
          0,
        ),
        minMmHr: precipMinMmHr,
        ...(profile.semantics?.precipitation ? { semantics: profile.semantics.precipitation } : {}),
        stepHours: Math.max(...hours.map((hour) => steps.before[steps.indexOf.get(hour.validAt)!])),
      };
    }
    let gustAt: ForecastHour | null = null;
    let gust = -Infinity;
    let fluxAt: ForecastHour | null = null;
    let flux = -Infinity;
    for (const hour of hours) {
      const gustValue = p50(hour.surface.windGustMps);
      if (gustValue !== null && gustValue > gust) {
        gust = gustValue;
        gustAt = hour;
      }
      const fluxValue = p50(hour.surface.sensibleHeatFluxWm2);
      if (fluxValue !== null && fluxValue > flux) {
        flux = fluxValue;
        fluxAt = hour;
      }
    }
    if (gustAt !== null) {
      context_.maxGust = {
        gustMps: round2(gust),
        at: context.cite(gustAt.validAt),
        ...(profile.semantics?.gust ? { semantics: profile.semantics.gust } : {}),
      };
    }
    if (fluxAt !== null) {
      context_.peakSensibleHeatFluxWm2 = {
        valueWm2: round1(flux),
        at: context.cite(fluxAt.validAt),
      };
    }

    findings.push({
      kind: "quietDay",
      day,
      leadHours: leadHoursTo(
        profile.run.referenceTime,
        peakWstarAt ?? peakDepthAt ?? hours[0].validAt,
      ),
      peakThermalVelocityMps: peakWstar === null ? null : round2(peakWstar),
      peakThermalVelocityAt: peakWstarAt === null ? null : context.cite(peakWstarAt),
      peakLiftDepthM: peakDepth === null ? null : round1(peakDepth),
      peakLiftDepthAt: peakDepthAt === null ? null : context.cite(peakDepthAt),
      failed,
      context: context_,
      coverage: dayCoverage(context, hours),
      thresholds: { wstarMinMps, depthMinM },
    });
  }
  return findings;
}
