import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/* The full local gate battery, wall-clock honest: one workspace build,
   then every gate concurrently. Correctness rests on one invariant —
   after the build, every gate is a pure READER of dist/, so lanes never
   race on package output. That is why lanes invoke the underlying tools
   directly instead of the package scripts: the scripts rebuild their
   dependencies for standalone use, and a rebuild inside a lane would
   write dist/ under another lane's feet.

   A lane runs its steps serially; lanes run concurrently. Output is
   buffered per step and printed on completion, so failures stay legible. */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const lanes = {
  static: [
    ["lint", ["pnpm", "exec", "vp", "lint"]],
    ["fmt:check", ["pnpm", "exec", "vp", "fmt", "--check"]],
  ],
  figures: [["figures:check", ["node", "internal/generate-doc-figures.mjs", "--check"]]],
  "station-assets": [
    ["station-assets:check", ["node", "internal/generate-station-assets.mjs", "--check"]],
  ],
  "doc-fences": [["doc-fences:check", ["node", "internal/check-doc-fences.mjs"]]],
  // Both content gates read sources only — no dist/, no network.
  content: [
    ["doc-links:check", ["node", "internal/check-doc-links.mjs"]],
    ["docs-structure:check", ["node", "internal/check-docs-structure.mjs"]],
    ["prose:check", ["node", "internal/check-prose-rules.mjs"]],
  ],
  typecheck: [
    ["typecheck root", ["pnpm", "exec", "tsc", "-p", "tsconfig.json", "--noEmit"]],
    ...["core", "briefing", "station", "forecast", "grib", "j2k"].map((directory) => [
      `typecheck ${directory}`,
      ["pnpm", "exec", "tsc", "-p", "tsconfig.json", "--noEmit"],
      directory,
    ]),
  ],
  // grib's oracle corpus and j2k's decoder are the two long suites; each
  // gets its own lane so neither queues behind the other.
  "test-grib": [["test grib", ["pnpm", "exec", "vp", "test"], "grib"]],
  "test-j2k": [["test j2k", ["pnpm", "exec", "vp", "test"], "j2k"]],
  tests: [
    ["test root", ["pnpm", "exec", "vp", "test"]],
    ["test core", ["pnpm", "exec", "vp", "test"], "core"],
    ["test briefing", ["pnpm", "exec", "vp", "test"], "briefing"],
    ["test station", ["pnpm", "exec", "vp", "test"], "station"],
    ["test forecast", ["pnpm", "exec", "vp", "test"], "forecast"],
  ],
  // After astro build, check reads src/ and Playwright serves dist/ —
  // disjoint surfaces, so the two run as a fork (a parallel step group).
  site: [
    ["site build", ["pnpm", "exec", "astro", "build"], "site"],
    [
      ["site check", ["pnpm", "exec", "astro", "check"], "site"],
      ["site test", ["pnpm", "exec", "playwright", "test"], "site"],
    ],
  ],
};

function run(name, [command, ...args], directory) {
  return new Promise((resolvePromise) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd: directory ? join(repoRoot, directory) : repoRoot,
      env: process.env,
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => {
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      resolvePromise({ name, code, output, seconds });
    });
    child.on("error", (error) => {
      resolvePromise({ name, code: 1, output: String(error), seconds: "0.0" });
    });
  });
}

function isFork(step) {
  return Array.isArray(step[0]);
}

async function runStep([name, command, directory]) {
  const result = await run(name, command, directory);
  console.log(`${result.code === 0 ? "ok  " : "FAIL"} ${result.name} (${result.seconds}s)`);
  return result;
}

async function runLane(steps) {
  const results = [];
  for (const step of steps) {
    const stepResults = isFork(step) ? await Promise.all(step.map(runStep)) : [await runStep(step)];
    results.push(...stepResults);
    if (stepResults.some((result) => result.code !== 0)) break; // later steps assume these
  }
  return results;
}

const startedAt = Date.now();
const build = await run("build", ["pnpm", "build"]);
console.log(`${build.code === 0 ? "ok  " : "FAIL"} build (${build.seconds}s)`);
if (build.code !== 0) {
  console.error(build.output);
  process.exit(1);
}

const results = (await Promise.all(Object.values(lanes).map(runLane))).flat();
const failures = results.filter((result) => result.code !== 0);
const total = ((Date.now() - startedAt) / 1000).toFixed(0);

for (const failure of failures) {
  console.error(`\n━━━ ${failure.name} failed ━━━\n${failure.output}`);
}
if (failures.length > 0) {
  console.error(`\ngates: ${failures.length} gate(s) failed in ${total}s`);
  process.exit(1);
}
console.log(`\ngates: all green in ${total}s`);
