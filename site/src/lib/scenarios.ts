import { siteForecastSchema, type SiteForecast } from "@azohra/meteo.briefing/contract";
import {
  parseScenarioIndex,
  type ScenarioCapabilities,
  type ScenarioIndexEntry,
  type ScenarioKind,
  type ScenarioLaunch,
} from "@azohra/meteo.forecast/contract";
import rawIndex from "../../../scenarios/index.json";

if (typeof window !== "undefined") {
  throw new Error(
    "[scenarios] the scenario registry is server-only — resolve profiles in Astro frontmatter and embed them inline for client scripts",
  );
}

export type { ScenarioCapabilities, ScenarioKind, ScenarioLaunch };

export interface TeachingScenario {
  id: string;
  variant?: string;
  kind: ScenarioKind;
  modelShape: string;
  profile: SiteForecast;
  lesson: string;
  label: string;
  timeZone: string;
  launch: ScenarioLaunch;
  capabilities: ScenarioCapabilities;
  accessibilityDescription: string;
}

/* The two output shapes of the contract's kind union, widened to one:
   deterministic and ensemble outputs never carry a variant, comparison
   outputs always do — the registry only needs the optional view. */
interface IndexedOutput {
  path: string;
  sha256: string;
  variant?: string;
  title?: string;
}

const rawProfileModules = import.meta.glob("../../../scenarios/generated/*.profile.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

function fail(message: string): never {
  throw new Error(`[scenarios] ${message}`);
}

function profileModule(path: string): unknown {
  const suffix = `/${path}`;
  const matches = Object.entries(rawProfileModules).filter(([modulePath]) =>
    modulePath.endsWith(suffix),
  );
  if (matches.length !== 1) fail(`${path} resolved to ${matches.length} generated profile modules`);
  return matches[0][1];
}

function accessibilityDescription(
  entry: ScenarioIndexEntry,
  output: IndexedOutput,
  profile: SiteForecast,
): string {
  const label = output.title ?? entry.title;
  const shape =
    entry.kind === "ensemble"
      ? `an ensemble of ${profile.run.members ?? "multiple"} members`
      : entry.kind === "comparison"
        ? "one profile in a controlled timing comparison"
        : "one atmospheric profile";
  return `${label}. This Meteogram shows ${shape} in ${entry.timeZone}. ${entry.lesson}`;
}

function buildRegistry(): Map<string, TeachingScenario[]> {
  // The site is a reader like any other: the generated index comes in
  // through the forecast package's contract guard (compare site-context.ts).
  // Only what no schema can express stays here: duplicate detection across
  // entries and the glob-module resolution of each generated profile.
  const index =
    parseScenarioIndex(rawIndex) ?? fail("index.json fails the scenario-index contract");
  const registry = new Map<string, TeachingScenario[]>();
  const outputPaths = new Set<string>();
  for (const entry of index.scenarios) {
    if (registry.has(entry.id)) fail(`duplicate scenario id ${entry.id}`);
    const variants = new Set<string>();
    const outputs: readonly IndexedOutput[] = entry.outputs;
    const scenarios = outputs.map((output) => {
      if (outputPaths.has(output.path)) fail(`duplicate generated profile path ${output.path}`);
      outputPaths.add(output.path);
      if (output.variant && variants.has(output.variant))
        fail(`duplicate ${entry.id} variant ${output.variant}`);
      if (output.variant) variants.add(output.variant);

      const parsed = siteForecastSchema.safeParse(profileModule(output.path));
      if (!parsed.success)
        fail(`${output.path} is not a valid profile document: ${parsed.error.message}`);
      return {
        id: entry.id,
        variant: output.variant,
        kind: entry.kind,
        modelShape: entry.modelShape,
        profile: parsed.data,
        lesson: entry.lesson,
        label: output.title ?? entry.title,
        timeZone: entry.timeZone,
        launch: entry.launch,
        capabilities: entry.capabilities,
        accessibilityDescription: accessibilityDescription(entry, output, parsed.data),
      } satisfies TeachingScenario;
    });
    registry.set(entry.id, scenarios);
  }
  return registry;
}

const REGISTRY = buildRegistry();

function scenariosById(id: string): readonly TeachingScenario[] {
  const scenarios = REGISTRY.get(id);
  if (!scenarios) fail(`unknown scenario id ${JSON.stringify(id)}`);
  return scenarios;
}

export function scenarioById(id: string, variant?: string): TeachingScenario {
  const scenarios = scenariosById(id);
  if (scenarios.length === 1) {
    if (variant !== undefined) fail(`${id} has no variant ${JSON.stringify(variant)}`);
    return scenarios[0];
  }
  if (variant === undefined)
    fail(
      `${id} is a comparison; request one of: ${scenarios.map((item) => item.variant).join(", ")}`,
    );
  const scenario = scenarios.find((item) => item.variant === variant);
  if (!scenario) fail(`${id} has no variant ${JSON.stringify(variant)}`);
  return scenario;
}
