import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registry = "https://registry.npmjs.org/";
const planPath = "internal/release-plan.json";
const prepare = process.argv[2] === "--prepare";
if (process.argv.slice(2).some((arg) => arg !== "--prepare")) {
  throw new Error("The only supported release option is --prepare");
}

process.chdir(root);

function refuse(message) {
  console.error(`release: refusing — ${message}`);
  process.exit(1);
}

function capture(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8" }).trim();
  } catch {
    refuse(`${command} ${args[0] ?? ""} failed`);
  }
}

function run(command, args) {
  try {
    execFileSync(command, args, { stdio: "inherit" });
  } catch {
    refuse(`${command} ${args[0] ?? ""} failed`);
  }
}

function publicPackages() {
  const workspaces = JSON.parse(capture("pnpm", ["list", "-r", "--depth", "-1", "--json"]));
  const packages = workspaces
    .filter((workspace) => !workspace.private && workspace.name && workspace.version)
    .map((workspace) => ({
      name: workspace.name,
      path: relative(root, workspace.path),
      version: workspace.version,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const unexpected = packages.find((pkg) => !pkg.name.startsWith("@azohra/meteo."));
  if (unexpected) refuse(`public package ${unexpected.name} is outside the @azohra/meteo scope`);
  return packages;
}

function publishedVersions(name) {
  const result = spawnSync("npm", ["view", name, "versions", "--json", `--registry=${registry}`], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    if (result.stderr.includes("E404")) return [];
    refuse(`could not read ${name} from npm`);
  }
  const parsed = JSON.parse(result.stdout);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function localTagTarget(tag) {
  const result = spawnSync("git", ["rev-list", "-n", "1", tag], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function remoteTagTarget(tag) {
  const result = capture("git", [
    "ls-remote",
    "--tags",
    "origin",
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`,
  ]);
  const refs = new Map(
    result
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(/\s+/).reverse()),
  );
  if (refs.has(`refs/tags/${tag}`) && !refs.has(`refs/tags/${tag}^{}`)) {
    refuse(`${tag} on origin is not annotated`);
  }
  return refs.get(`refs/tags/${tag}^{}`) ?? null;
}

for (const direction of [[], ["--push"]]) {
  const remote = capture("git", ["remote", "get-url", ...direction, "--all", "origin"]);
  if (
    !["https://github.com/azohra/meteo.git", "git@github.com:azohra/meteo.git"].includes(remote)
  ) {
    refuse("origin must point only to azohra/meteo for fetch and push");
  }
}

const repository = JSON.parse(
  capture("gh", ["repo", "view", "--json", "nameWithOwner,visibility"]),
);
if (repository.nameWithOwner !== "azohra/meteo" || repository.visibility !== "PUBLIC") {
  refuse(
    `expected azohra/meteo (PUBLIC), found ${repository.nameWithOwner} (${repository.visibility})`,
  );
}

const branch = capture("git", ["branch", "--show-current"]);
if (prepare && (!branch || branch === "main"))
  refuse("run from a release branch based on origin/main, never from main");
if (capture("git", ["status", "--porcelain=v1", "--untracked-files=all"])) {
  refuse("the worktree is not clean");
}

run("git", ["fetch", "--quiet", "origin", "main", "--tags"]);
const startingHead = capture("git", ["rev-parse", "HEAD"]);
const main = capture("git", ["rev-parse", "origin/main"]);
if (prepare && startingHead !== main) {
  refuse(`HEAD ${startingHead.slice(0, 7)} is not origin/main ${main.slice(0, 7)}`);
}
if (!prepare) run("git", ["merge-base", "--is-ancestor", startingHead, main]);
if (capture("pnpm", ["config", "get", "registry"]) !== registry) {
  refuse(`pnpm registry is not ${registry}`);
}

const changeIntentDirectory = resolve(root, ".changeset");
const changeIntents = existsSync(changeIntentDirectory)
  ? readdirSync(changeIntentDirectory).filter(
      (file) => file.endsWith(".md") && file.toLowerCase() !== "readme.md",
    )
  : [];
let packages = publicPackages();
if (packages.length === 0) refuse("the workspace contains no public packages");

if (prepare) {
  if (changeIntents.length === 0) refuse("there are no pending change intents");
  const before = new Map(packages.map((pkg) => [pkg.name, pkg.version]));
  run("pnpm", ["version", "-r"]);
  packages = publicPackages();
  const candidates = packages.filter(
    (pkg) =>
      before.get(pkg.name) !== pkg.version || !publishedVersions(pkg.name).includes(pkg.version),
  );
  if (candidates.length === 0) refuse("change intents produced no release candidate");
  writeFileSync(
    planPath,
    `${JSON.stringify(
      candidates.map(({ name, version }) => ({ name, version })),
      null,
      2,
    )}\n`,
  );
  run("mise", ["run", "check"]);
  console.log(
    "release: prepared versions, changelogs, and release plan; review and commit them together, then merge through a pull request",
  );
  process.exit(0);
}

if (changeIntents.length > 0) refuse("prepare and merge pending change intents before publishing");
if (!existsSync(planPath)) refuse("no release plan; run mise run release:prepare first");
const releaseHead = capture("git", ["log", "-1", "--format=%H", "--", planPath]);
if (releaseHead !== startingHead)
  refuse("check out the merged commit that last changed the release plan");
const plan = JSON.parse(readFileSync(planPath, "utf8"));
if (!Array.isArray(plan) || plan.length === 0) refuse("the release plan is empty or invalid");
const candidates = plan.map((entry) => {
  const pkg = packages.find(
    (candidate) => candidate.name === entry?.name && candidate.version === entry.version,
  );
  if (!pkg) refuse("the release plan does not match the workspace");
  return pkg;
});
if (new Set(candidates.map((pkg) => pkg.name)).size !== candidates.length)
  refuse("duplicate release candidate");
if (!process.env.NPM_TOKEN) refuse("NPM_TOKEN is unset");
process.env["npm_config_//registry.npmjs.org/:_authToken"] = process.env.NPM_TOKEN;
const npmUser = capture("npm", ["whoami", `--registry=${registry}`]);
if (npmUser !== "azohra") refuse(`NPM_TOKEN authenticates as ${npmUser}, not azohra`);

run("mise", ["run", "check"]);
if (capture("git", ["status", "--porcelain=v1", "--untracked-files=all"])) {
  refuse("the repository proof changed the worktree");
}
const unpublished = packages.filter((pkg) => !publishedVersions(pkg.name).includes(pkg.version));
if (unpublished.some((pkg) => !candidates.includes(pkg)))
  refuse("an unpublished package is outside the release plan");

function checkTags() {
  for (const pkg of candidates) {
    const tag = `${pkg.name}@${pkg.version}`;
    const remoteTarget = remoteTagTarget(tag);
    const localTarget = localTagTarget(tag);
    if (
      (remoteTarget && remoteTarget !== releaseHead) ||
      (localTarget && localTarget !== releaseHead)
    ) {
      refuse(`${tag} already points to another commit`);
    }
    if (localTarget && capture("git", ["cat-file", "-t", `refs/tags/${tag}`]) !== "tag") {
      refuse(`${tag} is not annotated`);
    }
  }
}

// Tag conflicts must stop the release before the first irreversible npm upload.
checkTags();
if (unpublished.length > 0) {
  run("pnpm", ["publish", "-r", "--access", "public", "--no-git-checks"]);
}
checkTags();
for (const pkg of candidates) {
  const tag = `${pkg.name}@${pkg.version}`;
  if (!publishedVersions(pkg.name).includes(pkg.version))
    refuse(`${tag} is not available from npm`);
  if (!localTagTarget(tag)) run("git", ["tag", "-a", tag, "-m", tag, releaseHead]);
}
run("git", [
  "push",
  "--no-follow-tags",
  "origin",
  ...candidates.map((pkg) => `refs/tags/${pkg.name}@${pkg.version}`),
]);
for (const pkg of candidates) {
  const tag = `${pkg.name}@${pkg.version}`;
  if (remoteTagTarget(tag) !== releaseHead) refuse(`${tag} is not on origin`);
}
console.log(
  `release: verified ${candidates.map((pkg) => `${pkg.name}@${pkg.version}`).join(", ")} at ${releaseHead}`,
);
