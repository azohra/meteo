import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/* Shared plumbing for the scenario suites: the repository root, raw JSON
   reads, and a disposable copy of the committed scenarios/ tree. */

export const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

export type Doc = Record<string, any>;

export function loadJson(path: string): Doc {
  return JSON.parse(readFileSync(path, "utf-8")) as Doc;
}

export function scenarioRepository(): string {
  // Only the scenarios/ tree travels: the model catalogue ships with the
  // package itself (models.json).
  const tmp = mkdtempSync(join(tmpdir(), "scenario-repo-"));
  cpSync(join(ROOT, "scenarios"), join(tmp, "scenarios"), { recursive: true });
  return tmp;
}
