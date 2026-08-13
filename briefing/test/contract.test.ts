import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  isEnsembleDropout,
  isEnsembleValue,
  modelCatalogueSchema,
  parseModelCatalogue,
  parseModelCatalogueJson,
  parseRunsIndex,
  parseRunsIndexJson,
  parseSitesCatalogue,
  parseSitesCatalogueJson,
  parseForecastManifest,
  parseForecastManifestJson,
  parseManifest,
  parseObservationManifest,
  parseSiteForecast,
  parseSiteForecastJson,
  runsIndexSchema,
  sitesCatalogueSchema,
  forecastManifestSchema,
  siteForecastSchema,
} from "../src/contract.js";
import { renderSchemaArtifact } from "@azohra/meteo.core";
import { schemaArtifacts } from "../src/internal/schema-artifacts.js";
import {
  catalogue,
  deterministicHour,
  deterministicProfile,
  ensembleProfile,
  ensembleValue,
  manifest,
  observationManifest,
  runsIndex,
  sitesCatalogue,
} from "./fixtures.js";

describe("profile schema", () => {
  it("accepts the spec's deterministic document", () => {
    expect(parseSiteForecast(deterministicProfile())).not.toBeNull();
  });

  it("accepts ensemble values in every numeric data position", () => {
    const parsed = parseSiteForecast(ensembleProfile());
    expect(parsed).not.toBeNull();
    const temperature = parsed!.hours[0].surface.temperatureC;
    expect(isEnsembleValue(temperature)).toBe(true);
  });

  it("accepts full ensemble dropout — members: 0 with every percentile null", () => {
    const dropout = { members: 0, p10: null, p25: null, p50: null, p75: null, p90: null };
    const profile = ensembleProfile();
    profile.hours[0].surface.capeJkg = dropout as never;
    profile.hours[0].derived.usableLiftTopM = { ...dropout, ceiledMembers: 0 } as never;
    const parsed = parseSiteForecast(profile);
    expect(parsed).not.toBeNull();
    expect(isEnsembleDropout(parsed!.hours[0].surface.capeJkg!)).toBe(true);
    expect(isEnsembleDropout(parsed!.hours[0].surface.temperatureC)).toBe(false);
  });

  it("rejects partial dropout — zero members with numbers, or members with nulls", () => {
    const base = ensembleProfile();
    const zeroWithNumbers = structuredClone(base);
    zeroWithNumbers.hours[0].surface.capeJkg = {
      members: 0,
      p10: 1,
      p25: 2,
      p50: 3,
      p75: 4,
      p90: 5,
    } as never;
    expect(parseSiteForecast(zeroWithNumbers)).toBeNull();

    const membersWithNulls = structuredClone(base);
    membersWithNulls.hours[0].surface.capeJkg = {
      members: 7,
      p10: null,
      p25: null,
      p50: null,
      p75: null,
      p90: null,
    } as never;
    expect(parseSiteForecast(membersWithNulls)).toBeNull();
  });

  it("accepts an ensemble value in a level position", () => {
    const profile = deterministicProfile({
      hours: [
        deterministicHour({
          levels: [
            {
              pressureHpa: 875,
              heightM: ensembleValue({ p50: 1250 }),
              temperatureC: ensembleValue({ p50: 20 }),
              dewPointC: ensembleValue({ p50: 2 }),
              windSpeedMps: ensembleValue({ p50: 3 }),
              windDirectionDeg: ensembleValue({ p50: 245 }),
            },
          ],
        }),
      ],
    });
    expect(parseSiteForecast(profile)).not.toBeNull();
  });

  it("accepts the optional verticalVelocityPaS and ceiledMembers fields", () => {
    const profile = deterministicProfile({
      hours: [
        deterministicHour({
          levels: [
            {
              pressureHpa: 875,
              heightM: 1252.4,
              temperatureC: 25.74,
              dewPointC: 2.17,
              windSpeedMps: 2.99,
              windDirectionDeg: 245,
              verticalVelocityPaS: -0.31,
            },
          ],
          derived: {
            boundaryLayerTopM: ensembleValue({ ceiledMembers: 3 }),
            thermalVelocityMps: 1.63,
            cloudBaseM: 4145.1,
            usableLiftTopM: null,
          },
        }),
      ],
    });
    expect(parseSiteForecast(profile)).not.toBeNull();
  });

  it("accepts null boundary-layer top and usable-lift top", () => {
    const profile = deterministicProfile({
      hours: [
        deterministicHour({
          derived: {
            boundaryLayerTopM: null,
            thermalVelocityMps: 0,
            cloudBaseM: 1500,
            usableLiftTopM: null,
          },
        }),
      ],
    });
    expect(parseSiteForecast(profile)).not.toBeNull();
  });

  it("strips an unknown site key (altitudeM) — the parsed document stays launch-agnostic", () => {
    const extraKey = {
      ...deterministicProfile(),
      site: { ...deterministicProfile().site, altitudeM: 1485 },
    };
    const parsed = parseSiteForecast(extraKey);
    expect(parsed).not.toBeNull();
    expect("altitudeM" in parsed!.site).toBe(false);
    const extraNull = {
      ...deterministicProfile(),
      site: { ...deterministicProfile().site, altitudeM: null },
    };
    expect("altitudeM" in parseSiteForecast(extraNull)!.site).toBe(false);
  });

  it("accepts every optional science-wave surface field — additive, no version bump", () => {
    const hour = deterministicHour();
    const profile = deterministicProfile({
      hours: [
        {
          ...hour,
          surface: {
            ...hour.surface,
            windGustMps: 11.44,
            capeJkg: 851,
            cinJkg: -56,
            pblHeightM: 1650.4,
            lowCloudPercent: 62,
            midCloudPercent: 18,
            highCloudPercent: 4,
          },
        },
      ],
    });
    const parsed = parseSiteForecast(profile);
    expect(parsed).not.toBeNull();
    expect(parsed!.schemaVersion).toBe(2);
    expect(parsed!.hours[0].surface.capeJkg).toBe(851);
  });

  it("accepts a per-level cloud fraction and an ensemble gust", () => {
    const hour = deterministicHour();
    const profile = deterministicProfile({
      hours: [
        {
          ...hour,
          surface: { ...hour.surface, windGustMps: ensembleValue({ p50: 9.4 }) },
          levels: [{ ...hour.levels[0], cloudFractionPercent: 85 }],
        },
      ],
    });
    const parsed = parseSiteForecast(profile);
    expect(parsed).not.toBeNull();
    expect(parsed!.hours[0].levels[0].cloudFractionPercent).toBe(85);
  });

  it("still accepts pre-wave documents that omit every science field", () => {
    expect(parseSiteForecast(deterministicProfile())).not.toBeNull();
  });

  it("carries the optional semantics tag and rejects unknown tokens", () => {
    const tagged = {
      ...deterministicProfile(),
      semantics: { gust: "hourMax", precipitation: "instantRate" },
    };
    const parsed = parseSiteForecast(tagged);
    expect(parsed).not.toBeNull();
    expect(parsed!.semantics).toEqual({ gust: "hourMax", precipitation: "instantRate" });
    expect(
      parseSiteForecast({
        ...deterministicProfile(),
        semantics: { precipitation: "windowMeanRate" },
      }),
    ).not.toBeNull();
    expect(parseSiteForecast(deterministicProfile())).not.toBeNull();
    expect(
      parseSiteForecast({ ...deterministicProfile(), semantics: { gust: "gustingTo" } }),
    ).toBeNull();
    expect(
      parseSiteForecast({
        ...deterministicProfile(),
        semantics: { precipitation: "accumulation" },
      }),
    ).toBeNull();
  });

  it("carries the optional site.timeZone echo and tolerates its absence", () => {
    const echoed = deterministicProfile();
    (echoed.site as { timeZone?: string }).timeZone = "America/Vancouver";
    const parsed = parseSiteForecast(echoed);
    expect(parsed).not.toBeNull();
    expect(parsed!.site.timeZone).toBe("America/Vancouver");
    expect(parseSiteForecast(deterministicProfile())!.site.timeZone).toBeUndefined();
    (echoed.site as { timeZone?: string }).timeZone = "";
    expect(parseSiteForecast(echoed)).toBeNull();
  });

  it("carries run.members on ensemble documents and tolerates its absence", () => {
    const parsed = parseSiteForecast(ensembleProfile());
    expect(parsed).not.toBeNull();
    expect(parsed!.run.members).toBe(21);
    expect(parseSiteForecast(deterministicProfile())!.run.members).toBeUndefined();
    const bad = ensembleProfile();
    (bad.run as { members: unknown }).members = 21.5;
    expect(parseSiteForecast(bad)).toBeNull();
  });

  it("rejects other schema versions", () => {
    expect(parseSiteForecast({ ...deterministicProfile(), schemaVersion: 1 })).toBeNull();
  });

  it("rejects prose model names — identity is the slug", () => {
    expect(
      parseSiteForecast({ ...deterministicProfile(), model: "HRDPS continental 2.5 km" }),
    ).toBeNull();
  });

  it("accepts any well-formed slug — there is no model enum", () => {
    expect(parseSiteForecast({ ...deterministicProfile(), model: "icon-d2-2km" })).not.toBeNull();
  });

  it("rejects a truncated ensemble value", () => {
    const { p50: _dropped, ...partial } = ensembleValue();
    const profile = deterministicProfile({
      hours: [
        deterministicHour({
          surface: { ...deterministicHour().surface, temperatureC: partial as never },
        }),
      ],
    });
    expect(parseSiteForecast(profile)).toBeNull();
  });

  it("rejects timestamps without a Z suffix", () => {
    const profile = deterministicProfile();
    profile.hours[0].validAt = "2026-08-09T00:00:00";
    expect(parseSiteForecast(profile)).toBeNull();
  });

  it("guards the stored-JSON boundary like parseStoredForecast", () => {
    expect(parseSiteForecastJson(JSON.stringify(deterministicProfile()))).not.toBeNull();
    expect(parseSiteForecastJson("not json")).toBeNull();
    expect(parseSiteForecastJson("{}")).toBeNull();
  });
});

describe("manifest schema", () => {
  it("accepts a manifest with transport-specific stats", () => {
    expect(parseForecastManifest(manifest())).not.toBeNull();
  });

  it("accepts the observation-window manifest GOES publishes", () => {
    expect(parseObservationManifest(observationManifest())).not.toBeNull();
    expect(parseManifest(observationManifest())).not.toBeNull();
    expect(parseManifest(manifest())).not.toBeNull();
    expect(parseForecastManifest(observationManifest())).toBeNull();
  });

  it("rejects a manifest carrying neither span — the branches stay disjoint", () => {
    const hybrid: Record<string, unknown> = { ...observationManifest() };
    delete hybrid["firstObservedAt"];
    delete hybrid["lastObservedAt"];
    delete hybrid["observationCount"];
    expect(parseManifest(hybrid)).toBeNull();
  });

  it("types stats as the stable core plus an open numeric extension", () => {
    const parsed = parseForecastManifest(manifest())!;
    expect(parsed.stats.downloads).toBe(1406);
    expect(parsed.stats.downloadBytes).toBe(5190709);
    expect(parsed.stats.retries).toBe(0);
    expect(parsed.stats.durationMs).toBe(129427);
    expect(parsed.stats["geoMetCoverageProbes"]).toBe(12);
    const { downloads: _dropped, ...coreless } = manifest().stats;
    expect(parseForecastManifest({ ...manifest(), stats: coreless })).toBeNull();
    expect(
      parseForecastManifest({ ...manifest(), stats: { ...manifest().stats, note: "fast" } }),
    ).toBeNull();
  });

  it("accepts an ensemble manifest with memberCount", () => {
    expect(parseForecastManifest({ ...manifest(), model: "reps", memberCount: 21 })).not.toBeNull();
  });

  it("rejects a manifest without schemaVersion", () => {
    const { schemaVersion: _dropped, ...unversioned } = manifest();
    expect(parseForecastManifest(unversioned)).toBeNull();
  });

  it("parses from a stored string", () => {
    expect(parseForecastManifestJson(JSON.stringify(manifest()))).not.toBeNull();
    expect(parseForecastManifestJson("[")).toBeNull();
  });
});

describe("models.json schema", () => {
  it("accepts the catalogue", () => {
    const parsed = parseModelCatalogue(catalogue());
    expect(parsed).not.toBeNull();
    expect(parsed!.models.map((model) => model.slug)).toEqual(["hrdps-continental", "reps"]);
  });

  it("rejects an unknown kind", () => {
    const bad = catalogue();
    (bad.models[0] as { kind: string }).kind = "nowcast";
    expect(parseModelCatalogue(bad)).toBeNull();
  });

  it("parses from a stored string", () => {
    expect(parseModelCatalogueJson(JSON.stringify(catalogue()))).not.toBeNull();
  });

  it("types gust as a semantics declaration, not a boolean", () => {
    const bad = catalogue();
    (bad.models[0].capabilities as { gust: unknown }).gust = true;
    expect(parseModelCatalogue(bad)).toBeNull();
    (bad.models[0].capabilities as { gust: unknown }).gust = "hourlyMax";
    expect(parseModelCatalogue(bad)).toBeNull();
    (bad.models[0].capabilities as { gust: unknown }).gust = "instant";
    expect(parseModelCatalogue(bad)).not.toBeNull();
  });

  it("types verticalVelocity as a provenance declaration, not a boolean", () => {
    const bad = catalogue();
    const capabilities = bad.models[0].capabilities as { verticalVelocity: unknown };
    capabilities.verticalVelocity = true;
    expect(parseModelCatalogue(bad)).toBeNull();
    capabilities.verticalVelocity = "w";
    expect(parseModelCatalogue(bad)).toBeNull();
    capabilities.verticalVelocity = "omega";
    expect(parseModelCatalogue(bad)).not.toBeNull();
    capabilities.verticalVelocity = "fromGeometricW";
    expect(parseModelCatalogue(bad)).not.toBeNull();
  });

  it("carries an optional sunset notice with a nullable successor", () => {
    const entry = catalogue();
    const model = entry.models[0] as { sunset?: unknown };
    model.sunset = { date: "2026-10-06", successor: "rrfs" };
    expect(parseModelCatalogue(entry)).not.toBeNull();
    model.sunset = { date: "2026-10-06", successor: null };
    expect(parseModelCatalogue(entry)).not.toBeNull();
    model.sunset = { date: "October 6, 2026", successor: null };
    expect(parseModelCatalogue(entry)).toBeNull();
    model.sunset = { date: "2026-10-06" };
    expect(parseModelCatalogue(entry)).toBeNull();
    delete model.sunset;
    expect(parseModelCatalogue(entry)).not.toBeNull();
  });

  it("requires the run cadence since 0.3.0 — every entry declares it", () => {
    const parsed = parseModelCatalogue(catalogue());
    expect(parsed!.models[0].runIntervalHours).toBe(6);
    const legacy = catalogue();
    delete (legacy.models[0] as { runIntervalHours?: number }).runIntervalHours;
    expect(parseModelCatalogue(legacy)).toBeNull();
  });

  it("requires the publication-lag fact — the catalogue owns the fact, consumers own thresholds", () => {
    const parsed = parseModelCatalogue(catalogue());
    expect(parsed!.models[0].typicalPublicationLagHours).toBe(4.5);
    const legacy = catalogue();
    delete (legacy.models[0] as { typicalPublicationLagHours?: number }).typicalPublicationLagHours;
    expect(parseModelCatalogue(legacy)).toBeNull();
  });

  it("types precipitation as a required semantics declaration", () => {
    const bad = catalogue();
    const capabilities = bad.models[0].capabilities as { precipitation: unknown };
    capabilities.precipitation = "windowMeanRate";
    expect(parseModelCatalogue(bad)).not.toBeNull();
    capabilities.precipitation = "accumulation";
    expect(parseModelCatalogue(bad)).toBeNull();
    capabilities.precipitation = false;
    expect(parseModelCatalogue(bad)).toBeNull();
    delete (bad.models[0].capabilities as { precipitation?: unknown }).precipitation;
    expect(parseModelCatalogue(bad)).toBeNull();
  });

  it("represents CAPE without CIN — the HRDPS family's real shape", () => {
    const parsed = parseModelCatalogue(catalogue());
    const hrdps = parsed!.models.find((model) => model.slug === "hrdps-continental")!;
    expect(hrdps.capabilities.cape).toBe(true);
    expect(hrdps.capabilities.cin).toBe(false);
  });

  it("accepts the repository's actual models.json", () => {
    const raw = readFileSync(join(__dirname, "..", "..", "forecast", "models.json"), "utf-8");
    const parsed = parseModelCatalogueJson(raw);
    expect(parsed).not.toBeNull();
    const reps = parsed!.models.find((model) => model.slug === "reps")!;
    expect(reps.capabilities.gust).toBe(false);
    expect(reps.capabilities.cape).toBe(false);
    const withProfile = parsed!.models.filter((model) => model.capabilities.cloudProfile);
    expect(withProfile.map((model) => model.slug)).toEqual(["gfs"]);
    for (const model of parsed!.models) {
      const levels = model.capabilities.verticalVelocityLevels;
      if (model.capabilities.verticalVelocity) {
        expect(levels, model.slug).toBeDefined();
        expect(levels!.length, model.slug).toBeGreaterThan(0);
        for (const level of levels!) {
          expect(model.capabilities.pressureLevels, model.slug).toContain(level);
        }
      } else {
        expect(levels, model.slug).toBeUndefined();
      }
    }
    for (const slug of ["hrdps-continental", "rdps", "gdps"]) {
      const entry = parsed!.models.find((model) => model.slug === slug)!;
      expect(entry.capabilities.verticalVelocity, slug).toBe("omega");
    }
    const hrdps = parsed!.models.find((model) => model.slug === "hrdps-continental")!;
    expect(hrdps.runIntervalHours).toBe(6);
    const hrrr = parsed!.models.find((model) => model.slug === "hrrr-conus")!;
    expect(hrrr.capabilities.precipitation).toBe("instantRate");
    const gfs = parsed!.models.find((model) => model.slug === "gfs")!;
    expect(gfs.capabilities.precipitation).toBe("windowMeanRate");
    for (const entry of [...parsed!.models, ...(parsed!.smokeModels ?? [])]) {
      expect(entry.typicalPublicationLagHours, entry.slug).toBeGreaterThan(0);
    }
    const rawCatalogue = JSON.parse(raw) as {
      observationModels?: Array<Record<string, unknown>>;
    };
    for (const entry of rawCatalogue.observationModels ?? []) {
      expect(entry, String(entry["slug"])).not.toHaveProperty("typicalPublicationLagHours");
    }
    expect(hrrr.typicalPublicationLagHours).toBe(2.5);
    expect(hrdps.typicalPublicationLagHours).toBe(4.5);
  });
});

describe("sites.json schema", () => {
  it("accepts the identity-only v2 catalogue — humans author WHERE, nothing physical", () => {
    const parsed = parseSitesCatalogue(sitesCatalogue());
    expect(parsed).not.toBeNull();
    expect(parsed!.schemaVersion).toBe(2);
    expect(parsed!.sites.map((site) => site.slug)).toEqual(["dundee", "red-mountain"]);
    expect(Object.keys(parsed!.sites[0]).sort()).toEqual([
      "latitude",
      "longitude",
      "name",
      "slug",
      "timeZone",
    ]);
  });

  it("rejects the pre-0.3.0 bare-array shape — unversioned documents cannot promise theirs", () => {
    expect(parseSitesCatalogue(sitesCatalogue().sites)).toBeNull();
  });

  it("rejects an elevationM-bearing v1 catalogue by its version literal", () => {
    const v1 = {
      schemaVersion: 1,
      sites: sitesCatalogue().sites.map((site) => ({ ...site, elevationM: 1485 })),
    };
    expect(parseSitesCatalogue(v1)).toBeNull();
    const strayed = {
      schemaVersion: 2,
      sites: sitesCatalogue().sites.map((site) => ({ ...site, elevationM: 1485 })),
    };
    const parsed = parseSitesCatalogue(strayed);
    expect(parsed).not.toBeNull();
    expect("elevationM" in parsed!.sites[0]).toBe(false);
  });

  it("rejects prose slugs", () => {
    const bad = sitesCatalogue();
    (bad.sites[0] as { slug: string }).slug = "Red Mountain";
    expect(parseSitesCatalogue(bad)).toBeNull();
  });

  it("requires the IANA timezone — local time is load-bearing for reading a meteogram", () => {
    const parsed = parseSitesCatalogue(sitesCatalogue());
    expect(parsed!.sites[0].timeZone).toBe("America/Vancouver");
    const bad = sitesCatalogue();
    delete (bad.sites[0] as { timeZone?: string }).timeZone;
    expect(parseSitesCatalogue(bad)).toBeNull();
  });

  it("parses from a stored string", () => {
    expect(parseSitesCatalogueJson(JSON.stringify(sitesCatalogue()))).not.toBeNull();
    expect(parseSitesCatalogueJson("[]")).toBeNull();
  });

  it("accepts a real sites.json capture", () => {
    const raw = readFileSync(join(__dirname, "fixtures", "sites.json"), "utf-8");
    expect(parseSitesCatalogueJson(raw)).not.toBeNull();
  });
});

describe("runs.json schema", () => {
  it("accepts the slug-keyed run index", () => {
    const parsed = parseRunsIndex(runsIndex());
    expect(parsed).not.toBeNull();
    expect(parsed!.runs["hrdps-continental"]!.referenceTime).toBe("2026-08-08T00:00:00Z");
    expect(Object.keys(parsed!.runs)).toHaveLength(2);
  });

  it("rejects prose keys and truncated entries", () => {
    const badKey = { schemaVersion: 1, runs: { "HRDPS continental": runsIndex().runs["reps"] } };
    expect(parseRunsIndex(badKey)).toBeNull();
    const truncated = {
      schemaVersion: 1,
      runs: { reps: { referenceTime: "2026-08-08T00:00:00Z" } },
    };
    expect(parseRunsIndex(truncated)).toBeNull();
  });

  it("accepts an empty index — a fresh tree with nothing published yet", () => {
    expect(parseRunsIndex({ schemaVersion: 1, runs: {} })).not.toBeNull();
  });

  it("parses from a stored string", () => {
    expect(parseRunsIndexJson(JSON.stringify(runsIndex()))).not.toBeNull();
    expect(parseRunsIndexJson("not json")).toBeNull();
  });
});

describe("JSON Schema generation", () => {
  const published = [
    siteForecastSchema,
    forecastManifestSchema,
    modelCatalogueSchema,
    sitesCatalogueSchema,
    runsIndexSchema,
  ];

  it("converts every published schema without throwing", () => {
    for (const schema of published) {
      const jsonSchema = z.toJSONSchema(schema, { target: "draft-2020-12" });
      expect(jsonSchema).toHaveProperty("type", "object");
    }
  });

  it("carries the field semantics as descriptions — the non-JS parity promise", () => {
    type JsonSchema = { description?: string; properties?: Record<string, JsonSchema> } & Record<
      string,
      unknown
    >;
    const profile = z.toJSONSchema(siteForecastSchema, {
      target: "draft-2020-12",
      io: "input",
    }) as JsonSchema;
    const hour = (profile.properties!["hours"] as { items: JsonSchema }).items;
    const derived = hour.properties!["derived"]!;
    expect(derived.properties!["cloudBaseM"]!.description).toContain("Bolton");
    expect(derived.properties!["cloudBaseM"]!.description).toContain("boundaryLayerTopM");
    expect(derived.properties!["thermalVelocityMps"]!.description).toContain("Deardorff");
    expect(derived.properties!["boundaryLayerTopM"]!.description).toContain("Null when");
    expect(derived.properties!["usableLiftTopM"]!.description).toContain("1.0 m/s");
    const surface = hour.properties!["surface"]!;
    expect(surface.properties!["windGustMps"]!.description).toContain("semantics.gust");
    expect(surface.properties!["precipitationMmHr"]!.description).toContain(
      "semantics.precipitation",
    );
    expect(surface.properties!["seaLevelPressureHpa"]!.description).toContain("hPa");

    const models = z.toJSONSchema(modelCatalogueSchema, {
      target: "draft-2020-12",
      io: "input",
    }) as JsonSchema;
    const capabilities = (models.properties!["models"] as { items: JsonSchema }).items.properties![
      "capabilities"
    ]!;
    expect(capabilities.properties!["precipitation"]!.description).toContain("windowMeanRate");
    expect(capabilities.properties!["gust"]!.description).toContain("hourMax");

    const sites = z.toJSONSchema(sitesCatalogueSchema, {
      target: "draft-2020-12",
      io: "input",
    }) as JsonSchema;
    const entry = (sites.properties!["sites"] as { items: JsonSchema }).items;
    expect(entry.properties!["elevationM"]).toBeUndefined();
    expect(entry.description).toContain("WHERE");
    expect(sites.description).toContain("verbatim");
    expect(entry.properties!["timeZone"]!.description).toContain("IANA");

    const siteBlock = profile.properties!["site"]!;
    expect(siteBlock.description).toContain("launch-agnostic");
    expect(siteBlock.description).toContain("render time");
    expect(siteBlock.properties!["altitudeM"]).toBeUndefined();
    expect(siteBlock.properties!["modelElevationM"]!.description).toContain("model's own");
  });

  it("matches the shipped schema/*.json artifacts — regenerate with pnpm schemas", () => {
    expect(schemaArtifacts.length).toBeGreaterThan(0);
    for (const artifact of schemaArtifacts) {
      const onDisk = readFileSync(join(__dirname, "..", "schema", artifact.fileName), "utf-8");
      expect(onDisk, artifact.fileName).toBe(renderSchemaArtifact(artifact));
    }
  });
});
