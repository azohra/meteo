import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function fixture({ firstRelease = false } = {}) {
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
  copyFileSync(resolve("internal/check-changes.mjs"), join(repo, "internal/check-changes.mjs"));
  function manifest(version: string) {
    mkdirSync(join(repo, "core"), { recursive: true });
    writeFileSync(
      join(repo, "core/package.json"),
      JSON.stringify({ name: "@azohra/meteo.core", version }),
    );
  }
  manifest(firstRelease ? "1.1.0" : "1.0.0");
  git("add", ".");
  git("commit", "-m", "Initial package");
  manifest("1.1.0");
  const notes = "### Minor Changes\n\n- Keep **Markdown** and `code`.\n\n```md\n## 9.9.9\n```";
  writeFileSync(
    join(repo, "core/CHANGELOG.md"),
    `# Core\n\n## 1.1.0\n\n${notes}\n\n## 1.0.0\n\nOld notes.\n`,
  );
  mkdirSync(join(repo, ".changeset"));
  writeFileSync(
    join(repo, ".changeset/ledger.yaml"),
    JSON.stringify({
      "@azohra/meteo.core@1.1.0": { dir: "core", intents: ["change"] },
    }),
  );
  git("add", ".");
  git("commit", "-m", "chore: version packages");
  writeFileSync(join(repo, ".git/info/exclude"), "node_modules\n");
  symlinkSync(resolve("node_modules"), join(repo, "node_modules"), "dir");
  git("push", "-u", "origin", "main");
  const head = git("rev-parse", "HEAD");
  const initial = {
    versions: firstRelease ? [] : ["1.0.0"],
    calls: [] as string[],
    wrongRemote: false,
    dirtyBuild: false,
    failBuild: false,
    failPublish: false,
    failPush: false,
    failRelease: false,
    lostReply: false,
    githubError: false,
    release: null as null | { tag_name: string; body: string; draft: boolean },
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
  if (args[0] === 'api') {
    if (state.githubError) { process.stderr.write('HTTP 500'); process.exit(1); }
    if (!state.release) { process.stderr.write('HTTP 404'); process.exit(1); }
    console.log(JSON.stringify(state.release));
  } else if (args[0] === 'release' && args[1] === 'create') {
    if (state.failRelease) process.exit(1);
    state.release = { tag_name: args[2], body: fs.readFileSync(0, 'utf8'), draft: false }; save();
    if (state.lostReply) process.exit(1);
  } else process.exit(1);
} else if (command === 'npm') {
  const version = args[1].split("@").at(-1);
  if (state.versions.includes(version)) console.log(JSON.stringify(version));
  else { process.stderr.write("E404"); process.exit(1); }
} else if (command === 'mise') {
  if (state.failBuild) process.exit(1);
  if (state.dirtyBuild) fs.writeFileSync('unexpected.txt', 'changed by build');
} else if (command === 'pnpm') {
  if (args[0] === 'list') console.log(JSON.stringify([{ ...JSON.parse(fs.readFileSync('core/package.json')), path: path.resolve('core') }]));
  else if (args[0] === 'version') process.exit(0);
  else if (args[0] === 'publish') {
    state.versions.push('1.1.0'); save();
    if (state.failPublish) process.exit(1);
  } else process.exit(1);
} else process.exit(1);
`;
  for (const command of ["git", "npm", "pnpm", "mise", "gh"])
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
  const check = (base = "origin/main") =>
    spawnSync(process.execPath, ["internal/check-changes.mjs"], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, CHANGE_BASE: base, PATH: `${bin}:${process.env.PATH}` },
    });
  expect(git("status", "--porcelain")).toBe("");
  return { repo, git, head, state, configure, run, tag, check, notes };
}

function expectNoPublication(f: ReturnType<typeof fixture>) {
  expect(
    f.state().calls.some((call) => call.startsWith("pnpm publish") || call.startsWith("git push")),
  ).toBe(false);
}

describe("release boundaries", () => {
  it("publishes the merged versions and only its tags, preserving main and unrelated local tags", () => {
    const f = fixture();
    f.git("tag", "-a", "unrelated", "-m", "Unrelated");
    f.git("config", "push.followTags", "true");
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    expect(f.git("ls-remote", "origin", "refs/heads/main")).toContain(f.head);
    expect(f.git("ls-remote", "origin", `refs/tags/${f.tag}^{}`)).toContain(f.head);
    expect(f.git("ls-remote", "origin", "refs/tags/unrelated")).toBe("");
    expect(f.git("status", "--porcelain")).toBe("");
    const publish = f.state().calls.find((call) => call.startsWith("pnpm publish"));
    expect(publish).toContain("--filter @azohra/meteo.core");
    expect(publish).toContain("--access public");
    expect(publish).toContain("--registry=https://registry.npmjs.org/");
    expect(f.state().release).toEqual({ tag_name: f.tag, body: f.notes, draft: false });
    expect(f.state().calls.find((call) => call.startsWith("gh release create"))).toContain(
      "--verify-tag",
    );
  });

  it.each(["wrongRemote", "dirtyBuild", "failBuild"] as const)(
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

  it.each(["local conflict", "remote conflict"])("refuses a %s before publication", (kind) => {
    const f = fixture();
    f.git("tag", "-a", f.tag, "HEAD^", "-m", "Existing tag");
    if (kind.startsWith("remote")) {
      f.git("push", "origin", `refs/tags/${f.tag}`);
      f.git("tag", "-d", f.tag);
    }
    expect(f.run().status).not.toBe(0);
    expectNoPublication(f);
  });

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

  it("refuses a ledger entry that does not match the workspace", () => {
    const f = fixture();
    writeFileSync(
      join(f.repo, ".changeset/ledger.yaml"),
      JSON.stringify({
        "@other/package@1.0.0": { dir: "core", intents: ["change"] },
      }),
    );
    f.git("add", ".");
    f.git("commit", "--amend", "--no-edit");
    f.git("push", "--force", "origin", "main");
    expect(f.run().status).not.toBe(0);
    expectNoPublication(f);
  });

  it("includes a dependency-only version bump absent from the ledger", () => {
    const f = fixture();
    writeFileSync(join(f.repo, ".changeset/ledger.yaml"), "{}\n");
    f.git("add", ".");
    f.git("commit", "--amend", "--no-edit");
    f.git("push", "--force", "origin", "main");
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    expect(f.git("ls-remote", "origin", `refs/tags/${f.tag}^{}`)).toContain(
      f.git("rev-parse", "HEAD"),
    );
  });

  it("refuses pending intents alongside prepared versions", () => {
    const f = fixture();
    mkdirSync(join(f.repo, ".changeset"), { recursive: true });
    writeFileSync(join(f.repo, ".changeset/pending.md"), "Pending change");
    f.git("add", ".");
    f.git("commit", "--amend", "--no-edit");
    f.git("push", "--force", "origin", "main");
    expect(f.run().status).not.toBe(0);
    expectNoPublication(f);
  });
});

describe("GitHub Releases", () => {
  it.each(["failRelease", "lostReply"] as const)(
    "recovers %s without republishing packages or duplicating releases",
    (flag) => {
      const f = fixture();
      f.configure({ [flag]: true });
      expect(f.run().status).not.toBe(0);
      f.configure({ [flag]: false });
      const retry = f.run();
      expect(retry.status, retry.stderr).toBe(0);
      expect(f.state().release?.body).toBe(f.notes);
      expect(f.state().calls.filter((call) => call.startsWith("pnpm publish"))).toHaveLength(1);
      expect(f.state().calls.filter((call) => call.startsWith("gh release create"))).toHaveLength(
        flag === "lostReply" ? 1 : 2,
      );
    },
  );

  it("refuses conflicting notes and API failures before npm publication", () => {
    const f = fixture();
    f.configure({ release: { tag_name: f.tag, body: "Different notes", draft: false } });
    expect(f.run().status).not.toBe(0);
    expectNoPublication(f);
    f.configure({ release: null, githubError: true });
    expect(f.run().status).not.toBe(0);
    expectNoPublication(f);
  });

  it("refuses a missing changelog section before npm publication", () => {
    const f = fixture();
    writeFileSync(join(f.repo, "core/CHANGELOG.md"), "# Core\n\n## 1.0.0\n\nOld notes.\n");
    f.git("add", ".");
    f.git("commit", "--amend", "--no-edit");
    f.git("push", "--force", "origin", "main");
    expect(f.run().status).not.toBe(0);
    expectNoPublication(f);
  });
});

describe("PR package impacts", () => {
  it("requires an intent for package changes and accepts an untracked explicit decline", () => {
    const f = fixture();
    writeFileSync(join(f.repo, "core/example.ts"), "export const example = true;\n");
    expect(f.check().status).not.toBe(0);
    writeFileSync(
      join(f.repo, ".changeset/example.md"),
      '---\n"@azohra/meteo.core": none\n---\nTest fixture only.\n',
    );
    expect(f.check().status).toBe(0);
  });

  it("rejects unknown packages and empty summaries", () => {
    const f = fixture();
    for (const text of [
      '---\n"@other/package": patch\n---\nFix.\n',
      '---\n"@azohra/meteo.core": patch\n---\n',
    ]) {
      writeFileSync(join(f.repo, ".changeset/example.md"), text);
      expect(f.check().status).not.toBe(0);
    }
  });

  it("accepts generated release records but rejects code mixed into a release PR", () => {
    const f = fixture();
    expect(f.check("HEAD^").status).toBe(0);
    writeFileSync(join(f.repo, "core/example.ts"), "export const example = true;\n");
    expect(f.check("HEAD^").status).not.toBe(0);
  });
});
