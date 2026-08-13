import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { deriveSiteForecast, type SourceProfile } from "../src/derive.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BASELINE_PATH = join(
  ROOT,
  "scenarios",
  "baselines",
  "hrrr-red-mountain-2026-08-08.source.json",
);
const PROVENANCE_PATH = join(
  ROOT,
  "scenarios",
  "baselines",
  "hrrr-red-mountain-2026-08-08.provenance.json",
);
const ARCHIVED_PROFILE_PATH = join(
  ROOT,
  "scenarios",
  "baselines",
  "hrrr-red-mountain-2026-08-08.profile.json",
);

const DERIVED_TOLERANCES: Record<string, [string, number]> = {
  boundaryLayerTopM: ["derivedBoundaryLayerTopM", 6],
  thermalVelocityMps: ["derivedThermalVelocityMs", 0.01],
  cloudBaseM: ["derivedCloudBaseM", 52],
  usableLiftTopM: ["derivedUsableLiftTopM", 52],
};

const HRRR_SEMANTICS = { gust: "instant", precipitation: "instantRate" } as const;

const OPTIONAL_SURFACE_FIELDS = [
  "windGustMps",
  "capeJkg",
  "cinJkg",
  "pblHeightM",
  "lowCloudPercent",
  "midCloudPercent",
  "highCloudPercent",
] as const;

const SOURCE_TO_PUBLISHED_SURFACE: Record<string, string> = {
  seaLevelPressureHpa: "seaLevelPressureHpa",
  temperatureC: "temperatureC",
  windSpeedMps: "windSpeedMps",
  windDirectionDeg: "windDirectionDeg",
  cloudCoverPercent: "cloudCoverPercent",
  precipitationMm: "precipitationMmHr",
  sensibleHeatFluxWm2: "sensibleHeatFluxWm2",
  latentHeatFluxWm2: "latentHeatFluxWm2",
};

const UNCHANGED_LEVEL_FIELDS = [
  "pressureHpa",
  "heightM",
  "temperatureC",
  "windSpeedMps",
  "windDirectionDeg",
] as const;

type Doc = Record<string, any>;

function loadJson(path: string): Doc {
  return JSON.parse(readFileSync(path, "utf-8")) as Doc;
}

function containsDerived(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsDerived);
  }
  if (value !== null && typeof value === "object") {
    return "derived" in (value as Doc) || Object.values(value as Doc).some(containsDerived);
  }
  return false;
}

describe("calibrated HRRR baseline", () => {
  it("reconstructs the archived production profile within documented tolerances", () => {
    const source = loadJson(BASELINE_PATH);
    const provenance = loadJson(PROVENANCE_PATH);
    const archived = loadJson(ARCHIVED_PROFILE_PATH);

    expect(containsDerived(source)).toBe(false);
    expect(source.hours.length).toBe(10);
    expect(archived.hours.length).toBe(10);

    const regenerated = deriveSiteForecast(
      source as unknown as SourceProfile,
      "hrrr-conus",
      HRRR_SEMANTICS,
    ) as unknown as Doc;
    expect(regenerated.run).toEqual(archived.run);
    // The archived profile is a captured v1 production document, so its site
    // block still bakes the launch's altitudeM. Documents are launch-agnostic
    // now: the reconstruction reproduces everything but that retired field.
    expect(regenerated.site).toEqual(
      Object.fromEntries(Object.entries(archived.site).filter(([key]) => key !== "altitudeM")),
    );
    expect(regenerated.semantics).toEqual(HRRR_SEMANTICS);

    const documented = provenance.numericTolerances;
    for (const [toleranceKey, expectedTolerance] of Object.values(DERIVED_TOLERANCES)) {
      expect(documented[toleranceKey].absolute).toBe(expectedTolerance);
    }

    for (let index = 0; index < source.hours.length; index += 1) {
      const sourceHour = source.hours[index];
      const regeneratedHour = regenerated.hours[index];
      const archivedHour = archived.hours[index];
      expect(regeneratedHour.validAt).toBe(archivedHour.validAt);

      for (const [sourceField, publishedField] of Object.entries(SOURCE_TO_PUBLISHED_SURFACE)) {
        expect(sourceHour[sourceField]).toBe(archivedHour.surface[publishedField]);
      }
      for (const field of OPTIONAL_SURFACE_FIELDS) {
        expect(sourceHour[field]).toBe(archivedHour.surface[field]);
        expect(regeneratedHour.surface[field]).toBe(archivedHour.surface[field]);
      }

      expect(regeneratedHour.surface.dewPointC).toBeCloseTo(archivedHour.surface.dewPointC, 2);
      expect(regeneratedHour.levels.length).toBe(archivedHour.levels.length);
      expect(sourceHour.levels.length).toBe(archivedHour.levels.length);
      for (let levelIndex = 0; levelIndex < sourceHour.levels.length; levelIndex += 1) {
        const sourceLevel = sourceHour.levels[levelIndex];
        const regeneratedLevel = regeneratedHour.levels[levelIndex];
        const archivedLevel = archivedHour.levels[levelIndex];
        for (const field of UNCHANGED_LEVEL_FIELDS) {
          expect(sourceLevel[field]).toBe(archivedLevel[field]);
        }
        expect(regeneratedLevel.dewPointC).toBeCloseTo(archivedLevel.dewPointC, 2);
      }

      for (const [field, [toleranceKey]] of Object.entries(DERIVED_TOLERANCES)) {
        const regeneratedValue = regeneratedHour.derived[field];
        const archivedValue = archivedHour.derived[field];
        if (archivedValue === null) {
          expect(regeneratedValue).toBeNull();
        } else {
          expect(Math.abs(regeneratedValue - archivedValue)).toBeLessThanOrEqual(
            documented[toleranceKey].absolute,
          );
        }
      }
    }

    const derived = regenerated.hours.map((hour: Doc) => hour.derived);
    const firstSix = derived.slice(0, 6).map((hour: Doc) => hour.boundaryLayerTopM);
    expect(firstSix).toEqual([...firstSix].sort((a, b) => a - b));
    expect(derived[3].thermalVelocityMps).toBeGreaterThan(derived[0].thermalVelocityMps);
    expect(derived[6].thermalVelocityMps).toBeLessThan(derived[3].thermalVelocityMps);
    expect(derived.slice(0, 7).every((hour: Doc) => hour.usableLiftTopM !== null)).toBe(true);
    expect(derived.slice(7).every((hour: Doc) => hour.usableLiftTopM === null)).toBe(true);
  });
});
