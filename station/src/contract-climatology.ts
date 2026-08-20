import { z } from "zod";

/* Its own document family: climatology has a different lifetime (near-
 * immutable history), size, and cadence than the live feed, so it versions
 * apart from STATION_SCHEMA_VERSION. */
export const STATION_CLIMATOLOGY_SCHEMA_VERSION = 1;

const count = z.number().int().min(0);

/* One direction sector's accumulation inside a (month, slot) bucket. Sums,
 * not means, so buckets re-aggregate losslessly under any month/season/
 * time-of-day filter. */
export const climatologySectorSchema = z
  .object({
    sector: z
      .number()
      .int()
      .min(0)
      .describe("Sector index; bearing = sector × (360 / sectorCount)."),
    count: count.describe("Non-calm records whose direction fell in this sector."),
    uSum: z.number().finite().describe("Sum of zonal components, m/s — core's wind sign."),
    vSum: z.number().finite().describe("Sum of meridional components, m/s."),
    speedSumMps: z.number().finite().min(0).describe("Sum of scalar mean speeds, m/s."),
    bandCounts: z
      .array(count)
      .describe(
        "Records per speed band against the document's thresholdsMps — " +
          "length thresholdsMps.length + 1.",
      ),
    maxGustMps: z.number().finite().min(0).nullable(),
  })
  .meta({ id: "ClimatologySector" });
export type ClimatologySector = z.infer<typeof climatologySectorSchema>;

/* One (month, slot-of-day) bucket. Calm belongs to the bucket, not to any
 * sector — calm has no direction. A bucket nothing ever fell into is
 * ABSENT, never zero-filled. */
export const climatologyCellSchema = z
  .object({
    month: z.number().int().min(1).max(12),
    slot: z
      .number()
      .int()
      .min(0)
      .describe("Slot of day: floor(standard-time minute / slotMinutes)."),
    sampleCount: count.describe("All records in the bucket, calm included."),
    calmCount: count,
    sectors: z.array(climatologySectorSchema),
  })
  .meta({ id: "ClimatologyCell" });
export type ClimatologyCell = z.infer<typeof climatologyCellSchema>;

export const climatologyYearSchema = z
  .object({
    year: z.number().int(),
    sampleCount: count,
    expectedCount: count.describe(
      "Records a gapless station would have produced over the requested " +
        "window — the honesty denominator; a leading dropout lowers the " +
        "ratio instead of hiding.",
    ),
    /* sampleCount/expectedCount are denominated in the producer's fed period;
     * only this slot pair is period-independent, so only it earns a percent. */
    coveredSlotCount: count
      .nullish()
      .describe("Distinct (day, slot) buckets holding at least one record."),
    expectedSlotCount: count
      .nullish()
      .describe("Slots a gapless station would have covered over the window."),
  })
  .meta({ id: "ClimatologyYear" });
export type ClimatologyYear = z.infer<typeof climatologyYearSchema>;

const isoTime = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), { message: "not an ISO timestamp" })
  .meta({ format: "date-time" });

export const stationClimatologySchema = z
  .object({
    schemaVersion: z.literal(STATION_CLIMATOLOGY_SCHEMA_VERSION),
    servedAt: isoTime,
    stationId: z.string().min(1),
    sectorCount: z.number().int().min(4),
    slotMinutes: z.number().int().positive().describe("Minutes per slot of day; must divide 1440."),
    thresholdsMps: z
      .array(z.number().finite().min(0))
      .describe(
        "The consumer's speed-band bounds the cube was binned with, m/s, " +
          "ascending. A judgment parameter echoed so a reader knows which " +
          "opinion shaped bandCounts.",
      ),
    utcOffsetMinutes: z
      .number()
      .finite()
      .describe(
        "The station's STANDARD utc offset used for month and slot " +
          "bucketing — no DST, so a slot means the same solar hours in " +
          "January and July.",
      ),
    years: z.array(climatologyYearSchema).describe("Oldest first; the coverage ledger."),
    cells: z.array(climatologyCellSchema),
  })
  .meta({ id: "StationClimatology" });
export type StationClimatology = z.infer<typeof stationClimatologySchema>;

export function parseStationClimatology(value: unknown): StationClimatology | null {
  const result = stationClimatologySchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseStationClimatologyJson(text: string): StationClimatology | null {
  try {
    return parseStationClimatology(JSON.parse(text));
  } catch {
    return null;
  }
}
