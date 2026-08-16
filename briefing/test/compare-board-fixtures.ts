import { analyzeForecast, type ForecastAnalysis, type WindCeilings } from "../src/analyze/index.js";
import type { SiteForecast } from "../src/contract.js";
import {
  deterministicSceneProfile,
  ensembleSceneProfile,
  SCENE_LAUNCH,
  scienceSceneProfile,
} from "./scene-fixtures.js";

export const BOARD_TZ = "America/Vancouver";
export const BOARD_DAY = "2026-08-09";

/* Judgment parameters are the caller's: the board consumes analyses that
   already carry the ceilings — it owns no "safe wind" number. */
export const BOARD_CEILINGS: WindCeilings = {
  surfaceMps: 3,
  gust: { instantMps: 8, hourMaxMps: 10 },
  bandMps: 8,
};

export const BOARD_ANALYZE_OPTIONS = {
  timeZone: BOARD_TZ,
  launch: SCENE_LAUNCH,
  windCeilings: BOARD_CEILINGS,
};

/* The science profile with declared semantics and an afternoon rain
   onset, so the board's gust class, storms, and rain marks all have a
   stated source. */
export function stormySceneProfile(): SiteForecast {
  const base = scienceSceneProfile();
  return {
    ...base,
    semantics: { gust: "instant", precipitation: "instantRate" },
    hours: base.hours.map((hour, h) =>
      h >= 4
        ? { ...hour, surface: { ...hour.surface, precipitationMmHr: h === 4 ? 0.6 : 1.1 } }
        : hour,
    ),
  };
}

/* The scene fixture with the deterministic/ensemble declaration made
   explicit: run.members absence IS the deterministic declaration, and the
   board must read this document as the ensemble its values are. */
export function ensembleBoardProfile(): SiteForecast {
  const base = ensembleSceneProfile();
  return { ...base, run: { ...base.run, members: 21 } };
}

/** Three members over one site and day: a plain deterministic document, a CAPE/CIN one with a declared gust class, and an ensemble. */
export function boardAnalyses(): ForecastAnalysis[] {
  return [
    analyzeForecast(deterministicSceneProfile(), BOARD_ANALYZE_OPTIONS),
    analyzeForecast(stormySceneProfile(), BOARD_ANALYZE_OPTIONS),
    analyzeForecast(ensembleBoardProfile(), BOARD_ANALYZE_OPTIONS),
  ];
}
