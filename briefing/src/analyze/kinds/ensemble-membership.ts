import { isEnsembleValue, type Scalar, type ForecastHour } from "../../contract.js";
import { localDateKey, localHourOfDay } from "../../derive/day-window.js";
import {
  leadHoursTo,
  round1,
  round2,
  type CitedInstant,
  type Context,
  type LocalDayKey,
} from "./shared.js";

/**
 * The membership honesty layer for ensemble documents: `membership` is
 * the per-quantity member-count profile (a p50 computed from few
 * contributing members is a different object than one over the full
 * run), `bands` states the p10-p90 band-width magnitude for the derived
 * series, and `dayBands` is the per-local-day width series at each day's
 * peak-p50-w* hour. No confidence verdicts: the band is member spread,
 * not a confidence interval.
 */
export interface EnsembleMembershipFinding {
  kind: "ensembleMembership";
  /** run.members where declared; otherwise the max per-position count seen. */
  declaredMembers: number;
  membership: Array<{
    quantity: string;
    minMembers: number;
    hoursBelowFull: number;
    ofHours: number;
    evidence: { examples: Array<{ validAt: string; members: number }> };
  }>;
  bands: Array<{
    series: "usableLiftTopM" | "thermalVelocityMps";
    hoursWithSignal: number;
    medianBandWidth: number;
    evidence: { hours: string[]; p50: number[]; bandWidth: number[] };
  }>;
  /** The per-local-day band-width series: both derived series' p10-p90 width read at each day's peak-p50-w* hour, so day-over-day spread is compared at like instants; no trend verdict rides the series. */
  dayBands: Array<{
    day: LocalDayKey;
    /** The day's peak-p50-w* hour — where both widths are read. */
    peakHour: CitedInstant;
    /** Hours from run.referenceTime to the peak hour. */
    leadHours: number;
    wstarBandWidthMps: number | null;
    liftTopBandWidthM: number | null;
    /** The document's own hour range clips this local day — a stub day's width is a horizon artifact and must not read as a day the series states. */
    truncated: boolean;
  }>;
}

export function findEnsembleMembership(context: Context): EnsembleMembershipFinding[] {
  const { profile, steps } = context;
  if (context.deterministic) return [];

  let observedMax = 0;
  const perQuantity = new Map<string, Array<{ validAt: string; members: number }>>();
  const record = (quantity: string, validAt: string, value: Scalar | null | undefined) => {
    if (value === null || value === undefined || !isEnsembleValue(value)) return;
    observedMax = Math.max(observedMax, value.members);
    const rows = perQuantity.get(quantity) ?? [];
    rows.push({ validAt, members: value.members });
    perQuantity.set(quantity, rows);
  };
  for (const hour of profile.hours) {
    for (const [key, value] of Object.entries(hour.surface)) record(key, hour.validAt, value);
    for (const [key, value] of Object.entries(hour.derived)) record(key, hour.validAt, value);
  }
  const declaredMembers = profile.run.members ?? observedMax;

  const membership: EnsembleMembershipFinding["membership"] = [];
  for (const [quantity, rows] of perQuantity) {
    const below = rows.filter((row) => row.members < declaredMembers);
    if (below.length === 0) continue;
    membership.push({
      quantity,
      minMembers: Math.min(...below.map((row) => row.members)),
      hoursBelowFull: below.length,
      ofHours: rows.length,
      evidence: { examples: below.slice(0, 4) },
    });
  }

  const bands: EnsembleMembershipFinding["bands"] = [];
  for (const series of ["usableLiftTopM", "thermalVelocityMps"] as const) {
    const roundSeries = series === "thermalVelocityMps" ? round2 : round1;
    const rows: Array<{ validAt: string; p50: number; width: number }> = [];
    for (const hour of profile.hours) {
      const value = hour.derived[series];
      if (value === null || !isEnsembleValue(value)) continue;
      if (value.p10 === null || value.p90 === null || value.p50 === null) continue;
      rows.push({ validAt: hour.validAt, p50: value.p50, width: value.p90 - value.p10 });
    }
    if (rows.length === 0) continue;
    const widths = rows.map((row) => row.width).sort((a, b) => a - b);
    bands.push({
      series,
      hoursWithSignal: rows.length,
      medianBandWidth: roundSeries(widths[Math.floor(widths.length / 2)]),
      evidence: {
        hours: rows.map((row) => row.validAt),
        p50: rows.map((row) => roundSeries(row.p50)),
        bandWidth: rows.map((row) => roundSeries(row.width)),
      },
    });
  }

  const byDay = new Map<string, ForecastHour[]>();
  for (const hour of profile.hours) {
    const day = localDateKey(hour.validAt, context.timeZone);
    const group = byDay.get(day) ?? [];
    group.push(hour);
    byDay.set(day, group);
  }
  const width = (value: Scalar | null | undefined): number | null => {
    if (value === null || value === undefined || !isEnsembleValue(value)) return null;
    if (value.p10 === null || value.p90 === null) return null;
    return value.p90 - value.p10;
  };
  const dayBands: EnsembleMembershipFinding["dayBands"] = [];
  for (const [day, hours] of byDay) {
    let peak: ForecastHour | null = null;
    let peakWstar: number | null = null;
    for (const hour of hours) {
      const value = hour.derived.thermalVelocityMps;
      if (value === null || value === undefined || !isEnsembleValue(value)) continue;
      if (value.p50 === null) continue;
      if (peakWstar === null || value.p50 > peakWstar) {
        peakWstar = value.p50;
        peak = hour;
      }
    }
    if (peak === null) continue;
    const firstIdx = steps.indexOf.get(hours[0].validAt)!;
    const lastIdx = steps.indexOf.get(hours[hours.length - 1].validAt)!;
    const firstLocalH = localHourOfDay(hours[0].validAt, context.timeZone);
    const lastLocalH = localHourOfDay(hours[hours.length - 1].validAt, context.timeZone);
    const truncated = !(
      firstLocalH < steps.before[firstIdx] && lastLocalH >= 24 - steps.after[lastIdx]
    );
    const wstarWidth = width(peak.derived.thermalVelocityMps);
    const liftTopWidth = width(peak.derived.usableLiftTopM);
    dayBands.push({
      day,
      peakHour: context.cite(peak.validAt),
      leadHours: leadHoursTo(profile.run.referenceTime, peak.validAt),
      wstarBandWidthMps: wstarWidth === null ? null : round2(wstarWidth),
      liftTopBandWidthM: liftTopWidth === null ? null : round1(liftTopWidth),
      truncated,
    });
  }

  if (membership.length === 0 && bands.length === 0 && dayBands.length === 0) return [];
  return [{ kind: "ensembleMembership", declaredMembers, membership, bands, dayBands }];
}
