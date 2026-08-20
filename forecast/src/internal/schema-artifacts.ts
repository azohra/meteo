// The one home for the scenario-index schema artifact: the repo-root
// emitter (internal/emit-schemas.ts) writes exactly this rendering, and
// test/scenarios.test.ts asserts the committed file matches it byte for
// byte. Unlike the capability packages' schema/ directories, the artifact
// lives beside the documents it describes — scenarios/ at the repository
// root — and stays off the published /schema/ URL space, so it keeps its
// repository-path $id instead of the core renderer's default. The contract's
// strict objects keep additionalProperties: false on purpose: the index is
// generator-owned output re-read in this repository, not a wire document
// readers must tolerate growing.
import { renderJsonArtifact, schemaArtifactJson, type SchemaArtifact } from "@azohra/meteo.core";
import { scenarioIndexSchema } from "../scenario/contract.js";

/** Where the emitted schema is committed, relative to the repository root. */
export const SCENARIO_INDEX_SCHEMA_PATH = "scenarios/index.schema.json";

const scenarioIndexArtifact: SchemaArtifact = {
  fileName: "index.schema.json",
  title: "Synthetic scenario index",
  schema: scenarioIndexSchema,
};

/** The exact shipped bytes of scenarios/index.schema.json. */
export function renderScenarioIndexSchema(): string {
  return renderJsonArtifact({
    ...schemaArtifactJson(scenarioIndexArtifact),
    $id: `https://meteo.azohra.com/${SCENARIO_INDEX_SCHEMA_PATH}`,
  });
}
