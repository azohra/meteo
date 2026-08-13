import type { SmokeDocument } from "../../contract.js";
import { localDateKey } from "../../derive/day-window.js";
import { p50 } from "../../derive/ensemble.js";
import { isSmokeAwareProfile, smokeHoursByValidAt } from "../../derive/smoke.js";
import type { ThermalWindowFinding } from "./thermal-window.js";
import { round1, type CitedInstant, type Context, type LocalDayKey } from "./shared.js";

/**
 * The smoke story per local day — republished numbers only, from the
 * profile's own `hours[].smoke` blocks (source `"profile"`) or from a
 * same-site SmokeDocument joined by validAt (source `"joined"`).
 * Threshold-free by construction: magnitudes and timing only, no verdict
 * — no derated-window verdict and no wstarAdjusted series ship here.
 */
export type SmokeImpactFinding = SmokeImpactProfileFinding | SmokeImpactJoinedFinding;

interface SmokeImpactBase {
  kind: "smokeImpact";
  day: LocalDayKey;
  /** The contract's `semantics.smoke` echo — load-bearing: `"radiativelyCoupled"` lift numbers already feel this smoke (a downstream derate would double-count); `"passive"` lift numbers are smoke-blind. */
  semantics: "radiativelyCoupled" | "passive";
  /** Day-peak near-surface smoke, µg/m³ — the visibility/health number. */
  peakSurfaceUgm3: number;
  peakSurfaceAt: CitedInstant;
}

/** The profile's own smoke blocks: surface concentration plus the model's own published column AOT. */
export interface SmokeImpactProfileFinding extends SmokeImpactBase {
  source: "profile";
  /** Day-peak published aerosol optical thickness (dimensionless). */
  peakAot: number;
  peakAotAt: CitedInstant;
  /** Maxima over the smoke hours inside the day's thermalWindow(s); null when the day has no window or no smoke-carrying hour lands on a window hour. */
  duringWindow: { maxSurfaceUgm3: number; maxAot: number } | null;
  evidence: { hours: string[]; surfaceUgm3: number[]; aot: number[] };
}

/** A joined smoke document beside a smoke-blind profile: the wildfire-attributed surface concentration plus the published column mass — and deliberately no aot (the column is quarantined from derived optics). */
export interface SmokeImpactJoinedFinding extends SmokeImpactBase {
  source: "joined";
  /** A joined day is passive by construction: the smoke rides beside a profile whose radiation never saw it. */
  semantics: "passive";
  /** Day-peak wildfire-smoke column mass, mg/m² — the document's own published fact, republished as-is. */
  peakColumnMgm2: number;
  peakColumnAt: CitedInstant;
  /** The smoke document's own run, beside the envelope's — a stale smoke run must not silently caption a fresh wind run. */
  smokeRun: { model: string; referenceTime: string };
  /** The horizon confession: of the profile hours on this local day, how many the smoke document covered. */
  coverage: { joinedHours: number; profileHours: number };
  /** As the profile variant's, with the column standing in for aot. */
  duringWindow: { maxSurfaceUgm3: number; maxColumnMgm2: number } | null;
  evidence: { hours: string[]; surfaceUgm3: number[]; columnMgm2: number[] };
}

/** Three decimals — the contract's precision for aot. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** One smoke hour: the surface concentration plus the source's second number (profile: aot; joined: columnMgm2). */
interface SmokeRow {
  validAt: string;
  surfaceUgm3: number;
  companion: number;
}

export function findSmokeImpact(
  context: Context,
  windows: ThermalWindowFinding[],
  smoke: SmokeDocument | null,
): SmokeImpactFinding[] {
  const { profile } = context;

  const windowHoursByDay = new Map<LocalDayKey, Set<string>>();
  for (const window of windows) {
    const set = windowHoursByDay.get(window.day) ?? new Set<string>();
    for (const hour of window.evidence.hours) set.add(hour);
    windowHoursByDay.set(window.day, set);
  }

  const profileRows: SmokeRow[] = [];
  for (const hour of profile.hours) {
    if (!hour.smoke) continue;
    const surfaceUgm3 = p50(hour.smoke.surfaceUgm3);
    const companion = p50(hour.smoke.aot);
    if (surfaceUgm3 === null || companion === null) continue;
    profileRows.push({ validAt: hour.validAt, surfaceUgm3, companion });
  }
  if (profileRows.length > 0) {
    const semantics = isSmokeAwareProfile(profile) ? "radiativelyCoupled" : "passive";
    const findings: SmokeImpactProfileFinding[] = [];
    for (const [day, rows] of groupByDay(profileRows, context)) {
      const window = duringWindowOf(rows, windowHoursByDay.get(day));
      const aotPeak = companionPeakOf(rows);
      findings.push({
        kind: "smokeImpact",
        source: "profile",
        day,
        semantics,
        ...surfacePeakOf(rows, context),
        peakAot: round3(aotPeak.companion),
        peakAotAt: context.cite(aotPeak.validAt),
        duringWindow: window && {
          maxSurfaceUgm3: window.maxSurfaceUgm3,
          maxAot: round3(window.maxCompanion),
        },
        evidence: {
          hours: rows.map((row) => row.validAt),
          surfaceUgm3: rows.map((row) => round1(row.surfaceUgm3)),
          aot: rows.map((row) => round3(row.companion)),
        },
      });
    }
    return findings;
  }

  if (!smoke) return [];
  const smokeByValidAt = smokeHoursByValidAt(smoke);
  const joinedRows: SmokeRow[] = [];
  for (const hour of profile.hours) {
    const match = smokeByValidAt.get(hour.validAt);
    if (!match) continue;
    const surfaceUgm3 = p50(match.smokePlumeSurfaceUgm3);
    const companion = p50(match.smokePlumeColumnMgm2);
    if (surfaceUgm3 === null || companion === null) continue;
    joinedRows.push({ validAt: hour.validAt, surfaceUgm3, companion });
  }
  if (joinedRows.length === 0) return [];

  const profileHoursByDay = new Map<LocalDayKey, number>();
  for (const hour of profile.hours) {
    const day = localDateKey(hour.validAt, context.timeZone);
    profileHoursByDay.set(day, (profileHoursByDay.get(day) ?? 0) + 1);
  }

  const findings: SmokeImpactJoinedFinding[] = [];
  for (const [day, rows] of groupByDay(joinedRows, context)) {
    const window = duringWindowOf(rows, windowHoursByDay.get(day));
    const columnPeak = companionPeakOf(rows);
    findings.push({
      kind: "smokeImpact",
      source: "joined",
      day,
      semantics: "passive",
      ...surfacePeakOf(rows, context),
      peakColumnMgm2: round1(columnPeak.companion),
      peakColumnAt: context.cite(columnPeak.validAt),
      smokeRun: { model: smoke.model, referenceTime: smoke.run.referenceTime },
      coverage: { joinedHours: rows.length, profileHours: profileHoursByDay.get(day) ?? 0 },
      duringWindow: window && {
        maxSurfaceUgm3: window.maxSurfaceUgm3,
        maxColumnMgm2: round1(window.maxCompanion),
      },
      evidence: {
        hours: rows.map((row) => row.validAt),
        surfaceUgm3: rows.map((row) => round1(row.surfaceUgm3)),
        columnMgm2: rows.map((row) => round1(row.companion)),
      },
    });
  }
  return findings;
}

function groupByDay(rows: SmokeRow[], context: Context): Map<LocalDayKey, SmokeRow[]> {
  const byDay = new Map<LocalDayKey, SmokeRow[]>();
  for (const row of rows) {
    const day = localDateKey(row.validAt, context.timeZone);
    const bucket = byDay.get(day) ?? [];
    bucket.push(row);
    byDay.set(day, bucket);
  }
  return byDay;
}

/** Day-peak surface concentration with its cited instant (first hour wins a tie). */
function surfacePeakOf(
  rows: SmokeRow[],
  context: Context,
): { peakSurfaceUgm3: number; peakSurfaceAt: CitedInstant } {
  const peak = rows.reduce((best, row) => (row.surfaceUgm3 > best.surfaceUgm3 ? row : best));
  return { peakSurfaceUgm3: round1(peak.surfaceUgm3), peakSurfaceAt: context.cite(peak.validAt) };
}

function companionPeakOf(rows: SmokeRow[]): SmokeRow {
  return rows.reduce((best, row) => (row.companion > best.companion ? row : best));
}

/** Raw during-window maxima over the day's smoke rows that land on the day's window hours; null when there is no window or no such row. */
function duringWindowOf(
  rows: SmokeRow[],
  windowHours: Set<string> | undefined,
): { maxSurfaceUgm3: number; maxCompanion: number } | null {
  if (!windowHours) return null;
  const inWindow = rows.filter((row) => windowHours.has(row.validAt));
  if (inWindow.length === 0) return null;
  return {
    maxSurfaceUgm3: round1(Math.max(...inWindow.map((row) => row.surfaceUgm3))),
    maxCompanion: Math.max(...inWindow.map((row) => row.companion)),
  };
}
