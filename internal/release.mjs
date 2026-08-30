import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registry = "https://registry.npmjs.org/";

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

function versionChangedAtHead(pkg) {
  const manifest = `${pkg.path}/package.json`;
  const result = spawnSync("git", ["show", `HEAD^:${manifest}`], { encoding: "utf8" });
  if (result.status !== 0) return false;
  return JSON.parse(result.stdout).version !== pkg.version;
}

function localTagTarget(tag) {
  const result = spawnSync("git", ["rev-list", "-n", "1", tag], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function remoteTagTarget(tag) {
  const result = capture("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}^{}`]);
  return result ? result.split(/\s/)[0] : null;
}

if (!process.env.NPM_TOKEN) refuse("NPM_TOKEN is unset");
process.env["npm_config_//registry.npmjs.org/:_authToken"] = process.env.NPM_TOKEN;

const repository = JSON.parse(
  capture("gh", ["repo", "view", "--json", "nameWithOwner,visibility"]),
);
if (repository.nameWithOwner !== "azohra/meteo" || repository.visibility !== "PUBLIC") {
  refuse(
    `expected azohra/meteo (PUBLIC), found ${repository.nameWithOwner} (${repository.visibility})`,
  );
}

const branch = capture("git", ["branch", "--show-current"]);
if (!branch || branch === "main")
  refuse("run from a release branch based on origin/main, never from main");
if (capture("git", ["status", "--porcelain=v1", "--untracked-files=all"])) {
  refuse("the worktree is not clean");
}

run("git", ["fetch", "--quiet", "origin", "main", "--tags"]);
const startingHead = capture("git", ["rev-parse", "HEAD"]);
const main = capture("git", ["rev-parse", "origin/main"]);
if (startingHead !== main) {
  refuse(`HEAD ${startingHead.slice(0, 7)} is not origin/main ${main.slice(0, 7)}`);
}

if (capture("pnpm", ["config", "get", "registry"]) !== registry) {
  refuse(`pnpm registry is not ${registry}`);
}
const npmUser = capture("npm", ["whoami", `--registry=${registry}`]);
if (npmUser !== "azohra") refuse(`NPM_TOKEN authenticates as ${npmUser}, not azohra`);

const changeIntentDirectory = resolve(root, ".changeset");
const changeIntents = existsSync(changeIntentDirectory)
  ? readdirSync(changeIntentDirectory).filter(
      (file) => file.endsWith(".md") && file.toLowerCase() !== "readme.md",
    )
  : [];
let packages = publicPackages();
if (packages.length === 0) refuse("the workspace contains no public packages");

let candidates = [];
if (changeIntents.length > 0) {
  const before = new Map(packages.map((pkg) => [pkg.name, pkg.version]));
  run("pnpm", ["version", "-r"]);
  packages = publicPackages();
  candidates = packages.filter(
    (pkg) =>
      before.get(pkg.name) !== pkg.version || !publishedVersions(pkg.name).includes(pkg.version),
  );
  if (candidates.length === 0) refuse("change intents produced no release candidate");

  run("mise", ["run", "check"]);
  run("git", ["add", "-A"]);
  if (!capture("git", ["diff", "--cached", "--name-only"])) {
    refuse("pnpm version produced no staged files");
  }
  const subject = `Version packages: ${candidates.map((pkg) => `${pkg.name}@${pkg.version}`).join(", ")}`;
  run("git", ["commit", "--no-verify", "-m", subject]);
  run("git", ["push", "origin", "HEAD:main"]);
} else {
  candidates = packages.filter(versionChangedAtHead);
  run("mise", ["run", "check"]);
  if (capture("git", ["status", "--porcelain=v1", "--untracked-files=all"])) {
    refuse("the repository proof changed the worktree");
  }
}

const releaseHead = capture("git", ["rev-parse", "HEAD"]);
const unpublished = packages.filter((pkg) => !publishedVersions(pkg.name).includes(pkg.version));
for (const pkg of unpublished) {
  if (!candidates.some((candidate) => candidate.name === pkg.name)) candidates.push(pkg);
}

const tagsToPush = candidates.filter((pkg) => {
  const tag = `${pkg.name}@${pkg.version}`;
  return remoteTagTarget(tag) !== releaseHead;
});
if (unpublished.length === 0 && tagsToPush.length === 0) {
  refuse("there are no pending package versions or release tags");
}

if (unpublished.length > 0) {
  run("pnpm", ["publish", "-r", "--access", "public", "--no-git-checks"]);
}

for (const pkg of candidates) {
  const tag = `${pkg.name}@${pkg.version}`;
  const remoteTarget = remoteTagTarget(tag);
  let localTarget = localTagTarget(tag);
  if (!localTarget && !remoteTarget && publishedVersions(pkg.name).includes(pkg.version)) {
    run("git", ["tag", "-a", tag, "-m", tag, releaseHead]);
    localTarget = releaseHead;
  }
  if (localTarget !== releaseHead) refuse(`${tag} does not point to ${releaseHead.slice(0, 7)}`);
  if (capture("git", ["cat-file", "-t", tag]) !== "tag") refuse(`${tag} is not annotated`);
}

run("git", ["push", "--follow-tags", "origin", "HEAD:main"]);

for (const pkg of candidates) {
  const tag = `${pkg.name}@${pkg.version}`;
  if (!publishedVersions(pkg.name).includes(pkg.version))
    refuse(`${tag} is not available from npm`);
  if (remoteTagTarget(tag) !== releaseHead) refuse(`${tag} is not on origin`);
}

console.log(
  `release: published ${candidates.map((pkg) => `${pkg.name}@${pkg.version}`).join(", ")}`,
);
