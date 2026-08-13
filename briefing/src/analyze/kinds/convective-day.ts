import { localDateKey } from "../../derive/day-window.js";
import { p50 } from "../../derive/ensemble.js";
import type { ThermalWindowFinding } from "./thermal-window.js";
import { dayCoverage } from "./quiet-day.js";
import { round2, type CitedInstant, type Context, type LocalDayKey } from "./shared.js";

/**
 * The convective story a CIN-less model can tell: CAPE magnitude and
 * timing plus precipitation timing per local day — verdict-free
 * restatements, emitted only where the document publishes CAPE and no
 * CIN anywhere, on deterministic days sampled hourly. `capIsJudgeable`
 * is always false (absence of CIN must never be read as "no cap"), and
 * CAPE magnitudes are model-specific — never compare peakCapeJkg across
 * documents.
 */
export interface ConvectiveDayFinding {
  kind: "convectiveDay";
  day: LocalDayKey;
  peakCapeJkg: number;
  /** Null when the day's published CAPE is zero throughout. */
  peakCapeAt: CitedInstant | null;
  /** Always false — the kind exists only where the model publishes no CIN; it cannot say whether the instability is capped. */
  capIsJudgeable: false;
  capNotJudgeableReason: "modelPublishesNoCin";
  /** First covered hour precipitation exceeds thresholds.precipMinMmHr. */
  precipStartsAt?: CitedInstant;
  peakPrecipMmHr?: number;
  /** The honest positive: every covered hour's published rate sits at or under the floor — a 0.00 series is a forecast, not absence. */
  noPrecipAboveThreshold?: true;
  /** The document's semantics.precipitation echo, when declared. */
  precipSemantics?: "instantRate" | "windowMeanRate";
  /** Widest gap between the day's cited rows, hours. */
  stepHours: number;
  /** The same-day thermalWindow's end; present when that finding exists for this day. */
  thermalWindowEndsAt?: CitedInstant;
  /** quietDay's coverage block verbatim; a truncated day's statement reads "of the covered hours" and must not vote in comparisons. */
  coverage: {
    hours: number;
    first: CitedInstant;
    last: CitedInstant;
    truncated: boolean;
  };
  thresholds: { precipMinMmHr: number };
  evidence: {
    hours: string[];
    capeJkg: number[];
    /** Aligned with hours; null where the hour publishes no rate. */
    precipitationMmHr: Array<number | null>;
  };
}

export function findConvectiveDays(
  context: Context,
  windows: ThermalWindowFinding[],
): ConvectiveDayFinding[] {
  const { profile, thresholds } = context;
  if (!context.deterministic) return [];
  const publishesCape = profile.hours.some((hour) => hour.surface.capeJkg !== undefined);
  const publishesCin = profile.hours.some((hour) => hour.surface.cinJkg !== undefined);
  if (!publishesCape || publishesCin) return [];

  const rows = profile.hours
    .map((hour) => ({ hour, cape: p50(hour.surface.capeJkg) }))
    .filter((row): row is typeof row & { cape: number } => row.cape !== null);

  const { precipMinMmHr } = thresholds.convectiveDay;
  const byDay = new Map<string, typeof rows>();
  for (const row of rows) {
    const day = localDateKey(row.hour.validAt, context.timeZone);
    const bucket = byDay.get(day) ?? [];
    bucket.push(row);
    byDay.set(day, bucket);
  }
  const windowEndByDay = new Map(windows.map((window) => [window.day, window.end]));

  const findings: ConvectiveDayFinding[] = [];
  for (const [day, dayRows] of byDay) {
    const hourly =
      dayRows.length >= 2 &&
      dayRows.every(
        (row, i) =>
          i === 0 ||
          Date.parse(row.hour.validAt) - Date.parse(dayRows[i - 1].hour.validAt) === 3_600_000,
      );
    if (!hourly) continue;

    const peak = dayRows.reduce((best, row) => (row.cape > best.cape ? row : best));
    const rates = dayRows.map((row) => p50(row.hour.surface.precipitationMmHr));
    const wet = dayRows
      .map((row, i) => ({ row, rate: rates[i] }))
      .filter(
        (entry): entry is { row: (typeof dayRows)[number]; rate: number } =>
          entry.rate !== null && entry.rate > precipMinMmHr,
      );

    const finding: ConvectiveDayFinding = {
      kind: "convectiveDay",
      day,
      peakCapeJkg: Math.round(peak.cape),
      peakCapeAt: peak.cape > 0 ? context.cite(peak.hour.validAt) : null,
      capIsJudgeable: false,
      capNotJudgeableReason: "modelPublishesNoCin",
      ...(profile.semantics?.precipitation
        ? { precipSemantics: profile.semantics.precipitation }
        : {}),
      stepHours: 1,
      ...(windowEndByDay.has(day) ? { thermalWindowEndsAt: windowEndByDay.get(day)! } : {}),
      coverage: dayCoverage(
        context,
        dayRows.map((row) => row.hour),
      ),
      thresholds: { precipMinMmHr },
      evidence: {
        hours: dayRows.map((row) => row.hour.validAt),
        capeJkg: dayRows.map((row) => Math.round(row.cape)),
        precipitationMmHr: rates.map((rate) => (rate === null ? null : round2(rate))),
      },
    };
    if (wet.length > 0) {
      finding.precipStartsAt = context.cite(wet[0].row.hour.validAt);
      finding.peakPrecipMmHr = round2(Math.max(...wet.map((entry) => entry.rate)));
    } else if (rates.some((rate) => rate !== null)) {
      finding.noPrecipAboveThreshold = true;
    }
    findings.push(finding);
  }
  return findings;
}
