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

function emit(capabilityDirectory: string, fileName: string, rendered: string): void {
  const committedPath = join(repoRoot, capabilityDirectory, "schema", fileName);
  const relative = `${capabilityDirectory}/schema/${fileName}`;
  if (checkDir === null) {
    writeFileSync(committedPath, rendered);
    console.log(`wrote ${committedPath}`);
    return;
  }
  const temporaryPath = join(checkDir, capabilityDirectory, fileName);
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
    emit(capability.directory, artifact.fileName, renderSchemaArtifact(artifact));
  }
  for (const example of table.exampleArtifacts ?? []) {
    example.schema.parse(example.document);
    emit(capability.directory, example.fileName, renderJsonArtifact(example.document));
  }
}

if (drift.length > 0) {
  console.error(`\nSchema artifacts drifted from the zod contracts: ${drift.join(", ")}`);
  console.error("Regenerate with: pnpm schemas");
  process.exit(1);
}
