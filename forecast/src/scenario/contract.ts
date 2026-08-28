import { z } from "zod";

/* The scenario-index contract: the one home for the shape of
   scenarios/index.json. The generator validates every index it builds
   against this schema, internal/emit-schemas.ts renders it to the
   committed scenarios/index.schema.json (held by a byte-compare test in
   test/scenarios.test.ts), and the site's scenario registry reads the
   committed index through parseScenarioIndex().

   Rules JSON Schema cannot carry travel as refinements below; they bind
   every parse but do not appear in the emitted schema file. */

/** Version literal of scenarios/index.json — the generator writes it, readers pin it. */
export const SCENARIO_INDEX_SCHEMA_VERSION = 1;

/* Slugs here carry the definition schema's 80-character ceiling, unlike the
   unbounded wire slugs in @azohra/meteo.briefing's contract. */
const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "expected a lowercase hyphenated slug")
  .min(1)
  .max(80);

const labelSchema = z.string().min(1).max(100);

const timeZoneSchema = z
  .string()
  .regex(
    /^(?:Etc\/(?:UTC|GMT(?:[+-](?:[1-9]|1[0-4]))?)|[A-Za-z]+(?:[_-][A-Za-z]+)*(?:\/[A-Za-z]+(?:[_-][A-Za-z]+)*)+)$/,
  )
  .describe("An explicit IANA-style time-zone name, echoed from the definition.");

export const scenarioSiteSchema = z
  .strictObject({
    id: slugSchema,
    name: labelSchema,
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    modelElevationM: z.number().min(-500).max(9000),
    timeZone: z.string().min(1).optional(),
  })
  .describe(
    "The representative generated profile's site block, verbatim — sample provenance, never a launch.",
  );

export const scenarioLaunchSchema = z
  .strictObject({
    elevationM: z.number().min(-500).max(9000),
  })
  .describe(
    "The launch the scenario teaches against. It never enters the generated documents (documents are launch-agnostic sample provenance); renderers pass it as MeteogramOptions.launch, the same seam production consumers use.",
  );

const pressureLevelSchema = z.number().min(50).max(1100);

function duplicated(levels: readonly number[]): boolean {
  return new Set(levels).size !== levels.length;
}

export const scenarioCapabilitiesSchema = z
  .strictObject({
    levels: z.boolean(),
    pressureLevels: z.array(pressureLevelSchema),
    verticalVelocity: z.union([z.literal(false), z.enum(["omega", "fromGeometricW"])]),
    verticalVelocityLevels: z.array(pressureLevelSchema).optional(),
    heatFluxes: z.boolean(),
    gust: z.union([z.literal(false), z.enum(["hourMax", "instant"])]),
    cape: z.boolean(),
    cin: z.boolean(),
    pblHeight: z.boolean(),
    cloudLayers: z.boolean(),
    cloudProfile: z.boolean(),
    smoke: z.union([z.literal(false), z.enum(["radiativelyCoupled", "passive"])]).optional(),
  })
  .describe(
    "The definition's capability declaration, verbatim — the same shape scenario.schema.json's capabilities block validates.",
  )
  .superRefine((capabilities, ctx) => {
    if (duplicated(capabilities.pressureLevels)) {
      ctx.addIssue({ code: "custom", path: ["pressureLevels"], message: "levels must be unique" });
    }
    if (
      capabilities.verticalVelocityLevels !== undefined &&
      duplicated(capabilities.verticalVelocityLevels)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["verticalVelocityLevels"],
        message: "levels must be unique",
      });
    }
    if (capabilities.levels) {
      if (capabilities.pressureLevels.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["pressureLevels"],
          message: "declared levels need at least one pressure level",
        });
      }
    } else {
      if (capabilities.pressureLevels.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["pressureLevels"],
          message: "pressure levels require the levels capability",
        });
      }
      if (capabilities.verticalVelocity !== false) {
        ctx.addIssue({
          code: "custom",
          path: ["verticalVelocity"],
          message: "vertical velocity requires the levels capability",
        });
      }
      if (capabilities.cloudProfile) {
        ctx.addIssue({
          code: "custom",
          path: ["cloudProfile"],
          message: "a cloud profile requires the levels capability",
        });
      }
    }
    if (
      (capabilities.verticalVelocityLevels === undefined) !==
      (capabilities.verticalVelocity === false)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["verticalVelocityLevels"],
        message: "verticalVelocityLevels is present exactly when verticalVelocity is declared",
      });
    }
  });

const generatedProfilePathSchema = z
  .string()
  .regex(/^generated\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)?\.profile\.json$/)
  .describe("The generated profile document, relative to scenarios/.");

const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .describe("Lowercase SHA-256 of the generated document's bytes.");

/** A deterministic or ensemble scenario's single unvaried output. */
export const scenarioOutputSchema = z.strictObject({
  title: labelSchema.optional(),
  path: generatedProfilePathSchema,
  sha256: sha256Schema,
});

/** One labeled variant of a comparison scenario. */
export const scenarioComparisonOutputSchema = z.strictObject({
  variant: slugSchema,
  title: labelSchema,
  path: generatedProfilePathSchema,
  sha256: sha256Schema,
});

function entryShape<Kind extends z.ZodType, Outputs extends z.ZodType>(
  kind: Kind,
  outputs: Outputs,
) {
  return z.strictObject({
    id: slugSchema,
    title: labelSchema,
    lesson: z.string().min(20).max(500),
    kind,
    modelShape: z.enum([
      "hourly-rich",
      "hourly-core",
      "three-hourly-regional",
      "ensemble-five-level",
    ]),
    timeZone: timeZoneSchema,
    site: scenarioSiteSchema,
    launch: scenarioLaunchSchema,
    capabilities: scenarioCapabilitiesSchema,
    outputs,
  });
}

/* One kind, one output discipline: a deterministic or ensemble scenario
   publishes exactly one unvaried profile; a comparison publishes two or
   more, each carrying its variant id and label. */
export const scenarioIndexEntrySchema = z.discriminatedUnion("kind", [
  entryShape(z.enum(["deterministic", "ensemble"]), z.array(scenarioOutputSchema).length(1)),
  entryShape(z.literal("comparison"), z.array(scenarioComparisonOutputSchema).min(2)),
]);

export const scenarioIndexSchema = z
  .strictObject({
    schemaVersion: z.literal(SCENARIO_INDEX_SCHEMA_VERSION),
    scenarios: z.array(scenarioIndexEntrySchema),
  })
  .describe(
    "The public index of generated teaching scenarios (scenarios/index.json), emitted by `mise run scenarios:generate` and consumed by the site's scenario registry. Every entry pairs a definition's teaching metadata with the generated profiles' provenance (path + SHA-256), the representative profile's site block, and the launch renderers pass as MeteogramOptions.launch.",
  );

export type ScenarioIndex = z.infer<typeof scenarioIndexSchema>;
export type ScenarioIndexEntry = z.infer<typeof scenarioIndexEntrySchema>;
export type ScenarioKind = ScenarioIndexEntry["kind"];
export type ScenarioSite = z.infer<typeof scenarioSiteSchema>;
export type ScenarioLaunch = z.infer<typeof scenarioLaunchSchema>;
export type ScenarioCapabilities = z.infer<typeof scenarioCapabilitiesSchema>;
export type ScenarioOutput = z.infer<typeof scenarioOutputSchema>;
export type ScenarioComparisonOutput = z.infer<typeof scenarioComparisonOutputSchema>;

export function parseScenarioIndex(value: unknown): ScenarioIndex | null {
  const result = scenarioIndexSchema.safeParse(value);
  return result.success ? result.data : null;
}
