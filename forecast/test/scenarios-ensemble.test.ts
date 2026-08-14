import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { deriveSiteForecast, type SourceProfile } from "../src/derive.js";
import { circularMedian } from "../src/ensemble.js";
import { roundContract } from "../src/publish.js";
import { cloneTagged, untag, type TaggedValue } from "../src/scenario/json.js";
import {
  ScenarioAssertionError,
  ScenarioCheckError,
  ScenarioError,
  applyMemberPerturbations,
  applyTransforms,
  checkScenarioRepository,
  evaluateAssertions,
  generateScenario,
  generateScenarioRepository,
  loadBaseline,
  loadScenarioJson,
  prepareSource,
  resolveMetric,
  scenarioPercentileBlocks,
  validateDefinition,
  validateSource,
} from "../src/scenario/index.js";

import { loadJson, ROOT, scenarioRepository, type Doc } from "./helpers/scenarios.js";

const ENSEMBLE_IDS = ["ensemble-tight", "ensemble-wide", "ensemble-column-censored"] as const;
const PERCENTILE_KEYS = ["p10", "p25", "p50", "p75", "p90"] as const;

function definition(scenarioId: string): TaggedValue {
  return loadScenarioJson(join(ROOT, "scenarios", "definitions", `${scenarioId}.json`));
}

function generated(scenarioId: string): Doc {
  return loadJson(join(ROOT, "scenarios", "generated", `${scenarioId}.profile.json`));
}

function memberProfiles(scenarioDefinition: TaggedValue): Doc[] {
  const def = scenarioDefinition as Doc;
  const baseline = loadBaseline(scenarioDefinition, ROOT);
  const source = prepareSource(scenarioDefinition, baseline);
  applyTransforms(scenarioDefinition, source);
  const members: Doc[] = [];
  const memberCount = untag(def.ensemble.members) as number;
  for (let memberIndex = 0; memberIndex < memberCount; memberIndex += 1) {
    const memberSource = cloneTagged(source) as Doc;
    applyMemberPerturbations(scenarioDefinition, memberSource, memberIndex);
    validateSource(scenarioDefinition, memberSource);
    members.push(
      deriveSiteForecast(
        untag(memberSource) as unknown as SourceProfile,
        untag(def.id) as string,
        untag(def.semantics) as Doc as never,
      ) as unknown as Doc,
    );
  }
  return members;
}

function blocksOf(value: unknown): Array<[string, Doc]> {
  return [...scenarioPercentileBlocks(value)] as Array<[string, Doc]>;
}

describe("deterministic seeded ensemble perturbation", () => {
  it("derives each member independently and matches the committed aggregate", () => {
    const recipe = definition("ensemble-tight");
    const profile = generateScenario(recipe, { repositoryRoot: ROOT }) as Doc;

    expect(profile).toEqual(generated("ensemble-tight"));
    expect(profile.run.members).toBe((untag(recipe) as Doc).ensemble.members);
    expect(profile.semantics).toEqual((untag(recipe) as Doc).semantics);
  });

  it("member sources repeat for the declared seed and change with the seed", () => {
    const recipe = definition("ensemble-wide");

    const first = memberProfiles(recipe);
    const second = memberProfiles(recipe);
    const changed = cloneTagged(recipe) as Doc;
    changed.clock.seed = (untag(changed.clock.seed) as number) + 1;
    const third = memberProfiles(changed);

    expect(first).toEqual(second);
    expect(first).not.toEqual(third);
  });

  it("perturbed member sources actually differ from each other", () => {
    const recipe = definition("ensemble-tight");
    const members = memberProfiles(recipe);
    const rendered = new Set(members.map((member) => JSON.stringify(member)));
    expect(rendered.size).toBeGreaterThan(1);
  });

  it("conditional derived members are a valid subset of the ensemble", () => {
    const recipe = definition("ensemble-tight") as Doc;
    const heatFlux = recipe.ensemble.perturbations[2];
    Object.assign(heatFlux, {
      distribution: "symmetric",
      spread: 250,
      correlation: "whole-column",
    });

    const profile = generateScenario(recipe, { repositoryRoot: ROOT }) as Doc;
    const memberCount = untag(recipe.ensemble.members) as number;
    const conditionalCounts = profile.hours.map((hour: Doc) => hour.derived.usableLiftTopM.members);

    expect(conditionalCounts.every((count: number) => 0 < count && count <= memberCount)).toBe(
      true,
    );
    expect(conditionalCounts.some((count: number) => count < memberCount)).toBe(true);
    for (const [path, block] of blocksOf(profile.hours)) {
      if (!path.includes("derived.usableLiftTopM")) {
        expect(block.members, path).toBe(memberCount);
      }
    }
  });
});

describe("committed ensemble artifacts", () => {
  it.each(ENSEMBLE_IDS)(
    "%s holds percentile order and member count at every numeric position",
    (scenarioId) => {
      const recipe = untag(definition(scenarioId)) as Doc;
      const blocks = blocksOf(generated(scenarioId).hours);

      expect(blocks.length).toBeGreaterThan(0);
      for (const [path, block] of blocks) {
        expect(block.members, path).toBe(recipe.ensemble.members);
        const values = PERCENTILE_KEYS.map((key) => block[key]);
        expect(values, path).toEqual([...values].sort((a, b) => a - b));
        expect(block.ceiledMembers ?? 0, path).toBeLessThanOrEqual(block.members);
      }
    },
  );

  it("only the controlled column scenario contains censored members", () => {
    const uncensored = Object.fromEntries(
      (["ensemble-tight", "ensemble-wide"] as const).map((scenarioId) => [
        scenarioId,
        blocksOf(generated(scenarioId).hours).filter(([, block]) => block.ceiledMembers),
      ]),
    );
    const censored = blocksOf(generated("ensemble-column-censored").hours).filter(
      ([, block]) => block.ceiledMembers,
    );

    expect(uncensored["ensemble-tight"]).toEqual([]);
    expect(uncensored["ensemble-wide"]).toEqual([]);
    expect(censored.length).toBeGreaterThan(0);
    expect(censored.every(([path]) => path.includes("derived.boundaryLayerTopM"))).toBe(true);
    expect(censored.every(([, block]) => block.ceiledMembers === 9)).toBe(true);
  });

  it("tight and wide scenarios teach materially different spread", () => {
    const tight = generated("ensemble-tight").hours[2].surface.temperatureC;
    const wide = generated("ensemble-wide").hours[2].surface.temperatureC;

    const tightWidth = tight.p90 - tight.p10;
    const wideWidth = wide.p90 - wide.p10;

    expect(tightWidth).toBeLessThan(1);
    expect(wideWidth).toBeGreaterThan(4);
    expect(wideWidth).toBeGreaterThan(tightWidth * 5);
  });

  it("wind direction uses the production circular median across north", () => {
    const recipe = definition("ensemble-tight");
    const members = memberProfiles(recipe);
    const memberDirections = members.map(
      (member) => member.hours[0].surface.windDirectionDeg as number,
    );
    const published = generated("ensemble-tight").hours[0].surface.windDirectionDeg;

    expect(Math.min(...memberDirections)).toBeLessThan(10);
    expect(Math.max(...memberDirections)).toBeGreaterThan(340);
    const wrap = (value: number) => ((value % 360) + 360) % 360;
    expect(published).toBe(wrap(roundContract(circularMedian(memberDirections), 0)));
    const ordinaryMedian = [...memberDirections].sort((a, b) => a - b)[
      (memberDirections.length - 1) / 2
    ];
    expect(published).not.toBe(wrap(roundContract(ordinaryMedian, 0)));
  });
});

function evaluateEnsembleAssertion(profile: Doc, assertion: Doc): void {
  evaluateAssertions(
    { id: "test-percentile-paths", kind: "ensemble", assertions: [assertion] },
    profile,
  );
}

describe("percentile-path metric references", () => {
  it("resolves numeric positions and member counts", () => {
    const profile = generated("ensemble-wide");

    evaluateEnsembleAssertion(profile, {
      id: "band-is-wide",
      actual: { field: "surface.temperatureC.p90", hour: 2 },
      operator: "absolute-difference-at-least",
      expected: { field: "surface.temperatureC.p10", hour: 2 },
      threshold: 4,
    });
    evaluateEnsembleAssertion(profile, {
      id: "median-lift-is-above-terrain",
      actual: { field: "derived.usableLiftTopM.p50", hour: 2 },
      operator: "greater-than",
      expected: 900,
    });
    evaluateEnsembleAssertion(profile, {
      id: "member-count",
      actual: { field: "surface.temperatureC.members", hour: 2 },
      operator: "equal",
      expected: 9,
    });

    const [present, value] = resolveMetric(profile, {
      field: "derived.usableLiftTopM.p50",
      hour: 2,
    });
    expect(present).toBe(true);
    expect(value).toBe(profile.hours[2].derived.usableLiftTopM.p50);
  });

  it("nearest-height selection uses the median height of ensemble levels", () => {
    const profile = generated("ensemble-wide");
    const hour = profile.hours[2];
    const level800 = hour.levels.find((level: Doc) => level.pressureHpa === 800)!;

    // Selecting near the 800 hPa median height must not attempt numeric
    // arithmetic on the percentile block (the pre-fix TypeError).
    const [present, value] = resolveMetric(profile, {
      field: "levels.windSpeedMps.p50",
      hour: 2,
      level: { nearestHeightM: level800.heightM.p50 + 40 },
    });

    expect(present).toBe(true);
    expect(value).toBe(level800.windSpeedMps.p50);
  });

  it("a percentile suffix on a plain number raises the scenario contract", () => {
    const ensemble = generated("ensemble-tight");
    const deterministic = loadJson(
      join(ROOT, "scenarios", "generated", "minimal-valid.profile.json"),
    );

    for (const [profile, field] of [
      [ensemble, "surface.windDirectionDeg.p50"],
      [deterministic, "surface.temperatureC.p50"],
    ] as Array<[Doc, string]>) {
      expect(() => resolveMetric(profile, { field, hour: 0 })).toThrowError(ScenarioAssertionError);
      expect(() => resolveMetric(profile, { field, hour: 0 })).toThrow(
        /not an ensemble percentile block/,
      );
    }
  });

  it("an absent optional field with a percentile suffix reports absence", () => {
    const profile = generated("ensemble-tight"); // declares no CAPE capability

    const [present, value] = resolveMetric(profile, { field: "surface.capeJkg.p50", hour: 2 });
    expect(present).toBe(false);
    expect(value).toBeUndefined();

    expect(() =>
      evaluateEnsembleAssertion(profile, {
        id: "cape-band",
        actual: { field: "surface.capeJkg.p50", hour: 2 },
        operator: "greater-than",
        expected: 0,
      }),
    ).toThrow(/absent/);
  });

  it("the schema keeps the percentile path vocabulary closed", () => {
    const recipe = definition("ensemble-tight") as Doc;
    recipe.assertions = [
      {
        id: "valid-percentile-path",
        description: "A trailing percentile key addresses one band position.",
        actual: { field: "derived.usableLiftTopM.p50", hour: 2 },
        operator: "greater-than",
        expected: 0,
      },
    ];
    validateDefinition(recipe, { repositoryRoot: ROOT });

    for (const field of ["surface.windDirectionDeg.p50", "derived.usableLiftTopM.p95"]) {
      const rejected = cloneTagged(recipe) as Doc;
      rejected.assertions[0].actual.field = field;
      expect(() => validateDefinition(rejected, { repositoryRoot: ROOT })).toThrowError(
        ScenarioError,
      );
      expect(() => validateDefinition(rejected, { repositoryRoot: ROOT })).toThrow(/is invalid/);
    }
  });
});

describe("optional fields and comparison scenarios", () => {
  it("aggregates declared optional surface fields into ensemble hours", () => {
    const recipe = definition("ensemble-tight") as Doc;
    recipe.capabilities.gust = "hourMax";
    recipe.semantics.gust = "hourMax";
    recipe.transforms.push({
      type: "capability-field",
      field: "surface.windGustMps",
      action: "add",
      value: 9,
    });

    const profile = generateScenario(recipe, { repositoryRoot: ROOT }) as Doc;

    expect(profile.semantics.gust).toBe("hourMax");
    for (const hour of profile.hours) {
      const block = hour.surface.windGustMps;
      expect(block.members).toBe(untag(recipe.ensemble.members));
      expect(block.p10).toBe(9);
      expect(block.p90).toBe(9);
    }
  });

  it("comparison outputs express controlled early and late development", () => {
    const recipe = untag(definition("model-timing-disagreement")) as Doc;
    const earlier = loadJson(
      join(ROOT, "scenarios", "generated", "model-timing-disagreement.earlier.profile.json"),
    );
    const later = loadJson(
      join(ROOT, "scenarios", "generated", "model-timing-disagreement.later.profile.json"),
    );

    expect(earlier.hours.map((hour: Doc) => hour.validAt)).toEqual(
      later.hours.map((hour: Doc) => hour.validAt),
    );
    expect(earlier.hours[2].derived.boundaryLayerTopM).toBeGreaterThan(
      later.hours[2].derived.boundaryLayerTopM,
    );
    expect(later.hours[5].derived.thermalVelocityMps).toBeGreaterThan(
      earlier.hours[5].derived.thermalVelocityMps,
    );
    const language = JSON.stringify(recipe).toLowerCase();
    for (const prohibited of ["probability", "probabilities", "majority", "likelihood"]) {
      expect(language).not.toContain(prohibited);
    }
  });

  it("the index hashes every ensemble and comparison output", () => {
    const index = loadJson(join(ROOT, "scenarios", "index.json"));
    const entries = Object.fromEntries(
      index.scenarios.map((entry: Doc) => [entry.id, entry]),
    ) as Record<string, Doc>;

    for (const scenarioId of ENSEMBLE_IDS) {
      expect(entries).toHaveProperty(scenarioId);
    }
    const comparisonOutputs = entries["model-timing-disagreement"].outputs;
    expect(comparisonOutputs.map((output: Doc) => output.variant)).toEqual(["earlier", "later"]);
    for (const scenarioId of [...ENSEMBLE_IDS, "model-timing-disagreement"]) {
      for (const output of entries[scenarioId].outputs) {
        const payload = readFileSync(join(ROOT, "scenarios", output.path));
        expect(output.sha256).toBe(createHash("sha256").update(payload).digest("hex"));
      }
    }
  });

  it("generate, check and double hashing cover multi-output scenarios", () => {
    const repository = scenarioRepository();

    generateScenarioRepository({ repositoryRoot: repository });
    const generatedDir = join(repository, "scenarios", "generated");
    const hashesOf = () =>
      Object.fromEntries(
        readFileSync(join(repository, "scenarios", "index.json"))
          .toString("utf-8")
          .split("\n")
          .filter((line) => line.includes('"sha256"'))
          .map((line, position) => [position, line.trim()]),
      );
    const firstHashes = hashesOf();
    const firstIndex = readFileSync(join(repository, "scenarios", "index.json"));
    generateScenarioRepository({ repositoryRoot: repository });

    expect(hashesOf()).toEqual(firstHashes);
    expect(readFileSync(join(repository, "scenarios", "index.json")).equals(firstIndex)).toBe(true);
    checkScenarioRepository({ repositoryRoot: repository });

    const stale = join(generatedDir, "model-timing-disagreement.later.profile.json");
    writeFileSync(stale, "{}\n");
    let thrown: unknown;
    try {
      checkScenarioRepository({ repositoryRoot: repository });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ScenarioCheckError);
    expect((thrown as Error).message).toMatch(/model-timing-disagreement\.later/);

    generateScenarioRepository({ repositoryRoot: repository });
    checkScenarioRepository({ repositoryRoot: repository });
  });
});
