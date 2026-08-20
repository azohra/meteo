import {
  accumulatedCells,
  createClimatologyAccumulator,
  coveredSlotCountByYear,
  foldClimatologyPoints,
} from "../../climatology.js";
import {
  STATION_CLIMATOLOGY_SCHEMA_VERSION,
  type ClimatologyYear,
  type StationClimatology,
} from "../../contract-climatology.js";
import { thresholdsToMps } from "../../derive.js";
import type { SpeedThresholds } from "../../derive.js";
import type { WindnerdStationConfig } from "../config.js";
import {
  fetchUpstreamText,
  logUpstreamFailure,
  resolveEnvironment,
  type ResolvedEnvironment,
  type ServerEnvironment,
} from "../environment.js";
import {
  WINDNERD_RECORDS_URL,
  loadWindnerdLocation,
  parseWindnerdRecords,
  windnerdHistoryPoints,
} from "./windnerd.js";

/* The vendor's own climatology road: its rose and daily pattern fan out one
 * records request per calendar year at the 180-minute period (verified
 * live 2026-08-19). */
export const CLIMATOLOGY_RECORD_PERIOD_MINUTES = 180;
/* TRIAL craft parameters, caller-movable: how far back the fan-out reaches
 * (the vendor's own views reach 8 years) and how the cube is bucketed. */
export const CLIMATOLOGY_DEFAULT_YEARS = 8;
export const CLIMATOLOGY_DEFAULT_SECTOR_COUNT = 16;
/* Closed years are immutable; the running year only grows. */
const CLOSED_YEAR_CACHE_TTL_SECONDS = 2_592_000;
const CURRENT_YEAR_CACHE_TTL_SECONDS = 21_600;

export type WindnerdClimatologyOptions = {
  /** The consumer's speed-band bounds — a judgment parameter with no
   * default; it shapes every bandCounts stack and joins the cache key. */
  thresholds: SpeedThresholds;
  /** Calendar years to reach back, the current one included. */
  years?: number;
  sectorCount?: number;
  /** Slot width in minutes: a multiple of the 180-minute record period that
   * divides 1440 (180, 360, or 720). */
  slotMinutes?: number;
  environment?: ServerEnvironment;
  recordsUrl?: string;
  liveUrl?: string;
};

/**
 * Builds the station's climatology cube from the vendor's yearly archive:
 * one records request per calendar year (closed years cached ~30 days, the
 * running year 6 hours), folded into (month, slot, sector) sums bucketed in
 * the station's STANDARD time. Any year the upstream refuses fails the
 * whole document — a silently missing year would read as an outage, and
 * plausible-but-wrong is the named failure mode.
 */
export async function loadWindnerdClimatology(
  config: WindnerdStationConfig,
  options: WindnerdClimatologyOptions,
): Promise<StationClimatology> {
  const environment = resolveEnvironment(options.environment);
  const yearsBack = options.years ?? CLIMATOLOGY_DEFAULT_YEARS;
  if (!Number.isInteger(yearsBack) || yearsBack < 1) {
    throw new Error(`WindNerd location ${config.locationId}: years must be a positive integer`);
  }
  const sectorCount = options.sectorCount ?? CLIMATOLOGY_DEFAULT_SECTOR_COUNT;
  const slotMinutes = options.slotMinutes ?? CLIMATOLOGY_RECORD_PERIOD_MINUTES;
  if (slotMinutes % CLIMATOLOGY_RECORD_PERIOD_MINUTES !== 0 || 1440 % slotMinutes !== 0) {
    throw new Error(
      `WindNerd location ${config.locationId}: slotMinutes must be a multiple of ` +
        `${CLIMATOLOGY_RECORD_PERIOD_MINUTES} that divides 1440, got ${slotMinutes}`,
    );
  }
  const thresholdsMps = thresholdsToMps(options.thresholds);
  const utcOffsetMinutes = await standardOffsetMinutes(config, environment, options);

  const accumulator = createClimatologyAccumulator({
    sectorCount,
    slotMinutes,
    thresholdsMps,
    utcOffsetMinutes,
  });
  const now = environment.now();
  const currentYear = now.getUTCFullYear();
  const years: ClimatologyYear[] = [];
  for (let year = currentYear - (yearsBack - 1); year <= currentYear; year += 1) {
    const from = Date.UTC(year, 0, 1);
    const to = Math.min(Date.UTC(year + 1, 0, 1), now.getTime());
    const url = new URL(options.recordsUrl ?? WINDNERD_RECORDS_URL);
    url.searchParams.set("location_id", String(config.locationId));
    url.searchParams.set("from", new Date(from).toISOString());
    url.searchParams.set("to", new Date(Date.UTC(year + 1, 0, 1)).toISOString());
    url.searchParams.set("period", String(CLIMATOLOGY_RECORD_PERIOD_MINUTES));
    const records = parseWindnerdRecords(
      await fetchUpstreamText(environment, {
        url,
        cacheKey: `windnerd/climo/${config.locationId}/${year}/${CLIMATOLOGY_RECORD_PERIOD_MINUTES}`,
        cacheTtlSeconds:
          year < currentYear ? CLOSED_YEAR_CACHE_TTL_SECONDS : CURRENT_YEAR_CACHE_TTL_SECONDS,
        subject: `WindNerd location ${config.locationId} climatology ${year}`,
      }),
      config.locationId,
      config.hasPressure,
    );
    const points = windnerdHistoryPoints(records, config);
    foldClimatologyPoints(accumulator, points);
    years.push({
      year,
      sampleCount: points.length,
      expectedCount: Math.floor((to - from) / (CLIMATOLOGY_RECORD_PERIOD_MINUTES * 60_000)),
      coveredSlotCount: 0 /* filled from the fold below */,
      expectedSlotCount: Math.floor((to - from) / (slotMinutes * 60_000)),
    });
  }
  const coveredByYear = coveredSlotCountByYear(accumulator);
  for (const ledger of years) {
    ledger.coveredSlotCount = coveredByYear.get(ledger.year) ?? 0;
  }

  /* A leading year with nothing at all predates the station; it neither
   * counts against coverage nor pads the ledger. An interior silent year
   * stays — that is a real outage. */
  while (years.length > 1 && years[0]?.sampleCount === 0) years.shift();

  return {
    schemaVersion: STATION_CLIMATOLOGY_SCHEMA_VERSION,
    servedAt: now.toISOString(),
    stationId: config.id,
    sectorCount,
    slotMinutes,
    thresholdsMps,
    utcOffsetMinutes,
    years,
    cells: accumulatedCells(accumulator),
  };
}

/* The station's standard offset, from the cached location block. Unknown
 * degrades to UTC bucketing — and the document says so by echoing 0. */
async function standardOffsetMinutes(
  config: WindnerdStationConfig,
  environment: ResolvedEnvironment,
  options: WindnerdClimatologyOptions,
): Promise<number> {
  try {
    const cached = await loadWindnerdLocation(config, environment, { liveUrl: options.liveUrl });
    return cached.location?.standardUtcOffsetMinutes ?? 0;
  } catch (error) {
    logUpstreamFailure(
      environment,
      `${config.name} standard offset unavailable, bucketing in UTC`,
      error,
      { station: config.id },
    );
    return 0;
  }
}
