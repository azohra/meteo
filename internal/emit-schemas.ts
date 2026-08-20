import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderJsonArtifact,
  renderSchemaArtifact,
  type ExampleArtifact,
  type SchemaArtifact,
} from "@azohra/meteo.core";
import { CAPABILITIES } from "../capabilities.js";

/* Runs from dist/internal/, two directory levels below the repo root. */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const check = process.argv.includes("--check");
const checkDir = check ? mkdtempSync(join(tmpdir(), "meteo-schemas-")) : null;
const drift: string[] = [];

function emit(relative: string, rendered: string): void {
  const committedPath = join(repoRoot, relative);
  if (checkDir === null) {
    writeFileSync(committedPath, rendered);
    console.log(`wrote ${committedPath}`);
    return;
  }
  const temporaryPath = join(checkDir, relative);
  mkdirSync(dirname(temporaryPath), { recursive: true });
  writeFileSync(temporaryPath, rendered);
  const committed = existsSync(committedPath) ? readFileSync(committedPath, "utf-8") : null;
  if (committed === readFileSync(temporaryPath, "utf-8")) {
    console.log(`ok    ${relative}`);
  } else {
    drift.push(relative);
    console.log(`DRIFT ${relative}${committed === null ? " (missing)" : ""}`);
  }
}

for (const capability of CAPABILITIES) {
  const packageRoot = join(repoRoot, capability.directory);
  const tablePath = join(packageRoot, "dist", "internal", "schema-artifacts.js");
  if (!existsSync(tablePath)) continue;

  const table = (await import(tablePath)) as {
    schemaArtifacts?: readonly SchemaArtifact[];
    exampleArtifacts?: readonly ExampleArtifact[];
  };

  if (!check) mkdirSync(join(packageRoot, "schema"), { recursive: true });

  for (const artifact of table.schemaArtifacts ?? []) {
    emit(`${capability.directory}/schema/${artifact.fileName}`, renderSchemaArtifact(artifact));
  }
  for (const example of table.exampleArtifacts ?? []) {
    example.schema.parse(example.document);
    emit(
      `${capability.directory}/schema/${example.fileName}`,
      renderJsonArtifact(example.document),
    );
  }
}

/* The forecast engine's scenario-index contract emits beside the documents
   it describes — scenarios/index.schema.json at the repository root, not a
   package schema/ directory. */
const forecastTablePath = join(repoRoot, "forecast", "dist", "internal", "schema-artifacts.js");
if (existsSync(forecastTablePath)) {
  const { SCENARIO_INDEX_SCHEMA_PATH, renderScenarioIndexSchema } = (await import(
    forecastTablePath
  )) as {
    SCENARIO_INDEX_SCHEMA_PATH: string;
    renderScenarioIndexSchema: () => string;
  };
  emit(SCENARIO_INDEX_SCHEMA_PATH, renderScenarioIndexSchema());
}

if (drift.length > 0) {
  console.error(`\nSchema artifacts drifted from the zod contracts: ${drift.join(", ")}`);
  console.error("Regenerate with: pnpm schemas");
  process.exit(1);
}
