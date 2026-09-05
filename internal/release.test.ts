import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function fixture({ firstRelease = false, prepare = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "meteo-release-"));
  roots.push(root);
  const repo = join(root, "repo");
  const remote = join(root, "origin.git");
  const bin = join(root, "bin");
  const statePath = join(root, "state.json");
  mkdirSync(repo);
  mkdirSync(bin);
  mkdirSync(join(repo, "internal"));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "--bare", remote);
  git("init", "-b", "main");
  git("config", "user.name", "Release test");
  git("config", "user.email", "release@example.invalid");
  git("config", "core.hooksPath", join(root, "no-hooks"));
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgsign", "false");
  git("remote", "add", "origin", remote);
  copyFileSync(resolve("internal/release.mjs"), join(repo, "internal/release.mjs"));
  function manifest(version: string) {
    mkdirSync(join(repo, "core"), { recursive: true });
    writeFileSync(
      join(repo, "core/package.json"),
      JSON.stringify({ name: "@azohra/meteo.core", version }),
    );
  }
  manifest(firstRelease ? "1.1.0" : "1.0.0");
  if (prepare) {
    mkdirSync(join(repo, ".changeset"));
    writeFileSync(join(repo, ".changeset/change.md"), "fixture intent");
  }
  git("add", ".");
  git("commit", "-m", "Initial package");
  if (!prepare) {
    manifest("1.1.0");
    writeFileSync(
      join(repo, "internal/release-plan.json"),
      JSON.stringify([{ name: "@azohra/meteo.core", version: "1.1.0" }]),
    );
    git("add", ".");
    git("commit", "-m", "Version packages");
  }
  git("push", "-u", "origin", "main");
  const head = git("rev-parse", "HEAD");
  const initial = {
    versions: firstRelease ? [] : ["1.0.0"],
    calls: [] as string[],
    wrongRemote: false,
    wrongUser: false,
    dirtyCheck: false,
    failPublish: false,
    failPush: false,
  };
  writeFileSync(statePath, JSON.stringify(initial));
  const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const fake = `#!${process.execPath}
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const statePath = ${JSON.stringify(statePath)};
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
state.calls.push([command, ...args].join(' '));
const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
save();
if (command === 'git') {
  if (args[0] === 'remote' && args[1] === 'get-url') {
    console.log(state.wrongRemote ? 'https://github.com/someone/else.git' : 'https://github.com/azohra/meteo.git');
  } else {
    if (state.failPush && args[0] === 'push') process.exit(1);
    const result = cp.spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit' });
    process.exit(result.status ?? 1);
  }
} else if (command === 'gh') {
  console.log(JSON.stringify({ nameWithOwner: 'azohra/meteo', visibility: 'PUBLIC' }));
} else if (command === 'npm') {
  if (args[0] === 'whoami') console.log(state.wrongUser ? 'other' : 'azohra');
  else console.log(JSON.stringify(state.versions));
} else if (command === 'mise') {
  if (state.dirtyCheck) fs.writeFileSync('unexpected.txt', 'changed by proof');
} else if (command === 'pnpm') {
  if (args[0] === 'list') console.log(JSON.stringify([{ ...JSON.parse(fs.readFileSync('core/package.json')), path: path.resolve('core') }]));
  else if (args[0] === 'config') console.log('https://registry.npmjs.org/');
  else if (args[0] === 'version') {
    fs.writeFileSync('core/package.json', JSON.stringify({name: '@azohra/meteo.core', version: '1.1.0'}));
    fs.rmSync('.changeset/change.md');
  } else if (args[0] === 'publish') {
    state.versions.push('1.1.0'); save();
    if (state.failPublish) process.exit(1);
  } else process.exit(1);
} else process.exit(1);
`;
  for (const command of ["git", "gh", "npm", "pnpm", "mise"])
    writeFileSync(join(bin, command), fake, { mode: 0o755 });
  const state = () => JSON.parse(readFileSync(statePath, "utf8")) as typeof initial;
  const configure = (patch: Partial<typeof initial>) =>
    writeFileSync(statePath, JSON.stringify({ ...state(), ...patch }));
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ["internal/release.mjs", ...args], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, NPM_TOKEN: "fixture-only" },
    });
  const tag = "@azohra/meteo.core@1.1.0";
  return { repo, git, head, state, configure, run, tag };
}

function expectNoPublication(f: ReturnType<typeof fixture>) {
  expect(
    f.state().calls.some((call) => call.startsWith("pnpm publish") || call.startsWith("git push")),
  ).toBe(false);
}

describe("release boundaries", () => {
  it.each([false, true])(
    "prepares reviewable files without publishing (first release: %s)",
    (firstRelease) => {
      const f = fixture({ prepare: true, firstRelease });
      f.git("switch", "-c", "release-test");
      const result = f.run("--prepare");
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(readFileSync(join(f.repo, "internal/release-plan.json"), "utf8"))).toEqual([
        { name: "@azohra/meteo.core", version: "1.1.0" },
      ]);
      expect(f.git("rev-parse", "HEAD")).toBe(f.head);
      expectNoPublication(f);
      expect(f.state().calls.some((call) => call.startsWith("npm whoami"))).toBe(false);
    },
  );

  it("publishes the merged plan and only its tags, preserving main and unrelated local tags", () => {
    const f = fixture();
    f.git("tag", "-a", "unrelated", "-m", "Unrelated");
    f.git("config", "push.followTags", "true");
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    expect(f.git("ls-remote", "origin", "refs/heads/main")).toContain(f.head);
    expect(f.git("ls-remote", "origin", `refs/tags/${f.tag}^{}`)).toContain(f.head);
    expect(f.git("ls-remote", "origin", "refs/tags/unrelated")).toBe("");
    expect(f.git("status", "--porcelain")).toBe("");
  });

  it.each(["wrongRemote", "wrongUser", "dirtyCheck"] as const)(
    "refuses %s before publication",
    (flag) => {
      const f = fixture();
      f.configure({ [flag]: true });
      expect(f.run().status).not.toBe(0);
      expectNoPublication(f);
    },
  );

  it("refuses an unmerged release commit", () => {
    const f = fixture();
    f.git("reset", "--hard", "HEAD^");
    f.git("push", "--force", "origin", "main");
    f.git("checkout", "--detach", f.head);
    expect(f.run().status).not.toBe(0);
    expectNoPublication(f);
  });

  it("refuses a later code commit, but allows retrying the original release after main advances", () => {
    const f = fixture();
    f.git("commit", "--allow-empty", "-m", "Later change");
    f.git("push", "origin", "main");
    expect(f.run().status).not.toBe(0);
    expectNoPublication(f);
    f.git("checkout", "--detach", f.head);
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
  });

  it.each(["local conflict", "remote conflict", "remote lightweight"])(
    "refuses a %s before publication",
    (kind) => {
      const f = fixture();
      if (kind === "remote lightweight") f.git("tag", f.tag);
      else f.git("tag", "-a", f.tag, "HEAD^", "-m", "Existing tag");
      if (kind.startsWith("remote")) {
        f.git("push", "origin", `refs/tags/${f.tag}`);
        f.git("tag", "-d", f.tag);
      }
      expect(f.run().status).not.toBe(0);
      expectNoPublication(f);
    },
  );

  it.each(["failPublish", "failPush"] as const)(
    "recovers %s without reuploading or moving tags, including a first release",
    (flag) => {
      const f = fixture({ firstRelease: true });
      f.configure({ [flag]: true });
      expect(f.run().status).not.toBe(0);
      f.configure({ [flag]: false });
      const result = f.run();
      expect(result.status, result.stderr).toBe(0);
      expect(f.state().calls.filter((call) => call.startsWith("pnpm publish"))).toHaveLength(1);
      expect(f.git("ls-remote", "origin", `refs/tags/${f.tag}^{}`)).toContain(f.head);
    },
  );

  it.each(["unknown package", "wrong version", "duplicate"])("refuses a plan with %s", (kind) => {
    const f = fixture();
    const entry = { name: "@azohra/meteo.core", version: "1.1.0" };
    const plan =
      kind === "unknown package"
        ? [{ ...entry, name: "@other/package" }]
        : kind === "wrong version"
          ? [{ ...entry, version: "9.0.0" }]
          : [entry, entry];
    writeFileSync(join(f.repo, "internal/release-plan.json"), JSON.stringify(plan));
    f.git("add", ".");
    f.git("commit", "--amend", "--no-edit");
    f.git("push", "--force", "origin", "main");
    expect(f.run().status).not.toBe(0);
    expectNoPublication(f);
  });

  it("refuses pending intents even with a release plan", () => {
    const f = fixture();
    mkdirSync(join(f.repo, ".changeset"));
    writeFileSync(join(f.repo, ".changeset/pending.md"), "Pending change");
    f.git("add", ".");
    f.git("commit", "--amend", "--no-edit");
    f.git("push", "--force", "origin", "main");
    expect(f.run().status).not.toBe(0);
    expectNoPublication(f);
  });
});
