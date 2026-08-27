import type { DirectionArc } from "@azohra/meteo.core";
import { climatologyCoverage, climatologyFavorableShare, climatologyRose } from "../climatology.js";
import type { ClimatologyFilters } from "../climatology.js";
import type { StationClimatology } from "../contract-climatology.js";
import type { FavorableDirection } from "../instruments.js";
import type { StationStrings } from "../strings.js";
import { windRoseScene } from "./rose.js";
import { el, keyed, type SceneChild, type SceneNode } from "./node.js";

export const CLIMATOLOGY_ROSE_CLASS = "meteo-climatology-rose";

export function climatologyRoseScene(input: {
  document: StationClimatology | null | undefined;
  favorableDirections: FavorableDirection[] | undefined;
  filters?: ClimatologyFilters | undefined;
  stationName: string | undefined;
  words: StationStrings;
}): SceneNode {
  const { document, favorableDirections, filters, stationName, words } = input;
  if (document == null || document.cells.length === 0) {
    return el(
      "div",
      { class: "meteo-climatology-rose meteo-climatology-rose-na", role: "note" },
      words.noClimatology,
    );
  }
  const summary = climatologyRose(document, filters);

  /* The honesty row beneath the drawing: favorable share (only with arcs),
   * then samples — with the coverage percentage only when the whole cube is
   * shown, since the ledger cannot vouch for a filtered slice. */
  const captions: SceneChild[] = [];
  const arcs: ReadonlyArray<DirectionArc> = favorableDirections ?? [];
  const share = arcs.length === 0 ? null : climatologyFavorableShare(document, arcs, filters);
  if (share != null) {
    captions.push(
      keyed(
        "favorable",
        "p",
        { class: "meteo-climatology-caption meteo-climatology-caption-favorable" },
        words.percentFavorable(Math.round(share * 100)),
      ),
    );
  }
  const unfiltered = filters?.months == null && filters?.slots == null;
  const coverage = unfiltered ? climatologyCoverage(document) : null;
  captions.push(
    keyed(
      "samples",
      "p",
      { class: "meteo-climatology-caption" },
      coverage != null && coverage.ratio != null
        ? words.dailyPatternCoverage(summary.sampleCount, Math.round(coverage.ratio * 100))
        : words.dailyPatternSamples(summary.sampleCount),
    ),
  );

  return el(
    "div",
    { class: CLIMATOLOGY_ROSE_CLASS },
    windRoseScene(
      {
        favorableDirections,
        sectorCount: document.sectorCount,
        source: [],
        stationName,
        summary,
        thresholds: undefined,
        words,
      },
      captions,
    ),
  );
}
