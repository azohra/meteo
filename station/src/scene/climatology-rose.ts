import type { DirectionArc } from "@azohra/meteo.core";
import { climatologyCoverage, climatologyFavorableShare, climatologyRose } from "../climatology.js";
import type { ClimatologyFilters } from "../climatology.js";
import type { StationClimatology } from "../contract-climatology.js";
import type { FavorableDirection } from "../instruments.js";
import type { StationStrings } from "../strings.js";
import { windRoseScene } from "./rose.js";
import type { WindRoseScene } from "./rose.js";

export const CLIMATOLOGY_ROSE_CLASS = "meteo-climatology-rose";

export type ClimatologyRoseGate =
  | { kind: "draw"; document: StationClimatology }
  | { kind: "note"; className: string; text: string };

export function climatologyRoseGate(
  document: StationClimatology | null | undefined,
  words: StationStrings,
): ClimatologyRoseGate {
  if (document == null || document.cells.length === 0) {
    return {
      kind: "note",
      className: `${CLIMATOLOGY_ROSE_CLASS} meteo-climatology-rose-na`,
      text: words.noClimatology,
    };
  }
  return { kind: "draw", document };
}

export type ClimatologyRoseScene = {
  className: string;
  rose: WindRoseScene;
  /** The honesty row beneath the drawing: favorable share (only with arcs),
   * then samples — with the coverage percentage only when the whole cube is
   * shown, since the ledger cannot vouch for a filtered slice. */
  captions: Array<{ key: string; className: string; text: string }>;
};

export function climatologyRoseScene(input: {
  document: StationClimatology;
  favorableDirections: FavorableDirection[] | undefined;
  filters?: ClimatologyFilters | undefined;
  stationName: string | undefined;
  words: StationStrings;
}): ClimatologyRoseScene {
  const { document, favorableDirections, filters, stationName, words } = input;
  const summary = climatologyRose(document, filters);
  const rose = windRoseScene({
    favorableDirections,
    sectorCount: document.sectorCount,
    source: [],
    stationName,
    summary,
    thresholds: undefined,
    words,
  });

  const captions: ClimatologyRoseScene["captions"] = [];
  const arcs: ReadonlyArray<DirectionArc> = favorableDirections ?? [];
  const share = arcs.length === 0 ? null : climatologyFavorableShare(document, arcs, filters);
  if (share != null) {
    captions.push({
      key: "favorable",
      className: "meteo-climatology-caption meteo-climatology-caption-favorable",
      text: words.percentFavorable(Math.round(share * 100)),
    });
  }
  const unfiltered = filters?.months == null && filters?.slots == null;
  const coverage = unfiltered ? climatologyCoverage(document) : null;
  captions.push({
    key: "samples",
    className: "meteo-climatology-caption",
    text:
      coverage != null && coverage.ratio != null
        ? words.dailyPatternCoverage(summary.sampleCount, Math.round(coverage.ratio * 100))
        : words.dailyPatternSamples(summary.sampleCount),
  });
  return { className: CLIMATOLOGY_ROSE_CLASS, rose, captions };
}
