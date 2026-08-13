import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = repoRoot;
const IGNORE_MARKER = "meteo-doc-fence: ignore";

function fail(message) {
  console.error(`check-doc-fences: ${message}`);
  process.exit(2);
}

/* A Dirent reports isDirectory() === false for a symlinked directory, so the
   walk stat-follows symlinks to descend the committed docs symlinks. */
function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(md|mdx)$/.test(entry.name)) out.push(full);
  }
}

async function packageHomes() {
  const manifestModule = join(repoRoot, "dist", "capabilities.js");
  if (!existsSync(manifestModule)) {
    fail(`built capability manifest not found at ${manifestModule} — run: pnpm build`);
  }
  const { platformPackages } = await import(manifestModule);
  const homes = new Map(
    platformPackages().map(({ package: name, directory }) => [name, directory]),
  );
  for (const entry of readdirSync(repoRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }
    const manifestPath = join(repoRoot, entry.name, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    if (manifest.private || !manifest.name?.startsWith("@azohra/")) continue;
    if (!homes.has(manifest.name)) homes.set(manifest.name, entry.name);
  }
  return homes;
}

function defaultDocFiles(homes) {
  const files = [];
  walk(join(repoRoot, "site", "src", "content", "docs", "docs"), files);
  for (const directory of ["", ...homes.values()]) {
    const readme = join(repoRoot, directory, "README.md");
    if (existsSync(readme)) files.push(readme);
  }
  return files;
}

function docFilesFromArgs(args) {
  const files = [];
  for (const arg of args) {
    const full = resolve(arg);
    if (!existsSync(full)) fail(`no such file or directory: ${arg}`);
    if (statSync(full).isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

function extractFences(text) {
  const lines = text.split("\n");
  const fences = [];
  let ignored = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const open = lines[i].match(/^(\s*)```(\w+)/);
    if (!open) continue;
    const indent = open[1];
    const language = open[2].toLowerCase();
    let close = i + 1;
    while (close < lines.length && !/^\s*```\s*$/.test(lines[close])) close += 1;
    if (language === "ts" || language === "typescript") {
      let previous = i - 1;
      while (previous >= 0 && lines[previous].trim() === "") previous -= 1;
      if (previous >= 0 && lines[previous].includes(IGNORE_MARKER)) {
        ignored += 1;
      } else {
        const body = lines
          .slice(i + 1, close)
          .map((line) => (indent && line.startsWith(indent) ? line.slice(indent.length) : line))
          .join("\n");
        fences.push({ openLine: i + 1, body });
      }
    }
    i = close;
  }
  return { fences, ignored };
}

const homes = await packageHomes();
const docFiles =
  process.argv.length > 2 ? docFilesFromArgs(process.argv.slice(2)) : defaultDocFiles(homes);
if (docFiles.length === 0) fail("no documentation files to scan");

const distMarker = join(repoRoot, "briefing", "dist", "contract.d.ts");
if (!existsSync(distMarker)) {
  fail(`built package types not found at ${distMarker} — run: pnpm build`);
}

// The temp project lives under the package's node_modules so tsc's upward
// walk finds the workspace root node_modules/@types (for `types: ["node"]`).
const tempDir = join(packageDir, "node_modules", ".cache", "meteo-doc-fences");
rmSync(tempDir, { recursive: true, force: true });
mkdirSync(tempDir, { recursive: true });

const sources = new Map();
const perFile = new Map();

for (const docFile of docFiles) {
  const { fences, ignored } = extractFences(readFileSync(docFile, "utf-8"));
  perFile.set(docFile, { fences: fences.length, ignored, errors: [] });
  for (const fence of fences) {
    const slug = relative(repoRoot, docFile)
      .replace(/[^A-Za-z0-9-]+/g, "__")
      .replace(/^_+/, "");
    const basename = `${slug}.L${fence.openLine}.ts`;
    const needsModuleMarker = !/^\s*(import|export)\b/m.test(fence.body);
    writeFileSync(
      join(tempDir, basename),
      needsModuleMarker ? `${fence.body}\nexport {};\n` : fence.body,
    );
    sources.set(basename, { docFile, openLine: fence.openLine });
  }
}

const tsconfig = {
  compilerOptions: {
    target: "es2022",
    module: "es2022",
    moduleResolution: "bundler",
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: ["node"],
    lib: ["es2022"],
    baseUrl: ".",
    // Flat subpaths (dist/*.d.ts) resolve before dist/*/index.d.ts so a
    // stale directory ghost can never shadow them.
    paths: Object.fromEntries(
      [...homes].flatMap(([name, directory]) => {
        const dist = join(repoRoot, directory, "dist");
        return [
          [name, [join(dist, "index.d.ts")]],
          [`${name}/*`, [join(dist, "*.d.ts"), join(dist, "*", "index.d.ts")]],
        ];
      }),
    ),
  },
  include: ["*.ts"],
};
writeFileSync(join(tempDir, "tsconfig.json"), `${JSON.stringify(tsconfig, null, 2)}\n`);

const requireFromPackage = createRequire(join(packageDir, "package.json"));
const tscBin = requireFromPackage.resolve("typescript/bin/tsc");

const result = spawnSync(process.execPath, [tscBin, "-p", "tsconfig.json", "--pretty", "false"], {
  cwd: tempDir,
  encoding: "utf-8",
});
if (result.error) fail(`could not run tsc: ${result.error.message}`);

let unattributed = 0;
for (const line of `${result.stdout}\n${result.stderr}`.split("\n")) {
  const diagnostic = line.match(/^(.+\.ts)\((\d+),(\d+)\): (error TS\d+: .*)$/);
  if (!diagnostic) {
    if (/error TS\d+/.test(line) && line.trim() !== "") {
      console.error(line);
      unattributed += 1;
    }
    continue;
  }
  const source = sources.get(diagnostic[1]);
  if (!source) {
    console.error(line);
    unattributed += 1;
    continue;
  }
  const sourceLine = source.openLine + Number(diagnostic[2]);
  perFile
    .get(source.docFile)
    .errors.push(
      `${relative(repoRoot, source.docFile)}:${sourceLine}:${diagnostic[3]} ${diagnostic[4]}`,
    );
}

let failed = 0;
let checked = 0;
for (const [docFile, report] of perFile) {
  if (report.fences === 0 && report.ignored === 0) continue;
  checked += report.fences;
  const label = relative(repoRoot, docFile);
  const counts =
    `${report.fences} fence${report.fences === 1 ? "" : "s"}` +
    (report.ignored > 0 ? `, ${report.ignored} ignored` : "");
  if (report.errors.length === 0) {
    console.log(`ok   ${label} (${counts})`);
  } else {
    failed += 1;
    console.error(`FAIL ${label} (${counts})`);
    for (const error of report.errors) console.error(`     ${error}`);
  }
}

if (failed > 0 || unattributed > 0) {
  console.error(
    `\ncheck-doc-fences: type errors in ${failed} documentation file${failed === 1 ? "" : "s"}` +
      (unattributed > 0 ? ` (+${unattributed} unattributed diagnostics)` : ""),
  );
  process.exit(1);
}
console.log(`\ncheck-doc-fences: ${checked} fences compile against the built package`);
