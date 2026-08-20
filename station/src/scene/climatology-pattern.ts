import { climatologyCoverage, climatologyPattern } from "../climatology.js";
import type { ClimatologyFilters } from "../climatology.js";
import type { StationClimatology } from "../contract-climatology.js";
import type { SpeedThresholds, SpeedUnit } from "../derive.js";
import type { FavorableDirection } from "../instruments.js";
import type { StationStrings } from "../strings.js";
import { dailyPatternSlotsScene } from "./daily-pattern.js";
import type { DailyPatternScene } from "./daily-pattern.js";

export const CLIMATOLOGY_PATTERN_CLASS = "meteo-climatology-daily-pattern";

export type ClimatologyPatternGate =
  | { kind: "draw"; document: StationClimatology }
  | { kind: "note"; className: string; text: string };

export function climatologyPatternGate(
  document: StationClimatology | null | undefined,
  words: StationStrings,
): ClimatologyPatternGate {
  if (document == null || document.cells.length === 0) {
    return {
      kind: "note",
      className: `${CLIMATOLOGY_PATTERN_CLASS} meteo-climatology-daily-pattern-na`,
      text: words.noClimatology,
    };
  }
  return { kind: "draw", document };
}

/** The cube's typical day through the daily-pattern drawing. The coverage
 * percentage rides only the unfiltered view — the ledger cannot vouch for a
 * filtered slice, which captions a plain sample count instead. */
export function climatologyPatternScene(input: {
  document: StationClimatology;
  favorableDirections?: FavorableDirection[] | undefined;
  filters?: Pick<ClimatologyFilters, "months"> | undefined;
  hatchId: string;
  plotHeight: number | undefined;
  stationName: string | undefined;
  thresholds: SpeedThresholds | undefined;
  unit: SpeedUnit;
  width: number;
  words: StationStrings;
}): DailyPatternScene {
  const { document, filters, ...rest } = input;
  const slots = climatologyPattern(document, filters);
  const totalSamples = slots.reduce((sum, slot) => sum + slot.sampleCount, 0);
  const unfiltered = filters?.months == null;
  const coverage = unfiltered ? climatologyCoverage(document) : null;
  return dailyPatternSlotsScene({
    ...rest,
    slotMinutes: document.slotMinutes,
    slots,
    coverage: {
      totalSamples,
      percent: coverage != null && coverage.ratio != null ? Math.round(coverage.ratio * 100) : null,
    },
  });
}
