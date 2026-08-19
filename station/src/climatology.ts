import { componentsToWind, inDirectionArcs, windToComponents } from "@azohra/meteo.core";
import type { DirectionArc } from "@azohra/meteo.core";
import type { HistoryPoint } from "./contract.js";
import type { ClimatologyCell, StationClimatology } from "./contract-climatology.js";
import { CALM_THRESHOLD_MPS, isCalm, normalizeDegrees } from "./derive.js";
import { speedBand } from "./geometry.js";
import type { DailyPatternSlot, RoseSector, WindRoseSummary } from "./geometry.js";

/* ── The fold ──────────────────────────────────────────────────────────────
 * Sums, not means, accumulate into (month, slot, sector) buckets so any
 * month/season/time-of-day filter re-aggregates losslessly with no refetch.
 * Bucketing runs in the station's STANDARD time (utcOffsetMinutes, no DST)
 * so a slot means the same solar hours in January and July. */

export type ClimatologyFoldParams = {
  sectorCount: number;
  slotMinutes: number;
  /** The consumer's band bounds in m/s, ascending — a judgment parameter
   * with no default; it shapes every bandCounts list. */
  thresholdsMps: ReadonlyArray<number>;
  utcOffsetMinutes: number;
};

type MutableSector = {
  count: number;
  uSum: number;
  vSum: number;
  speedSumMps: number;
  bandCounts: number[];
  maxGustMps: number | null;
};

type MutableCell = {
  sampleCount: number;
  calmCount: number;
  sectors: Map<number, MutableSector>;
};

export type ClimatologyAccumulator = {
  readonly params: ClimatologyFoldParams;
  readonly cells: Map<string, MutableCell>;
};

export function createClimatologyAccumulator(
  params: ClimatologyFoldParams,
): ClimatologyAccumulator {
  if (params.slotMinutes <= 0 || 1440 % params.slotMinutes !== 0) {
    throw new Error(`climatology: slotMinutes must evenly divide 1440, got ${params.slotMinutes}`);
  }
  if (params.sectorCount < 4) {
    throw new Error(`climatology: sectorCount must be at least 4, got ${params.sectorCount}`);
  }
  return { params, cells: new Map() };
}

export function foldClimatologyPoints(
  accumulator: ClimatologyAccumulator,
  points: ReadonlyArray<HistoryPoint>,
): void {
  const { sectorCount, slotMinutes, thresholdsMps, utcOffsetMinutes } = accumulator.params;
  const sectorWidth = 360 / sectorCount;
  for (const point of points) {
    const localMs = Date.parse(point.observedAt) + utcOffsetMinutes * 60_000;
    const local = new Date(localMs);
    const month = local.getUTCMonth() + 1;
    const minuteOfDay = local.getUTCHours() * 60 + local.getUTCMinutes();
    const slot = Math.floor(minuteOfDay / slotMinutes);
    const key = `${month}/${slot}`;
    let cell = accumulator.cells.get(key);
    if (cell == null) {
      cell = { sampleCount: 0, calmCount: 0, sectors: new Map() };
      accumulator.cells.set(key, cell);
    }
    cell.sampleCount += 1;
    if (isCalm(point.windAvgMps) || point.windDirectionDeg == null) {
      cell.calmCount += 1;
      continue;
    }
    const bearing = normalizeDegrees(point.windDirectionDeg);
    const sectorIndex = Math.round(bearing / sectorWidth) % sectorCount;
    let sector = cell.sectors.get(sectorIndex);
    if (sector == null) {
      sector = {
        count: 0,
        uSum: 0,
        vSum: 0,
        speedSumMps: 0,
        bandCounts: Array.from({ length: thresholdsMps.length + 1 }, () => 0),
        maxGustMps: null,
      };
      cell.sectors.set(sectorIndex, sector);
    }
    const components = windToComponents(point.windAvgMps, bearing);
    sector.count += 1;
    sector.uSum += components.uMps;
    sector.vSum += components.vMps;
    sector.speedSumMps += point.windAvgMps;
    sector.bandCounts[speedBand(point.windAvgMps, thresholdsMps)] =
      (sector.bandCounts[speedBand(point.windAvgMps, thresholdsMps)] ?? 0) + 1;
    if (point.windGustMps != null) {
      sector.maxGustMps =
        sector.maxGustMps == null
          ? point.windGustMps
          : Math.max(sector.maxGustMps, point.windGustMps);
    }
  }
}

/** The accumulated buckets as wire cells: month, then slot, then sector,
 * every empty bucket absent. */
export function accumulatedCells(accumulator: ClimatologyAccumulator): ClimatologyCell[] {
  const cells: ClimatologyCell[] = [];
  for (const [key, cell] of accumulator.cells) {
    const [month, slot] = key.split("/").map(Number) as [number, number];
    cells.push({
      month,
      slot,
      sampleCount: cell.sampleCount,
      calmCount: cell.calmCount,
      sectors: [...cell.sectors.entries()]
        .sort(([left], [right]) => left - right)
        .map(([sector, sums]) => ({
          sector,
          count: sums.count,
          uSum: roundSum(sums.uSum),
          vSum: roundSum(sums.vSum),
          speedSumMps: roundSum(sums.speedSumMps),
          bandCounts: sums.bandCounts,
          maxGustMps: sums.maxGustMps,
        })),
    });
  }
  return cells.sort((left, right) => left.month - right.month || left.slot - right.slot);
}

/* Six decimals keep the wire compact; at m/s scale the residue is far below
 * any instrument's resolution. */
function roundSum(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/* ── Re-aggregation ────────────────────────────────────────────────────────
 * Every view below is a pure function of the document and the consumer's
 * filters; a filter interaction never refetches. */

export type ClimatologyFilters = {
  /** Calendar months to keep, 1–12; absent keeps all. */
  months?: ReadonlyArray<number>;
  /** Slot-of-day indices to keep; absent keeps all. */
  slots?: ReadonlyArray<number>;
};

function selectedCells(
  document: StationClimatology,
  filters: ClimatologyFilters | undefined,
): ClimatologyCell[] {
  const months = filters?.months == null ? null : new Set(filters.months);
  const slots = filters?.slots == null ? null : new Set(filters.slots);
  return document.cells.filter(
    (cell) => (months == null || months.has(cell.month)) && (slots == null || slots.has(cell.slot)),
  );
}

/** The filtered cube as a rose — geometry's WindRoseSummary shape, every
 * sector carrying its bandCounts stack. */
export function climatologyRose(
  document: StationClimatology,
  filters?: ClimatologyFilters,
): WindRoseSummary {
  const cells = selectedCells(document, filters);
  const sectorWidth = 360 / document.sectorCount;
  const totals = new Map<number, MutableSector>();
  let sampleCount = 0;
  let calm = 0;
  for (const cell of cells) {
    sampleCount += cell.sampleCount;
    calm += cell.calmCount;
    for (const sector of cell.sectors) {
      let total = totals.get(sector.sector);
      if (total == null) {
        total = {
          count: 0,
          uSum: 0,
          vSum: 0,
          speedSumMps: 0,
          bandCounts: Array.from({ length: document.thresholdsMps.length + 1 }, () => 0),
          maxGustMps: null,
        };
        totals.set(sector.sector, total);
      }
      total.count += sector.count;
      total.uSum += sector.uSum;
      total.vSum += sector.vSum;
      total.speedSumMps += sector.speedSumMps;
      sector.bandCounts.forEach((bandCount, band) => {
        total.bandCounts[band] = (total.bandCounts[band] ?? 0) + bandCount;
      });
      if (sector.maxGustMps != null) {
        total.maxGustMps =
          total.maxGustMps == null
            ? sector.maxGustMps
            : Math.max(total.maxGustMps, sector.maxGustMps);
      }
    }
  }
  const blowing = sampleCount - calm;
  const sectors: RoseSector[] = Array.from({ length: document.sectorCount }, (_, index) => {
    const total = totals.get(index);
    return {
      bearingDeg: index * sectorWidth,
      count: total?.count ?? 0,
      frequency: blowing === 0 || total == null ? 0 : total.count / blowing,
      meanSpeedMps: total == null || total.count === 0 ? null : total.speedSumMps / total.count,
      maxGustMps: total?.maxGustMps ?? null,
      bandCounts: total?.bandCounts ?? undefined,
    };
  });
  return {
    sectors,
    calmFraction: sampleCount === 0 ? 0 : calm / sampleCount,
    sampleCount,
  };
}

/** The filtered cube as a typical day — geometry's DailyPatternSlot list,
 * vector-averaged per slot, calm records weighing the mean down exactly as
 * the point-level dailyPattern does. */
export function climatologyPattern(
  document: StationClimatology,
  filters?: Pick<ClimatologyFilters, "months">,
): DailyPatternSlot[] {
  const cells = selectedCells(document, filters);
  const slotCount = 1440 / document.slotMinutes;
  const slots = Array.from({ length: slotCount }, (_, index) => ({
    startMinuteOfDay: index * document.slotMinutes,
    sampleCount: 0,
    uSum: 0,
    vSum: 0,
  }));
  for (const cell of cells) {
    const slot = slots[cell.slot];
    if (slot == null) continue;
    slot.sampleCount += cell.sampleCount;
    for (const sector of cell.sectors) {
      slot.uSum += sector.uSum;
      slot.vSum += sector.vSum;
    }
  }
  return slots.map((slot) => {
    if (slot.sampleCount === 0) {
      return {
        startMinuteOfDay: slot.startMinuteOfDay,
        sampleCount: 0,
        windDirectionDeg: null,
        speedMps: 0,
      };
    }
    const mean = componentsToWind(slot.uSum / slot.sampleCount, slot.vSum / slot.sampleCount);
    return {
      startMinuteOfDay: slot.startMinuteOfDay,
      sampleCount: slot.sampleCount,
      windDirectionDeg: mean.speedMps < CALM_THRESHOLD_MPS ? null : mean.directionDeg,
      speedMps: mean.speedMps,
    };
  });
}

export type ClimatologyCoverage = {
  sampleCount: number;
  expectedCount: number;
  ratio: number;
};

/** The whole record's honesty figure, summed over the year ledger. */
export function climatologyCoverage(document: StationClimatology): ClimatologyCoverage {
  let sampleCount = 0;
  let expectedCount = 0;
  for (const year of document.years) {
    sampleCount += year.sampleCount;
    expectedCount += year.expectedCount;
  }
  return {
    sampleCount,
    expectedCount,
    ratio: expectedCount === 0 ? 0 : sampleCount / expectedCount,
  };
}

/** The share of the filtered non-calm record blowing from inside the
 * consumer's arcs, judged at each sector's centre bearing; null when
 * nothing non-calm was recorded — absence over a fabricated zero. */
export function climatologyFavorableShare(
  document: StationClimatology,
  arcs: ReadonlyArray<DirectionArc>,
  filters?: ClimatologyFilters,
): number | null {
  if (arcs.length === 0) return null;
  const sectorWidth = 360 / document.sectorCount;
  let blowing = 0;
  let favorable = 0;
  for (const cell of selectedCells(document, filters)) {
    for (const sector of cell.sectors) {
      blowing += sector.count;
      if (inDirectionArcs(sector.sector * sectorWidth, arcs)) favorable += sector.count;
    }
  }
  return blowing === 0 ? null : favorable / blowing;
}
