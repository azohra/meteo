import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ScenarioAssertionError,
  ScenarioCheckError,
  ScenarioError,
  applyTransforms,
  buildScenarioArtifacts,
  checkScenarioRepository,
  generateScenario,
  generateScenarioRepository,
  loadScenarioJson,
  prepareSource,
  validateDefinition,
  validateScenarioIndex,
  validateSource,
} from "../src/scenario/index.js";
import {
  SCENARIO_INDEX_SCHEMA_PATH,
  renderScenarioIndexSchema,
} from "../src/internal/schema-artifacts.js";
import { loadJson, ROOT, scenarioRepository, type Doc } from "./helpers/scenarios.js";

const TEACHING_SCENARIOS = [
  "convective-cycle",
  "morning-inversion-erodes",
  "persistent-inversion",
  "cloud-base-limits-lift",
  "shear-through-lift-band",
  "gusts-after-heating",
  "front-arrival",
  "cape-under-cap",
  "missing-versus-zero",
  "three-hourly-sampling",
] as const;

function minimalDefinition(): unknown {
  return loadScenarioJson(join(ROOT, "scenarios", "definitions", "minimal-valid.json"));
}

function minimalBaseline(): unknown {
  return loadScenarioJson(join(ROOT, "scenarios", "baselines", "minimal-hourly-core.source.json"));
}

describe("byte-identity against the committed scenario artifacts", () => {
  it("regenerates every committed generated profile and index.json byte-identically", () => {
    const { artifacts, indexPayload } = buildScenarioArtifacts(ROOT);
    const generatedDir = join(ROOT, "scenarios", "generated");
    const committedNames = readdirSync(generatedDir)
      .filter((name) => name.endsWith(".profile.json"))
      .sort();
    expect([...artifacts.keys()].sort()).toEqual(committedNames);

    const compare = (label: string, committed: Buffer, produced: Buffer) => {
      if (committed.equals(produced)) {
        return;
      }
      const a = committed.toString("utf-8");
      const b = produced.toString("utf-8");
      let index = 0;
      while (index < Math.min(a.length, b.length) && a[index] === b[index]) {
        index += 1;
      }
      throw new Error(
        `${label} differs at byte ${index}:\n` +
          `  committed: ${JSON.stringify(a.slice(Math.max(0, index - 80), index + 40))}\n` +
          `  produced:  ${JSON.stringify(b.slice(Math.max(0, index - 80), index + 40))}`,
      );
    };

    for (const name of committedNames) {
      compare(name, readFileSync(join(generatedDir, name)), artifacts.get(name)!);
    }
    compare("index.json", readFileSync(join(ROOT, "scenarios", "index.json")), indexPayload);
  });

  it("checkScenarioRepository passes against the committed tree", () => {
    checkScenarioRepository({ repositoryRoot: ROOT });
  });

  it("re-serializes every committed artifact byte-identically (parser + dumper)", () => {
    const generatedDir = join(ROOT, "scenarios", "generated");
    const files = readdirSync(generatedDir)
      .filter((name) => name.endsWith(".profile.json"))
      .map((name) => join(generatedDir, name));
    files.push(join(ROOT, "scenarios", "index.json"));
    for (const file of files) {
      const original = readFileSync(file, "utf-8");
      expect(JSON.stringify(JSON.parse(original), null, 2) + "\n").toBe(original);
    }
  });
});

describe("validateDefinition", () => {
  it("accepts the committed minimal fixture", () => {
    validateDefinition(minimalDefinition(), { repositoryRoot: ROOT });
  });

  it.each([
    "missing-lesson.json",
    "unknown-transform.json",
    "invalid-clock.json",
    "direct-derived-authorship.json",
  ])("rejects the invalid fixture %s", (fixture) => {
    const definition = loadScenarioJson(join(ROOT, "scenarios", "definitions", "invalid", fixture));
    expect(() => validateDefinition(definition, { repositoryRoot: ROOT, source: fixture })).toThrow(
      /is invalid/,
    );
  });

  it("rejects duplicate schedule hours and inverted altitude bands", () => {
    const definition = minimalDefinition() as Doc;
    definition.transforms = [
      {
        type: "temperature-offset",
        altitudeBandM: { bottomM: 2000, topM: 1000 },
        offsetC: {
          byHour: [
            { hourOffset: 0, value: 1 },
            { hourOffset: 0, value: 2 },
          ],
        },
      },
    ];
    expect(() => validateDefinition(definition, { repositoryRoot: ROOT })).toThrow(
      /topM must be greater/,
    );

    definition.transforms[0].altitudeBandM = { bottomM: 1000, topM: 2000 };
    expect(() => validateDefinition(definition, { repositoryRoot: ROOT })).toThrow(
      /duplicate hour offsets/,
    );
  });

  it("rejects a production model slug as a scenario identity", () => {
    const definition = minimalDefinition() as Doc;
    definition.id = "gfs";
    expect(() => validateDefinition(definition, { repositoryRoot: ROOT })).toThrow(
      /production model slug/,
    );
  });

  it("requires gust transport semantics to match the declared capability", () => {
    const definition = minimalDefinition() as Doc;
    definition.modelShape = "three-hourly-regional";
    definition.clock.stepHours = 3;
    definition.capabilities.gust = "instant";
    definition.semantics.gust = "hourMax";
    expect(() => validateDefinition(definition, { repositoryRoot: ROOT })).toThrow(
      /semantics\.gust must exactly match/,
    );
  });
});

describe("source transforms", () => {
  it("applies every deterministic transform explicitly and repeatably", () => {
    const definition = minimalDefinition() as Doc;
    definition.transforms = [
      {
        type: "surface-field-curve",
        field: "temperatureC",
        points: [
          { hourOffset: 0, value: 10 },
          { hourOffset: 1, value: 14 },
        ],
      },
      {
        type: "temperature-offset",
        altitudeBandM: { bottomM: 1000, topM: 1700 },
        offsetC: {
          byHour: [
            { hourOffset: 0, value: 1 },
            { hourOffset: 1, value: 3 },
          ],
        },
      },
      {
        type: "dew-point-depression-offset",
        altitudeBandM: { bottomM: 1000, topM: 1200 },
        offsetC: -1,
      },
      {
        type: "wind-speed-scale",
        altitudeBandM: { bottomM: 800, topM: 1700 },
        factor: 2,
        includeSurface: true,
      },
      {
        type: "wind-direction-rotate",
        altitudeBandM: { bottomM: 800, topM: 1200 },
        degrees: 150,
        includeSurface: true,
      },
      { type: "pressure-tendency", hpaPerHour: -0.1 },
      {
        type: "capability-field",
        field: "surface.windGustMps",
        action: "add",
        value: {
          byHour: [
            { hourOffset: 0, value: 8 },
            { hourOffset: 1, value: 10 },
          ],
        },
      },
      {
        type: "capability-field",
        field: "surface.windGustMps",
        action: "omit",
        atHours: [1],
      },
      { type: "time-shift", hours: 3 },
      { type: "elevation-adjustment", modelElevationDeltaM: 50 },
    ];
    validateDefinition(definition, { repositoryRoot: ROOT });
    const first = prepareSource(definition, minimalBaseline());
    const second = prepareSource(definition, minimalBaseline());

    applyTransforms(definition, first);
    applyTransforms(definition, second);

    const firstPlain = first as Doc;
    expect(firstPlain).toEqual(second);
    expect(firstPlain.referenceTime).toBe("2000-01-01T09:00:00Z");
    expect(firstPlain.hours[0].validAt).toBe("2000-01-01T15:00:00Z");
    expect("siteAltitudeM" in firstPlain).toBe(false);
    expect(firstPlain.modelElevationM).toBe(950);
    expect(firstPlain.hours.map((hour: Doc) => hour.temperatureC)).toEqual([10, 14]);
    expect(firstPlain.hours[0].levels[0].temperatureC).toBe(9);
    expect(firstPlain.hours[1].levels[1].temperatureC).toBe(7);
    expect(firstPlain.hours[0].levels[0].dewPointDepressionC).toBe(4);
    expect(firstPlain.hours[0].windSpeedMps).toBe(6);
    expect(firstPlain.hours[0].levels[1].windSpeedMps).toBe(12);
    expect(firstPlain.hours[0].windDirectionDeg).toBe(390);
    expect(firstPlain.hours[0].levels[0].windDirectionDeg).toBe(395);
    expect(firstPlain.hours[1].seaLevelPressureHpa).toBeCloseTo(899.7, 9);
    expect(firstPlain.hours[0].windGustMps).toBe(8);
    expect("windGustMps" in firstPlain.hours[1]).toBe(false);
  });
});

describe("validateSource", () => {
  it.each<[string, (source: Doc) => void]>([
    [
      "chronological",
      (source: Doc) => {
        source.hours[1].validAt = source.hours[0].validAt;
      },
    ],
    [
      "non-negative",
      (source: Doc) => {
        source.hours[0].windSpeedMps = -1;
      },
    ],
    [
      "dew point exceeds",
      (source: Doc) => {
        source.hours[0].dewPointDepressionC = -1;
      },
    ],
    [
      "pressure must strictly decrease",
      (source: Doc) => {
        source.hours[0].levels[1].pressureHpa = 950;
      },
    ],
  ])("raises an actionable error matching %s", (message, mutate) => {
    const definition = minimalDefinition();
    const source = prepareSource(definition, minimalBaseline()) as Doc;
    mutate(source);
    expect(() => validateSource(definition, source)).toThrow(new RegExp(message));
  });

  it("requires an explicit exception for controlled supersaturation", () => {
    const definition = minimalDefinition() as Doc;
    const source = prepareSource(definition, minimalBaseline()) as Doc;
    source.hours[0].dewPointDepressionC = -0.25;

    expect(() => validateSource(definition, source)).toThrow(/controlled-supersaturation/);

    definition.physicalExceptions = [
      {
        type: "controlled-supersaturation",
        reason: "Exercise noisy source values without permitting accidental supersaturation.",
      },
    ];
    validateDefinition(definition, { repositoryRoot: ROOT });
    validateSource(definition, source);
  });

  it("requires capability declarations to match the transformed source", () => {
    const definition = minimalDefinition() as Doc;
    definition.capabilities.gust = "instant";
    const source = prepareSource(definition, minimalBaseline()) as Doc;
    expect(() => validateSource(definition, source)).toThrow(/windGustMps presence/);
  });
});

describe("baseline discipline", () => {
  it("rejects baselines that author derived values", () => {
    const repository = scenarioRepository();
    const baselinePath = join(
      repository,
      "scenarios",
      "baselines",
      "minimal-hourly-core.source.json",
    );
    const baseline = loadJson(baselinePath);
    baseline.hours[0].derived = { thermalVelocityMps: 99 };
    writeFileSync(baselinePath, JSON.stringify(baseline));

    expect(() => generateScenario(minimalDefinition(), { repositoryRoot: repository })).toThrow(
      /authors derived values/,
    );
  });

  it("rejects baselines that carry a baked launch altitude, naming the launch block", () => {
    const repository = scenarioRepository();
    const baselinePath = join(
      repository,
      "scenarios",
      "baselines",
      "minimal-hourly-core.source.json",
    );
    const baseline = loadJson(baselinePath);
    baseline.siteAltitudeM = 1050;
    writeFileSync(baselinePath, JSON.stringify(baseline));

    let message = "";
    try {
      generateScenario(minimalDefinition(), { repositoryRoot: repository });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/launch block/);
    expect(message).toContain("siteAltitudeM");
  });
});

describe("scenario generation", () => {
  it("names scenario, hour, field, relation and actual in assertion failures", () => {
    const definition = minimalDefinition() as Doc;
    definition.assertions[0] = {
      id: "impossible-temperature",
      description: "The second hour must exceed an intentionally impossible temperature.",
      actual: { field: "surface.temperatureC", hour: 1 },
      operator: "greater-than",
      expected: 100,
    };

    let message = "";
    try {
      generateScenario(definition, { repositoryRoot: ROOT });
    } catch (error) {
      expect(error).toBeInstanceOf(ScenarioAssertionError);
      message = (error as Error).message;
    }
    expect(message).toContain("scenario minimal-valid");
    expect(message).toContain("hour 1");
    expect(message).toContain("surface.temperatureC");
    expect(message).toContain("greater-than 100");
    expect(message).toContain("actual 12");
  });

  it("uses the authoritative derivation, rounding and declared semantics", () => {
    const definition = minimalDefinition() as Doc;
    const profile = generateScenario(definition, { repositoryRoot: ROOT }) as Doc;

    expect(profile.hours.map((hour: Doc) => hour.surface.temperatureC)).toEqual([10, 12]);
    expect(profile.hours[1].derived.thermalVelocityMps).toBe(1.44);
    expect(profile.hours[1].surface.windDirectionDeg).toBe(240);
    expect(profile.semantics).toEqual(definition.semantics);
    expect(profile.site.timeZone).toBe(definition.timeZone);
    expect(profile.model).toBe("minimal-valid");
  });

  it("is byte-deterministic and hashes the output into the index", () => {
    const repository = scenarioRepository();

    generateScenarioRepository({ repositoryRoot: repository });
    const output = join(repository, "scenarios", "generated", "minimal-valid.profile.json");
    const indexPath = join(repository, "scenarios", "index.json");
    const firstOutput = readFileSync(output);
    const firstIndex = readFileSync(indexPath);
    generateScenarioRepository({ repositoryRoot: repository });

    expect(readFileSync(output).equals(firstOutput)).toBe(true);
    expect(readFileSync(indexPath).equals(firstIndex)).toBe(true);
    const index = loadJson(indexPath);
    const minimalEntry = index.scenarios.find((entry: Doc) => entry.id === "minimal-valid");
    expect(minimalEntry.outputs).toEqual([
      {
        path: "generated/minimal-valid.profile.json",
        sha256: createHash("sha256").update(firstOutput).digest("hex"),
      },
    ]);
    // The launch lives in the index entry (render input), never in the
    // generated document: its site block is sample provenance only.
    expect(minimalEntry.launch).toEqual({ elevationM: 1050 });
    const profile = JSON.parse(firstOutput.toString("utf-8")) as Doc;
    expect(new Set(Object.keys(profile.site))).toEqual(
      new Set(["id", "name", "latitude", "longitude", "modelElevationM", "timeZone"]),
    );
    checkScenarioRepository({ repositoryRoot: repository });
  });

  it("generates to a separate output directory without touching the source tree", () => {
    const repository = scenarioRepository();
    const outputDir = mkdtempSync(join(tmpdir(), "scenario-out-"));
    const committedBytes = readFileSync(
      join(repository, "scenarios", "generated", "minimal-valid.profile.json"),
    );

    generateScenarioRepository({ repositoryRoot: repository, outputDir });

    expect(
      readFileSync(join(outputDir, "generated", "minimal-valid.profile.json")).equals(
        committedBytes,
      ),
    ).toBe(true);
    expect(
      readFileSync(join(outputDir, "index.json")).equals(
        readFileSync(join(repository, "scenarios", "index.json")),
      ),
    ).toBe(true);
  });

  it("check detects stale, missing and unmanaged generated files", () => {
    const repository = scenarioRepository();
    generateScenarioRepository({ repositoryRoot: repository });
    const output = join(repository, "scenarios", "generated", "minimal-valid.profile.json");
    writeFileSync(output, "{}\n");
    writeFileSync(join(repository, "scenarios", "generated", "old.profile.json"), "{}\n");

    let message = "";
    try {
      checkScenarioRepository({ repositoryRoot: repository });
    } catch (error) {
      expect(error).toBeInstanceOf(ScenarioCheckError);
      message = (error as Error).message;
    }
    expect(message).toContain("stale scenarios/generated/minimal-valid.profile.json");
    expect(message).toContain("unmanaged scenarios/generated/old.profile.json");
    expect(message).toContain("pnpm scenarios:generate");

    generateScenarioRepository({ repositoryRoot: repository });
    expect(
      readdirSync(join(repository, "scenarios", "generated")).includes("old.profile.json"),
    ).toBe(false);
    checkScenarioRepository({ repositoryRoot: repository });
  });

  it("directs comparison recipes to multi-output generation", () => {
    const definition = minimalDefinition() as Doc;
    definition.kind = "comparison";
    definition.comparison = {
      variants: [
        { id: "early", title: "Earlier development" },
        { id: "late", title: "Later development" },
      ],
    };
    expect(() => generateScenario(definition, { repositoryRoot: ROOT })).toThrow(
      /use generateScenarioRepository\(\)/,
    );
  });

  // Artifact freshness lives with the byte-identity gate above, which
  // regenerates every committed profile; these hold only the definitions.
  it.each(TEACHING_SCENARIOS)(
    "teaching scenario %s carries three assertions and declared precipitation semantics",
    (scenarioId) => {
      const definition = loadScenarioJson(
        join(ROOT, "scenarios", "definitions", `${scenarioId}.json`),
      ) as Doc;

      expect(definition.assertions.length).toBeGreaterThanOrEqual(3);
      expect(["instantRate", "windowMeanRate"]).toContain(
        (definition.semantics as Doc).precipitation,
      );
    },
  );
});

describe("scenario index contract validation", () => {
  it("emits scenarios/index.schema.json byte-identically — regenerate with pnpm schemas", () => {
    const onDisk = readFileSync(join(ROOT, SCENARIO_INDEX_SCHEMA_PATH), "utf-8");
    expect(onDisk).toBe(renderScenarioIndexSchema());
  });

  it("accepts the committed index and rejects a shape-invalid one with Python's envelope", () => {
    validateScenarioIndex(
      loadJson(join(ROOT, "scenarios", "index.json")),
      "committed scenarios/index.json",
    );

    // The freshly built {"schemaVersion": 1, "scenarios": entries} document
    // is validated as "generated scenario index" before its bytes exist.
    // Producing an invalid index through the real build would require a
    // definition that already fails scenario.schema.json, so the function
    // is exercised directly with the same source label the build-time call
    // site passes.
    let message = "";
    try {
      validateScenarioIndex(
        { schemaVersion: 2, scenarios: [{ id: "not enough fields" }] },
        "generated scenario index",
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ScenarioError);
      expect(error).not.toBeInstanceOf(ScenarioCheckError);
      message = (error as Error).message;
    }
    expect(message).toMatch(
      /^generated scenario index does not satisfy the scenario-index contract:\n {2}/,
    );
    expect(message).toContain("/schemaVersion");
    expect(message).toContain("/scenarios/0");
  });

  it("check gives a hand-edited committed index a shape verdict before the byte comparison", () => {
    const repository = scenarioRepository();
    generateScenarioRepository({ repositoryRoot: repository });
    const indexPath = join(repository, "scenarios", "index.json");
    const index = loadJson(indexPath);
    // A hand edit that breaks the published shape: byte comparison alone
    // would only call this "stale" — the schema names the actual problem.
    index.schemaVersion = 2;
    writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");

    let message = "";
    try {
      checkScenarioRepository({ repositoryRoot: repository });
    } catch (error) {
      expect(error).toBeInstanceOf(ScenarioError);
      expect(error).not.toBeInstanceOf(ScenarioCheckError);
      message = (error as Error).message;
    }
    expect(message).toMatch(
      /^committed scenarios\/index\.json does not satisfy the scenario-index contract:\n {2}/,
    );
    expect(message).toContain("/schemaVersion");
  });
});

describe("teaching lessons are visible in the committed artifacts", () => {
  it("convective and inversion lessons are visible in derived values", () => {
    const cycle = loadJson(join(ROOT, "scenarios", "generated", "convective-cycle.profile.json"));
    const eroding = loadJson(
      join(ROOT, "scenarios", "generated", "morning-inversion-erodes.profile.json"),
    );
    const persistent = loadJson(
      join(ROOT, "scenarios", "generated", "persistent-inversion.profile.json"),
    );

    expect(cycle.hours[5].surface.sensibleHeatFluxWm2).toBeGreaterThan(
      cycle.hours[0].surface.sensibleHeatFluxWm2,
    );
    expect(cycle.hours[5].derived.boundaryLayerTopM).toBeGreaterThan(
      cycle.hours[0].derived.boundaryLayerTopM,
    );
    expect(cycle.hours[5].derived.boundaryLayerTopM).toBeGreaterThan(
      cycle.hours[4].derived.boundaryLayerTopM,
    );
    expect(cycle.hours[5].derived.boundaryLayerTopM).toBeGreaterThan(
      cycle.hours[6].derived.boundaryLayerTopM,
    );
    expect(cycle.hours[5].derived.usableLiftTopM).toBeGreaterThan(
      cycle.hours[6].derived.usableLiftTopM,
    );
    expect(cycle.hours.map((hour: Doc) => hour.derived.usableLiftTopM === null)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
    const cloudBases = cycle.hours.slice(0, 6).map((hour: Doc) => hour.derived.cloudBaseM);
    expect(cloudBases).toEqual([...cloudBases].sort((a, b) => a - b));
    expect(cycle.hours[5].derived.cloudBaseM).toBeGreaterThan(
      cycle.hours[5].derived.usableLiftTopM,
    );
    expect(cycle.hours[5].derived.usableLiftTopM).toBeGreaterThan(
      cycle.hours[5].derived.boundaryLayerTopM,
    );

    for (const index of [0, 9]) {
      const hour = cycle.hours[index];
      expect(hour.levels[0].temperatureC).toBeGreaterThan(hour.surface.temperatureC);
    }

    const firstSubfreezingHeights = cycle.hours.map(
      (hour: Doc) => hour.levels.find((level: Doc) => level.temperatureC <= 0)!.heightM,
    );
    expect(firstSubfreezingHeights[5]).toBeGreaterThan(firstSubfreezingHeights[0]);

    // Fair weather: the column strengthens and veers only gently with height —
    // enough to read the barbs, nowhere near the shear-through-lift-band lesson.
    const peak = cycle.hours[5];
    const peakTop = peak.levels[peak.levels.length - 1];
    expect(peakTop.windSpeedMps - peak.surface.windSpeedMps).toBeGreaterThan(2);
    expect(peakTop.windSpeedMps - peak.surface.windSpeedMps).toBeLessThanOrEqual(4.5);
    const peakVeer = Math.abs(peakTop.windDirectionDeg - peak.surface.windDirectionDeg);
    expect(peakVeer).toBeGreaterThanOrEqual(30);
    expect(peakVeer).toBeLessThanOrEqual(70);
    // The pilot's ceilings: light launch-height wind and soarable gusts through
    // the flying window, and gentle wind at the top of the lift band.
    for (const hour of cycle.hours.slice(2, 8)) {
      expect(hour.levels[0].windSpeedMps).toBeLessThanOrEqual(4.2);
      expect(hour.surface.windGustMps).toBeLessThanOrEqual(6.4);
    }
    const liftBandTopWind = peak.levels.find((level: Doc) => level.pressureHpa === 700)!;
    expect(liftBandTopWind.windSpeedMps).toBeLessThanOrEqual(6.9);
    expect(peak.derived.usableLiftTopM).toBeGreaterThanOrEqual(2800);
    expect(peak.derived.usableLiftTopM).toBeLessThanOrEqual(3300);
    expect(cycle.hours.map((hour: Doc) => hour.surface.capeJkg)).toEqual([
      0, 0, 0, 60, 320, 780, 440, 80, 20, 0,
    ]);
    expect(cycle.hours.map((hour: Doc) => hour.surface.cinJkg)).toEqual([
      -180, -160, -140, -90, -35, -5, -20, -70, -110, -160,
    ]);
    // The launch each lesson teaches against is index metadata (documents
    // are launch-agnostic), so the published lesson reads from the index.
    const launches = Object.fromEntries(
      loadJson(join(ROOT, "scenarios", "index.json")).scenarios.map((entry: Doc) => [
        entry.id,
        entry.launch.elevationM,
      ]),
    );
    expect(eroding.hours[0].derived.boundaryLayerTopM).toBeLessThan(
      launches["morning-inversion-erodes"],
    );
    expect(eroding.hours[4].derived.boundaryLayerTopM).toBeGreaterThan(
      launches["morning-inversion-erodes"],
    );
    expect(persistent.hours[4].surface.sensibleHeatFluxWm2).toBeGreaterThanOrEqual(300);
    expect(persistent.hours[4].derived.boundaryLayerTopM).toBeLessThan(
      launches["persistent-inversion"],
    );
  });

  it("cloud, shear and gust lessons are visible in profile values", () => {
    const cloud = loadJson(
      join(ROOT, "scenarios", "generated", "cloud-base-limits-lift.profile.json"),
    );
    const shear = loadJson(
      join(ROOT, "scenarios", "generated", "shear-through-lift-band.profile.json"),
    );
    const gusts = loadJson(
      join(ROOT, "scenarios", "generated", "gusts-after-heating.profile.json"),
    );

    const cloudyHour = cloud.hours[3];
    expect(cloudyHour.derived.boundaryLayerTopM).toBeGreaterThan(cloudyHour.derived.cloudBaseM);
    expect(cloudyHour.derived.usableLiftTopM).toBe(cloudyHour.derived.cloudBaseM);

    const shearHour = shear.hours[3];
    const upper = shearHour.levels.find((level: Doc) => level.pressureHpa === 700)!;
    expect(shearHour.derived.usableLiftTopM).toBeGreaterThan(upper.heightM);
    expect(upper.windSpeedMps - shearHour.surface.windSpeedMps).toBeGreaterThanOrEqual(10);
    expect(
      Math.abs(upper.windDirectionDeg - shearHour.surface.windDirectionDeg),
    ).toBeGreaterThanOrEqual(80);

    expect(gusts.hours[6].derived.thermalVelocityMps).toBeLessThan(
      gusts.hours[2].derived.thermalVelocityMps,
    );
    expect(gusts.hours[6].surface.windGustMps).toBeGreaterThanOrEqual(8);
  });

  it("front, CAPE and missing-value lessons are visible", () => {
    const front = loadJson(join(ROOT, "scenarios", "generated", "front-arrival.profile.json"));
    const cape = loadJson(join(ROOT, "scenarios", "generated", "cape-under-cap.profile.json"));
    const missing = loadJson(
      join(ROOT, "scenarios", "generated", "missing-versus-zero.profile.json"),
    );

    expect(front.hours[3].surface.seaLevelPressureHpa).toBeLessThan(
      front.hours[0].surface.seaLevelPressureHpa,
    );
    expect(front.hours[6].surface.cloudCoverPercent).toBeGreaterThan(
      front.hours[2].surface.cloudCoverPercent,
    );
    expect(front.hours[7].surface.windSpeedMps).toBeGreaterThan(
      front.hours[3].surface.windSpeedMps,
    );
    expect(front.hours[4].surface.precipitationMmHr).toBe(0);
    expect(front.hours[8].surface.precipitationMmHr).toBeGreaterThan(0);

    expect(cape.hours[4].surface.capeJkg).toBeGreaterThan(cape.hours[0].surface.capeJkg);
    expect(cape.hours[4].surface.cinJkg).toBeLessThanOrEqual(-100);
    expect(cape.hours[6].surface.cinJkg).toBeGreaterThan(cape.hours[4].surface.cinJkg);

    const drySurface = missing.hours[2].surface;
    expect("windGustMps" in drySurface).toBe(false);
    expect("precipitationMmHr" in drySurface).toBe(true);
    expect(drySurface.precipitationMmHr).toBe(0);
  });

  it("the three-hourly profile has only source-cadence samples", () => {
    const profile = loadJson(
      join(ROOT, "scenarios", "generated", "three-hourly-sampling.profile.json"),
    );
    const instants = profile.hours.map((hour: Doc) =>
      Date.parse(hour.validAt.replace("Z", "+00:00")),
    );

    expect(instants.length).toBe(6);
    for (let index = 1; index < instants.length; index += 1) {
      expect(instants[index] - instants[index - 1]).toBe(3 * 60 * 60 * 1000);
    }
  });
});

describe("loadScenarioJson", () => {
  it("rejects non-finite JSON constants, naming the file that carries one", () => {
    const repository = scenarioRepository();
    const path = join(repository, "scenarios", "baselines", "minimal-hourly-core.source.json");
    const baseline = loadJson(path);
    baseline.hours[0].temperatureC = "__NAN__";
    writeFileSync(path, JSON.stringify(baseline).replace('"__NAN__"', "NaN"));
    let thrown: unknown;
    try {
      loadScenarioJson(path);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ScenarioError);
    expect((thrown as Error).message).toContain(path);
  });

  it("wraps malformed JSON with the file path", () => {
    const repository = scenarioRepository();
    const path = join(repository, "scenarios", "baselines", "broken.source.json");
    writeFileSync(path, "{not json");
    expect(() => loadScenarioJson(path)).toThrow(/invalid JSON in/);
  });
});
