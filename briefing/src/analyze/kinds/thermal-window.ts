import { isEnsembleValue, type Scalar, type ForecastHour } from "../../contract.js";
import { localDateKey } from "../../derive/day-window.js";
import { p50 } from "../../derive/ensemble.js";
import {
  leadHoursTo,
  round1,
  round2,
  type CitedInstant,
  type Context,
  type LocalDayKey,
} from "./shared.js";

/**
 * Consecutive hours with published usable-lift top >= depthMinM above
 * launch and W* >= wstarMinMps. Tests thermals, not flyability: blind to
 * wind, rain, and overdevelopment; the flyability call is downstream's.
 */
export interface ThermalWindowFinding {
  kind: "thermalWindow";
  day: LocalDayKey;
  /** Forecast lead: hours from `run.referenceTime` to the day's peak-lift hour (`peakLiftTopAt`) — the claim's central instant. */
  leadHours: number;
  start: CitedInstant;
  end: CitedInstant;
  durationHours: number;
  /** The widest covered step among the window's cited hours — the quantization bound on this window's timing and duration. */
  stepHours: number;
  peakLiftTopM: number;
  peakLiftTopAt: CitedInstant;
  /** Launch-relative peak; null when no launch was supplied. */
  peakLiftTopAboveLaunchM: number | null;
  peakThermalVelocityMps: number;
  /** True when the window's first/last hour is the document's own first/last hour: a clipped start reads as "open since at least", a clipped end as "still open at" — never a forecast of opening or decay. */
  clippedAtStart: boolean;
  clippedAtEnd: boolean;
  thresholds: { wstarMinMps: number; depthMinM: number; maxGapHours: number };
  evidence: {
    hours: string[];
    usableLiftTopM: number[];
    thermalVelocityMps: number[];
    /** p10-p90 lift-top band per cited hour; ensemble documents only. */
    liftTopBandP10P90?: Array<[number, number] | null>;
  };
}

/**
 * The local days a window's evidence hours touch — the one electorate
 * every day-keyed consumer counts: quietDay's exclusion, comparison's
 * windowAgreement votes, and the compare board's day filter. Unique keys
 * in evidence (chronological) order.
 */
export function windowTouchedDays(
  window: Pick<ThermalWindowFinding, "evidence">,
  timeZone: string,
): LocalDayKey[] {
  return [...new Set(window.evidence.hours.map((validAt) => localDateKey(validAt, timeZone)))];
}

function band(value: Scalar | null | undefined): [number, number] | null {
  if (value !== null && value !== undefined && isEnsembleValue(value)) {
    if (value.p10 === null || value.p90 === null) return null;
    return [value.p10, value.p90];
  }
  return null;
}

export function findThermalWindows(context: Context): ThermalWindowFinding[] {
  const { profile, launchReferenceM, thresholds, steps } = context;
  const { wstarMinMps, depthMinM, maxGapHours } = thresholds.thermalWindow;
  const launchKnown = context.launchElevationM !== null;
  const ensemble = !context.deterministic;

  const clearsFloors = (hour: ForecastHour): boolean => {
    const top = p50(hour.derived.usableLiftTopM);
    const wstar = p50(hour.derived.thermalVelocityMps);
    return (
      top !== null && wstar !== null && wstar >= wstarMinMps && top - launchReferenceM >= depthMinM
    );
  };
  const publishesBoth = (hour: ForecastHour): boolean =>
    p50(hour.derived.usableLiftTopM) !== null && p50(hour.derived.thermalVelocityMps) !== null;

  const runs: Array<{ first: number; last: number }> = [];
  let index = 0;
  while (index < profile.hours.length) {
    if (!clearsFloors(profile.hours[index])) {
      index += 1;
      continue;
    }
    let last = index;
    while (last + 1 < profile.hours.length && clearsFloors(profile.hours[last + 1])) last += 1;
    runs.push({ first: index, last });
    index = last + 1;
  }

  const windows: Array<{ first: number; last: number }> = [];
  for (const run of runs) {
    const previous = windows[windows.length - 1];
    if (previous) {
      const gapHours = steps.after
        .slice(previous.last + 1, run.first)
        .reduce((sum, span) => sum + span, 0);
      const bridgeable = profile.hours.slice(previous.last + 1, run.first).every(publishesBoth);
      if (gapHours <= maxGapHours && bridgeable) {
        previous.last = run.last;
        continue;
      }
    }
    windows.push({ ...run });
  }

  const findings: ThermalWindowFinding[] = [];
  for (const { first, last } of windows) {
    const hours = profile.hours.slice(first, last + 1);
    const tops = hours.map((hour) => p50(hour.derived.usableLiftTopM)!);
    const wstars = hours.map((hour) => p50(hour.derived.thermalVelocityMps)!);
    const peakIndex = tops.indexOf(Math.max(...tops));
    const peakHour = hours[peakIndex];
    const peakTop = tops[peakIndex];

    const finding: ThermalWindowFinding = {
      kind: "thermalWindow",
      day: localDateKey(hours[0].validAt, context.timeZone),
      leadHours: leadHoursTo(profile.run.referenceTime, peakHour.validAt),
      start: context.cite(hours[0].validAt),
      end: context.cite(hours[hours.length - 1].validAt),
      clippedAtStart: hours[0].validAt === profile.hours[0].validAt,
      clippedAtEnd:
        hours[hours.length - 1].validAt === profile.hours[profile.hours.length - 1].validAt,
      durationHours: steps.after.slice(first, last + 1).reduce((sum, span) => sum + span, 0),
      stepHours: Math.max(...steps.after.slice(first, last + 1)),
      peakLiftTopM: round1(peakTop),
      peakLiftTopAt: context.cite(peakHour.validAt),
      peakLiftTopAboveLaunchM: launchKnown ? round1(peakTop - launchReferenceM) : null,
      peakThermalVelocityMps: round2(Math.max(...wstars)),
      thresholds: { wstarMinMps, depthMinM, maxGapHours },
      evidence: {
        hours: hours.map((hour) => hour.validAt),
        usableLiftTopM: tops.map(round1),
        thermalVelocityMps: wstars.map(round2),
      },
    };
    if (ensemble) {
      finding.evidence.liftTopBandP10P90 = hours.map((hour) => {
        const range = band(hour.derived.usableLiftTopM);
        return range === null ? null : [round1(range[0]), round1(range[1])];
      });
    }
    findings.push(finding);
  }
  return findings;
}
