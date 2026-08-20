import { localDateKey } from "../../derive/day-window.js";
import { p50 } from "../../derive/ensemble.js";
import type { ThermalWindowFinding } from "./thermal-window.js";
import { round2, type CitedInstant, type Context, type LocalDayKey } from "./shared.js";

/**
 * Overdevelopment timing per local day: CAPE build vs CIN erosion vs the
 * thermal window's close. Deterministic documents publishing CIN only
 * (ensemble-median CIN is bimodal). Hourly days carry instant verdicts;
 * multi-hour days carry interval verdicts over published steps only.
 */
export interface CapTimingFinding {
  kind: "capTiming";
  day: LocalDayKey;
  /** Which verdict semantics apply: "hourly" days carry instant verdicts, "multiHour" days carry interval verdicts over the published steps only. */
  cadence: "hourly" | "multiHour";
  verdict: "capBreaks" | "cappedAllDay" | "openButWeak" | "noInstability";
  peakCapeJkg: number;
  peakCapeAt: CitedInstant | null;
  /** Hourly days only: the first broken hour. */
  capBreaksAt?: CitedInstant;
  /** Multi-hour days only: the cap breaks somewhere between these two adjacent cited steps (open at `by`, still capped at `after`). */
  capBreaksBetween?: { after: CitedInstant; by: CitedInstant };
  /** Multi-hour days only: the day's first covered step is already broken — a day edge, not a break timing. */
  capAlreadyOpenAt?: CitedInstant;
  capeAtBreakJkg?: number;
  /** First hour precipitation exceeds thresholds.precipMinMmHr — the overdevelopment confirmation, when the model forecasts one. */
  precipStartsAt?: CitedInstant;
  peakPrecipMmHr?: number;
  /** The document's semantics.precipitation echo, when declared. */
  precipSemantics?: "instantRate" | "windowMeanRate";
  /** Widest gap between the day's cited CAPE/CIN rows, hours — the quantization bound on every timing this finding states. */
  stepHours: number;
  /** The same-day thermalWindow's end; present when that finding exists for this day. */
  thermalWindowEndsAt?: CitedInstant;
  thresholds: {
    instabilityMinCapeJkg: number;
    brokenCapMaxAbsCinJkg: number;
    brokenCapMinCapeJkg: number;
    precipMinMmHr: number;
  };
  evidence: { hours: string[]; capeJkg: number[]; cinJkg: number[] };
}

export function findCapTiming(
  context: Context,
  windows: ThermalWindowFinding[],
): CapTimingFinding[] {
  const { profile, thresholds } = context;
  if (!context.deterministic) return [];
  const rows = profile.hours
    .map((hour) => ({
      hour,
      cape: p50(hour.surface.capeJkg),
      cin: p50(hour.surface.cinJkg),
    }))
    .filter(
      (row): row is typeof row & { cape: number; cin: number } =>
        row.cape !== null && row.cin !== null,
    );
  if (rows.length === 0) return [];

  const limits = thresholds.capTiming;
  const byDay = new Map<string, typeof rows>();
  for (const row of rows) {
    const day = localDateKey(row.hour.validAt, context.timeZone);
    const bucket = byDay.get(day) ?? [];
    bucket.push(row);
    byDay.set(day, bucket);
  }
  const windowEndByDay = new Map(windows.map((window) => [window.day, window.end]));

  const findings: CapTimingFinding[] = [];
  for (const [day, dayRows] of byDay) {
    if (dayRows.length < 2) continue;
    const gaps = dayRows
      .slice(1)
      .map((row, i) =>
        Math.round(
          (Date.parse(row.hour.validAt) - Date.parse(dayRows[i].hour.validAt)) / 3_600_000,
        ),
      );
    const cadence: CapTimingFinding["cadence"] = gaps.every((gap) => gap === 1)
      ? "hourly"
      : "multiHour";
    const peak = dayRows.reduce((best, row) => (row.cape > best.cape ? row : best));
    const evidence = {
      hours: dayRows.map((row) => row.hour.validAt),
      capeJkg: dayRows.map((row) => Math.round(row.cape)),
      cinJkg: dayRows.map((row) => Math.round(row.cin)),
    };
    const shared = {
      cadence,
      stepHours: Math.max(...gaps),
      ...(profile.semantics?.precipitation
        ? { precipSemantics: profile.semantics.precipitation }
        : {}),
      thresholds: { ...limits },
      evidence,
      ...(windowEndByDay.has(day) ? { thermalWindowEndsAt: windowEndByDay.get(day)! } : {}),
    };

    if (peak.cape < limits.instabilityMinCapeJkg) {
      findings.push({
        kind: "capTiming",
        day,
        verdict: "noInstability",
        peakCapeJkg: Math.round(peak.cape),
        peakCapeAt: peak.cape > 0 ? context.cite(peak.hour.validAt) : null,
        ...shared,
      });
      continue;
    }

    const brokenIndex = dayRows.findIndex(
      (row) =>
        Math.abs(row.cin) < limits.brokenCapMaxAbsCinJkg && row.cape > limits.brokenCapMinCapeJkg,
    );
    const capNeverHolds = dayRows.every((row) => Math.abs(row.cin) < limits.brokenCapMaxAbsCinJkg);
    const finding: CapTimingFinding = {
      kind: "capTiming",
      day,
      verdict: brokenIndex >= 0 ? "capBreaks" : capNeverHolds ? "openButWeak" : "cappedAllDay",
      peakCapeJkg: Math.round(peak.cape),
      peakCapeAt: context.cite(peak.hour.validAt),
      ...shared,
    };
    if (brokenIndex >= 0) {
      const broken = dayRows[brokenIndex];
      if (cadence === "hourly") {
        finding.capBreaksAt = context.cite(broken.hour.validAt);
      } else if (brokenIndex === 0) {
        finding.capAlreadyOpenAt = context.cite(broken.hour.validAt);
      } else {
        finding.capBreaksBetween = {
          after: context.cite(dayRows[brokenIndex - 1].hour.validAt),
          by: context.cite(broken.hour.validAt),
        };
      }
      finding.capeAtBreakJkg = Math.round(broken.cape);
    }
    const wet = dayRows
      .map((row) => ({ row, rate: p50(row.hour.surface.precipitationMmHr) }))
      .filter(
        (entry): entry is { row: (typeof dayRows)[number]; rate: number } =>
          entry.rate !== null && entry.rate > limits.precipMinMmHr,
      );
    if (wet.length > 0) {
      finding.precipStartsAt = context.cite(wet[0].row.hour.validAt);
      finding.peakPrecipMmHr = round2(Math.max(...wet.map((entry) => entry.rate)));
    }
    findings.push(finding);
  }
  return findings;
}
