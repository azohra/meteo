import { isEnsembleValue, type Scalar, type ForecastHour } from "../../contract.js";
import { localDateKey } from "../../derive/day-window.js";
import { leadHoursTo, type Context, type LocalDayKey } from "./shared.js";

/** The five percentile tokens ensemble documents publish per position. */
export type PercentileToken = "p10" | "p25" | "p50" | "p75" | "p90";

const PERCENTILES: readonly PercentileToken[] = ["p10", "p25", "p50", "p75", "p90"];

/**
 * thermalWindow's test at each published percentile per local day;
 * ensemble documents only, and only days where some percentile's verdict
 * differs from p50's. Percentiles are per-hour marginals: the shape cites
 * passing instants only, never windows, to avoid implying member
 * continuity.
 */
export interface PercentileCrossingFinding {
  kind: "percentileCrossing";
  day: LocalDayKey;
  /** Forecast lead: hours from `run.referenceTime` to the day's peak-lift hour at the minimal passing percentile. */
  leadHours: number;
  /** The lowest percentile whose day verdict passes — the headline token; an emitted finding always carries one, and never "p10". */
  minimalPassingPercentile: PercentileToken | null;
  /** The same test's evidence at every published percentile, p50 included (its zeros are load-bearing on upside days). */
  perPercentile: Record<
    PercentileToken,
    {
      /** Passing steps, not hours. */
      passingSteps: number;
      /** The cited passing instants (document validAt) — instants only, never start/end pairs. */
      hours: string[];
      /** Fewest contributing members across the cited hours' two quantities; null when nothing passes. */
      membersMin: number | null;
      /** Most ceiling-capped members across the cited hours; null when nothing passes or no cited hour carries the count. */
      ceiledMembersMax: number | null;
    }
  >;
  /** The widest covered step among the day's cited hours, per-gap from the actual spacing. */
  stepHours: number;
  /** The resolved thermalWindow floors this day was tested against. */
  thresholds: { wstarMinMps: number; depthMinM: number };
}

export function findPercentileCrossings(context: Context): PercentileCrossingFinding[] {
  if (context.deterministic) return [];
  const { profile, launchReferenceM, steps } = context;
  const { wstarMinMps, depthMinM } = context.thresholds.thermalWindow;

  const at = (value: Scalar | null | undefined, q: PercentileToken): number | null => {
    if (value === null || value === undefined) return null;
    return isEnsembleValue(value) ? value[q] : value;
  };
  const passes = (hour: ForecastHour, q: PercentileToken): boolean => {
    const wstar = at(hour.derived.thermalVelocityMps, q);
    const top = at(hour.derived.usableLiftTopM, q);
    return (
      wstar !== null && top !== null && wstar >= wstarMinMps && top - launchReferenceM >= depthMinM
    );
  };

  const byDay = new Map<string, ForecastHour[]>();
  for (const hour of profile.hours) {
    const day = localDateKey(hour.validAt, context.timeZone);
    const group = byDay.get(day) ?? [];
    group.push(hour);
    byDay.set(day, group);
  }

  const findings: PercentileCrossingFinding[] = [];
  for (const [day, hours] of byDay) {
    const passing = new Map<PercentileToken, ForecastHour[]>(
      PERCENTILES.map((q) => [q, hours.filter((hour) => passes(hour, q))]),
    );
    const verdict = (q: PercentileToken): boolean => passing.get(q)!.length > 0;
    if (PERCENTILES.every((q) => verdict(q) === verdict("p50"))) continue;
    const minimal = PERCENTILES.find((q) => verdict(q))!;

    const cited = new Set<string>();
    const perPercentile = {} as PercentileCrossingFinding["perPercentile"];
    for (const q of PERCENTILES) {
      const rows = passing.get(q)!;
      let membersMin: number | null = null;
      let ceiledMembersMax: number | null = null;
      for (const hour of rows) {
        cited.add(hour.validAt);
        for (const value of [hour.derived.thermalVelocityMps, hour.derived.usableLiftTopM]) {
          if (value === null || value === undefined || !isEnsembleValue(value)) continue;
          membersMin = membersMin === null ? value.members : Math.min(membersMin, value.members);
          if (value.ceiledMembers !== undefined) {
            ceiledMembersMax =
              ceiledMembersMax === null
                ? value.ceiledMembers
                : Math.max(ceiledMembersMax, value.ceiledMembers);
          }
        }
      }
      perPercentile[q] = {
        passingSteps: rows.length,
        hours: rows.map((hour) => hour.validAt),
        membersMin,
        ceiledMembersMax,
      };
    }

    const anchorRows = passing.get(minimal)!;
    let anchor = anchorRows[0];
    let anchorTop = at(anchor.derived.usableLiftTopM, minimal)!;
    for (const hour of anchorRows) {
      const top = at(hour.derived.usableLiftTopM, minimal)!;
      if (top > anchorTop) {
        anchor = hour;
        anchorTop = top;
      }
    }

    findings.push({
      kind: "percentileCrossing",
      day,
      leadHours: leadHoursTo(profile.run.referenceTime, anchor.validAt),
      minimalPassingPercentile: minimal,
      perPercentile,
      stepHours: Math.max(...[...cited].map((validAt) => steps.after[steps.indexOf.get(validAt)!])),
      thresholds: { wstarMinMps, depthMinM },
    });
  }
  return findings;
}
