import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { parse } from "yaml";

const capture = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const base = capture("merge-base", process.env.CHANGE_BASE || "origin/main", "HEAD");
const changed = [
  ...new Set([
    ...capture("diff", "--name-only", base).split("\n"),
    ...capture("ls-files", "--others", "--exclude-standard").split("\n"),
  ]),
].filter(Boolean);
const packages = JSON.parse(
  execFileSync("pnpm", ["list", "-r", "--depth", "-1", "--json"], { encoding: "utf8" }),
).filter((pkg) => !pkg.private && pkg.name && pkg.version);
const intents = changed.filter(
  (file) => /^\.changeset\/[^/]+\.md$/.test(file) && !file.endsWith("/README.md"),
);
const recorded = new Set();
for (const file of intents) {
  // Deleted intents belong to release preparation, not new package changes.
  if (!existsSync(file)) continue;
  const text = readFileSync(file, "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match || !text.slice(match[0].length).trim())
    throw new Error(`${file} needs package impacts and a summary`);
  for (const [name, bump] of Object.entries(parse(match[1]) ?? {})) {
    if (!packages.some((pkg) => pkg.name === name))
      throw new Error(`${file}: unknown public package ${name}`);
    if (!["none", "patch", "minor", "major"].includes(bump))
      throw new Error(`${file}: invalid bump for ${name}`);
    recorded.add(name);
  }
}
for (const pkg of packages) {
  const dir = relative(process.cwd(), pkg.path);
  const files = changed.filter((file) => file.startsWith(`${dir}/`));
  if (!files.length || recorded.has(pkg.name)) continue;
  const prepared =
    changed.includes(".changeset/ledger.yaml") &&
    files.every((file) => file === `${dir}/package.json` || file === `${dir}/CHANGELOG.md`);
  if (!prepared)
    throw new Error(
      `${pkg.name} changed: record a pnpm change intent (use none when no release is needed)`,
    );
}
execFileSync("pnpm", ["version", "-r", "--dry-run", "--no-git-checks"], { stdio: "inherit" });
