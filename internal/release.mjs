import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const registry = "https://registry.npmjs.org/";
const ledgerPath = ".changeset/ledger.yaml";
const capture = (command, args) => execFileSync(command, args, { encoding: "utf8" }).trim();
const run = (command, args) => execFileSync(command, args, { stdio: "inherit" });
const refuse = (message) => {
  throw new Error(`release: ${message}`);
};
const read = (path) => (existsSync(path) ? readFileSync(path, "utf8") : "");
const previous = (path) => {
  const result = spawnSync("git", ["show", `HEAD^:${path}`], { encoding: "utf8" });
  return result.status === 0 ? result.stdout : "";
};

if (process.argv.length > 2)
  refuse("release takes no arguments; check out the merged version commit");
for (const direction of [[], ["--push"]]) {
  const origin = capture("git", ["remote", "get-url", ...direction, "--all", "origin"]);
  if (!["https://github.com/azohra/meteo.git", "git@github.com:azohra/meteo.git"].includes(origin))
    refuse("origin must point to azohra/meteo");
}
if (capture("git", ["status", "--porcelain"])) refuse("the worktree is not clean");
run("git", ["fetch", "--quiet", "origin", "main"]);
const head = capture("git", ["rev-parse", "HEAD"]);
capture("git", ["rev-parse", "HEAD^"]);
run("git", ["merge-base", "--is-ancestor", head, "origin/main"]);
if (
  existsSync(".changeset") &&
  readdirSync(".changeset").some(
    (file) => file.endsWith(".md") && file.toLowerCase() !== "readme.md",
  )
)
  refuse("prepare and merge pending change intents before publishing");

const packages = JSON.parse(capture("pnpm", ["list", "-r", "--depth", "-1", "--json"])).filter(
  (pkg) => !pkg.private && pkg.name && pkg.version,
);
const ledger = parse(read(ledgerPath)) ?? {};
const oldLedger = parse(previous(ledgerPath)) ?? {};
const added = Object.keys(ledger).filter((tag) => !Object.hasOwn(oldLedger, tag));
for (const tag of added) {
  if (
    !packages.some(
      (pkg) =>
        tag === `${pkg.name}@${pkg.version}` &&
        ledger[tag].dir === relative(process.cwd(), pkg.path),
    )
  )
    refuse(`${tag} in the ledger does not match a workspace package`);
}
// pnpm records direct intents in its ledger; dependency-only releases also
// change package versions. Both belong to this merged release commit.
const candidates = packages.filter((pkg) => {
  const before = JSON.parse(
    previous(`${relative(process.cwd(), pkg.path)}/package.json`) || "null",
  );
  return added.includes(`${pkg.name}@${pkg.version}`) || (before && before.version !== pkg.version);
});
if (!candidates.length) refuse("HEAD contains no prepared package releases");
if (candidates.some((pkg) => !pkg.name.startsWith("@azohra/meteo.")))
  refuse("release candidates must belong to @azohra/meteo");
if (!process.env.NPM_TOKEN) refuse("NPM_TOKEN is unset");
process.env["npm_config_//registry.npmjs.org/:_authToken"] = process.env.NPM_TOKEN;

function published(pkg) {
  const result = spawnSync(
    "npm",
    ["view", `${pkg.name}@${pkg.version}`, "version", "--json", `--registry=${registry}`],
    { encoding: "utf8" },
  );
  if (result.status === 0) return JSON.parse(result.stdout) === pkg.version;
  if (result.stderr.includes("E404")) return false;
  refuse(`could not read ${pkg.name}@${pkg.version} from npm`);
}
function remoteTarget(tag) {
  const refs = capture("git", ["ls-remote", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`]);
  const lines = refs.split("\n").filter(Boolean);
  return (lines.find((line) => line.endsWith("^{}")) ?? lines[0])?.split(/\s+/)[0];
}
function localTarget(tag) {
  const result = spawnSync("git", ["rev-list", "-n", "1", `refs/tags/${tag}`], {
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : null;
}
function githubRelease(tag) {
  const result = spawnSync(
    "gh",
    ["api", `repos/azohra/meteo/releases/tags/${encodeURIComponent(tag)}`],
    { encoding: "utf8" },
  );
  if (result.status === 0) return JSON.parse(result.stdout);
  if (result.stderr.includes("HTTP 404")) return null;
  refuse(`could not read GitHub Release ${tag}: ${result.stderr.trim()}`);
}
function releaseNotes(pkg) {
  const lines = read(`${pkg.path}/CHANGELOG.md`).split("\n");
  const notes = [];
  let selected = false;
  let fence = "";
  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker)
        fence = "";
    } else if (!fence && /^## \d+\.\d+\.\d+(?:[-+][\w.-]+)?\s*$/.test(line)) {
      if (selected) break;
      selected = line.trim() === `## ${pkg.version}`;
      continue;
    }
    if (selected) notes.push(line);
  }
  if (!notes.join("\n").trim()) refuse(`no changelog entry for ${pkg.name}@${pkg.version}`);
  return notes.join("\n").trim();
}
const releases = candidates.map((pkg) => {
  const tag = `${pkg.name}@${pkg.version}`;
  const notes = releaseNotes(pkg);
  const existing = githubRelease(tag);
  if (existing && (existing.tag_name !== tag || existing.draft || existing.body?.trim() !== notes))
    refuse(`GitHub Release ${tag} differs from the prepared release`);
  return { tag, notes, existing };
});
for (const pkg of candidates) {
  const tag = `${pkg.name}@${pkg.version}`;
  for (const target of [remoteTarget(tag), localTarget(tag)]) {
    if (target && target !== head) refuse(`${tag} already points to another commit`);
  }
}
if (candidates.some((pkg) => !published(pkg))) {
  run("mise", ["run", "build"]);
  if (capture("git", ["status", "--porcelain"])) refuse("the build changed the worktree");
  run("pnpm", [
    "publish",
    "-r",
    ...candidates.flatMap((pkg) => ["--filter", pkg.name]),
    "--access",
    "public",
    "--no-git-checks",
    `--registry=${registry}`,
  ]);
}
for (const pkg of candidates) {
  const tag = `${pkg.name}@${pkg.version}`;
  if (!published(pkg)) refuse(`${tag} is not available from npm`);
  const target = remoteTarget(tag);
  if (target === head) continue;
  if (target) refuse(`${tag} already points to another commit`);
  if (!localTarget(tag)) run("git", ["tag", "-a", tag, "-m", tag, head]);
  run("git", ["push", "--no-follow-tags", "origin", `refs/tags/${tag}`]);
  if (remoteTarget(tag) !== head) refuse(`${tag} is not on origin`);
}
for (const { tag, notes, existing } of releases) {
  if (existing) continue;
  execFileSync(
    "gh",
    [
      "release",
      "create",
      tag,
      "--repo",
      "azohra/meteo",
      "--verify-tag",
      "--title",
      tag,
      "--notes-file",
      "-",
      "--latest=false",
    ],
    {
      input: notes,
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
  const created = githubRelease(tag);
  if (!created || created.draft || created.tag_name !== tag || created.body?.trim() !== notes)
    refuse(`GitHub Release ${tag} was not verified`);
}
console.log(
  `Released ${candidates.map((pkg) => `${pkg.name}@${pkg.version}`).join(", ")} at ${head}`,
);
