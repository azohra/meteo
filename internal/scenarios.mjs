import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ScenarioError,
  checkScenarioRepository,
  generateScenarioRepository,
} from "@azohra/meteo.forecast";

function repositoryRoot() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    if (statSync(join(root, "scenarios", "scenario.schema.json")).isFile()) {
      return root;
    }
  } catch {}
  throw new Error(
    `no scenarios/ tree at ${root}: this script runs from a source ` +
      "checkout of https://github.com/azohra/meteo",
  );
}

const action = process.argv[2];
if (action !== "generate" && action !== "check") {
  console.error("usage: node internal/scenarios.mjs <generate|check>");
  process.exit(2);
}

const root = repositoryRoot();
try {
  if (action === "generate") {
    const paths = generateScenarioRepository({ repositoryRoot: root });
    console.log(
      `generated ${paths.length - 1} scenario profile(s) and scenarios/index.json in ${root}`,
    );
  } else {
    checkScenarioRepository({ repositoryRoot: root });
    console.log(`generated scenarios in ${root} match their definitions`);
  }
} catch (error) {
  if (error instanceof ScenarioError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
