import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSiteForecastJson } from "@azohra/meteo.briefing/contract";
import type { ForecastSemantics } from "@azohra/meteo.briefing/contract";
import { deriveSiteForecast, type SourceHour, type SourceProfile } from "../src/derive.js";
import { compactJson, roundDocument } from "../src/publish.js";

const PARITY = join(__dirname, "..", "..", "briefing", "test", "pipeline-parity.json");

const ABSOLUTE_TOLERANCE = 5e-10;

/* The committed fixture is a deterministic profile: every scalar position
   is a plain number, never an ensemble block. */
interface FixtureLevel {
  pressureHpa: number;
  heightM: number;
  temperatureC: number;
  dewPointC: number;
  windSpeedMps: number;
  windDirectionDeg: number;
  verticalVelocityPaS?: number;
  cloudFractionPercent?: number;
}

interface FixtureHour {
  validAt: string;
  surface: Record<string, number> & {
    seaLevelPressureHpa: number;
    temperatureC: number;
    dewPointC: number;
    windSpeedMps: number;
    windDirectionDeg: number;
    cloudCoverPercent: number;
    precipitationMmHr: number;
    sensibleHeatFluxWm2: number;
    latentHeatFluxWm2: number;
  };
  levels: FixtureLevel[];
  derived: Record<string, number | null>;
}

interface FixtureProfile {
  schemaVersion: number;
  model: string;
  run: { referenceTime: string; generatedAt: string };
  site: {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    modelElevationM: number;
    timeZone?: string;
  };
  semantics: ForecastSemantics;
  hours: FixtureHour[];
}

const OPTIONAL_SURFACE_FIELDS = [
  "windGustMps",
  "capeJkg",
  "cinJkg",
  "pblHeightM",
  "lowCloudPercent",
  "midCloudPercent",
  "highCloudPercent",
] as const;

/**
 * Invert a published profile document back to deriveSiteForecast's
 * source form. Every needed input is itself published.
 */
function toSource(profile: FixtureProfile): SourceProfile {
  const site = profile.site;
  const hours: SourceHour[] = [];
  for (const hour of profile.hours) {
    const surface = hour.surface;
    const sourceHour: SourceHour = {
      validAt: hour.validAt,
      seaLevelPressureHpa: surface.seaLevelPressureHpa,
      temperatureC: surface.temperatureC,
      dewPointDepressionC: surface.temperatureC - surface.dewPointC,
      windSpeedMps: surface.windSpeedMps,
      windDirectionDeg: surface.windDirectionDeg,
      cloudCoverPercent: surface.cloudCoverPercent,
      precipitationMm: surface.precipitationMmHr,
      sensibleHeatFluxWm2: surface.sensibleHeatFluxWm2,
      latentHeatFluxWm2: surface.latentHeatFluxWm2,
      levels: hour.levels.map((level) => ({
        pressureHpa: level.pressureHpa,
        heightM: level.heightM,
        temperatureC: level.temperatureC,
        dewPointDepressionC: level.temperatureC - level.dewPointC,
        windSpeedMps: level.windSpeedMps,
        windDirectionDeg: level.windDirectionDeg,
        ...(level.verticalVelocityPaS !== undefined
          ? { verticalVelocityPaS: level.verticalVelocityPaS }
          : {}),
        ...(level.cloudFractionPercent !== undefined
          ? { cloudFractionPercent: level.cloudFractionPercent }
          : {}),
      })),
    };
    for (const optional of OPTIONAL_SURFACE_FIELDS) {
      if (optional in surface) {
        sourceHour[optional] = surface[optional];
      }
    }
    hours.push(sourceHour);
  }
  const source: SourceProfile = {
    generatedAt: profile.run.generatedAt,
    referenceTime: profile.run.referenceTime,
    latitude: site.latitude,
    longitude: site.longitude,
    modelElevationM: site.modelElevationM,
    siteId: site.id,
    siteName: site.name,
    hours,
  };
  if (site.timeZone !== undefined) {
    source.siteTimeZone = site.timeZone;
  }
  return source;
}

function regenerate(profile: FixtureProfile) {
  // The document declares its own transport semantics, so regeneration
  // needs no model registry.
  return deriveSiteForecast(toSource(profile), profile.model, profile.semantics);
}

const deviation = { max: 0, at: "" };

function mismatches(path: string, committed: unknown, fresh: unknown, out: string[]): void {
  if (
    committed !== null &&
    fresh !== null &&
    typeof committed === "object" &&
    typeof fresh === "object" &&
    !Array.isArray(committed) &&
    !Array.isArray(fresh)
  ) {
    const committedRecord = committed as Record<string, unknown>;
    const freshRecord = fresh as Record<string, unknown>;
    for (const key of [
      ...new Set([...Object.keys(committedRecord), ...Object.keys(freshRecord)]),
    ].sort()) {
      if (!(key in committedRecord) || !(key in freshRecord)) {
        out.push(`${path}.${key}: only in ${key in committedRecord ? "fixture" : "regeneration"}`);
      } else {
        mismatches(`${path}.${key}`, committedRecord[key], freshRecord[key], out);
      }
    }
  } else if (Array.isArray(committed) && Array.isArray(fresh)) {
    if (committed.length !== fresh.length) {
      out.push(`${path}: length ${committed.length} != ${fresh.length}`);
    }
    for (let index = 0; index < Math.min(committed.length, fresh.length); index += 1) {
      mismatches(`${path}[${index}]`, committed[index], fresh[index], out);
    }
  } else if (typeof committed === "number" && typeof fresh === "number") {
    const difference = Math.abs(committed - fresh);
    if (difference > deviation.max) {
      deviation.max = difference;
      deviation.at = path;
    }
    if (!(difference <= ABSOLUTE_TOLERANCE)) {
      out.push(`${path}: ${committed} != ${fresh}`);
    }
  } else if (committed !== fresh) {
    out.push(`${path}: ${JSON.stringify(committed)} != ${JSON.stringify(fresh)}`);
  }
}

const committed = JSON.parse(readFileSync(PARITY, "utf-8")) as FixtureProfile;

describe("pipeline parity", () => {
  it("re-derives the committed fixture to 5e-10 pre-rounding", () => {
    const found: string[] = [];
    mismatches("$", committed, regenerate(committed), found);
    expect(
      found,
      "briefing/test/pipeline-parity.json disagrees with the TypeScript " +
        "derivation; if the Python derivation deliberately changed, " +
        "regenerate the fixture (see python/tests/test_pipeline_parity.py) " +
        "and re-port — never loosen this gate:\n" +
        found.join("\n"),
    ).toEqual([]);
    // eslint-disable-next-line no-console
    console.info(
      `parity max abs deviation: ${deviation.max} at ${deviation.at || "(bit-identical)"}`,
    );
  });

  it("matches the fixture exactly post-rounding through publish.roundDocument", () => {
    const roundedFixture = roundDocument(committed);
    const roundedFresh = roundDocument(regenerate(committed));
    // Byte-for-byte through the same serializer the pipeline publishes
    // with.
    expect(compactJson(roundedFresh)).toBe(compactJson(roundedFixture));
  });

  it("a derived and rounded document passes the contract's site-forecast guard", () => {
    // The cross-language contract, enforced in-language: what this
    // pipeline derives and rounds is exactly what @azohra/meteo.core agrees to
    // read.
    const text = compactJson(roundDocument(regenerate(committed)));
    expect(parseSiteForecastJson(text)).not.toBeNull();
  });
});
