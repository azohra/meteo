import { climatologyCoverage, climatologyPattern } from "../climatology.js";
import type { ClimatologyFilters } from "../climatology.js";
import type { StationClimatology } from "../contract-climatology.js";
import type { SpeedThresholds, SpeedUnit } from "../derive.js";
import type { FavorableDirection } from "../instruments.js";
import type { StationStrings } from "../strings.js";
import { dailyPatternSlotsScene } from "./daily-pattern.js";
import { el, type SceneChild } from "./node.js";

export const CLIMATOLOGY_PATTERN_CLASS = "meteo-climatology-daily-pattern";

/** Whether the cube has anything to draw — the bindings consult it to
 * decide whether to keep a width observer alive. */
export function hasClimatology(document: StationClimatology | null | undefined): boolean {
  return document != null && document.cells.length > 0;
}

/** The cube's typical day through the daily-pattern drawing. The coverage
 * percentage rides only the unfiltered view — the ledger cannot vouch for a
 * filtered slice, which captions a plain sample count instead. */
export function climatologyPatternScene(input: {
  document: StationClimatology | null | undefined;
  favorableDirections?: FavorableDirection[] | undefined;
  filters?: Pick<ClimatologyFilters, "months"> | undefined;
  hatchId: string;
  plotHeight: number | undefined;
  stationName: string | undefined;
  thresholds: SpeedThresholds | undefined;
  unit: SpeedUnit;
  width: number;
  words: StationStrings;
}): SceneChild[] {
  const { document, filters, ...rest } = input;
  if (document == null || document.cells.length === 0) {
    return [
      el(
        "div",
        {
          class: "meteo-climatology-daily-pattern meteo-climatology-daily-pattern-na",
          role: "note",
        },
        rest.words.noClimatology,
      ),
    ];
  }
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
