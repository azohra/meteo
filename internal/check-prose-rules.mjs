import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/* The mechanically checkable slice of BRAND.md's voice rules: unsupported
   praise never survives review here ("easy", "seamless", "robust", …), so
   this gate holds that line across every reader-facing source. Judgment
   rules — the confidence rule, register, dates — stay with review; a gate
   that needs context would cry wolf. Code fences are skipped: "simple
   packing" is a GRIB2 packing type, not a claim. A legitimate literal use
   (quoting a source, naming a provider product) opts out with
   `meteo-prose: ignore` on the same or preceding line.

   The same pass holds the quote convention: straight quotes only — the
   2026-08 sweep normalized the corpus, and this keeps curly characters
   from creeping back in. The quote rule also covers package docs, which
   the praise gate leaves to review. */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IGNORE_MARKER = "meteo-prose: ignore";

/* Word-boundary, case-insensitive. BRAND.md's own list plus the same
   claim-words in adjacent forms. */
const BANNED = [
  "easy",
  "easier",
  "easiest",
  "effortless(?:ly)?",
  "simple",
  "simpler",
  "simplest",
  "powerful",
  "seamless(?:ly)?",
  "robust(?:ly)?",
  "best-in-class",
  "beautiful(?:ly)?",
  "world-class",
  "state-of-the-art",
  "cutting-edge",
  "blazing(?:ly)?",
];
const BANNED_PATTERN = new RegExp(`\\b(${BANNED.join("|")})\\b`, "gi");

/* Technical homonyms: the term is the claim's opposite — a name, not praise. */
const ALLOWED_PHRASES = [/simple packing/i, /simple and complex/i, /grib2? simple/i];

const CURLY_PATTERN = /[\u2018\u2019\u201C\u201D]/g;

function walk(dir, extensions, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (statSync(full).isDirectory()) walk(full, extensions, out);
    else if (extensions.some((extension) => entry.name.endsWith(extension))) out.push(full);
  }
}

const files = [];
walk(join(repoRoot, "site", "src", "content"), [".md", ".mdx"], files);
walk(join(repoRoot, "site", "src", "components"), [".astro", ".mdx"], files);
walk(join(repoRoot, "site", "src", "pages"), [".astro"], files);
for (const entry of readdirSync(repoRoot, { withFileTypes: true })) {
  const readme = join(repoRoot, entry.name, "README.md");
  if (entry.isDirectory() && !entry.name.startsWith(".") && existsSync(readme)) {
    files.push(readme);
  }
}
files.push(join(repoRoot, "README.md"));

const praiseFiles = new Set(files);
for (const pkg of ["briefing", "core", "forecast", "grib", "j2k", "station"]) {
  walk(join(repoRoot, pkg, "docs"), [".md", ".mdx"], files);
}

let failedFiles = 0;
for (const file of files) {
  const lines = readFileSync(file, "utf-8").split("\n");
  const errors = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*```/.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (lines[i].includes(IGNORE_MARKER) || (i > 0 && lines[i - 1].includes(IGNORE_MARKER))) {
      continue;
    }
    for (const match of lines[i].matchAll(CURLY_PATTERN)) {
      errors.push(
        `${relative(repoRoot, file)}:${i + 1}: "${match[0]}" — curly quote; straight quotes are the convention`,
      );
    }
    if (!praiseFiles.has(file)) continue;
    if (ALLOWED_PHRASES.some((phrase) => phrase.test(lines[i]))) continue;
    for (const match of lines[i].matchAll(BANNED_PATTERN)) {
      errors.push(`${relative(repoRoot, file)}:${i + 1}: "${match[0]}" — unsupported praise`);
    }
  }
  if (errors.length > 0) {
    failedFiles += 1;
    console.error(`FAIL ${relative(repoRoot, file)}`);
    for (const error of errors) console.error(`     ${error}`);
  }
}

if (failedFiles > 0) {
  console.error(`\ncheck-prose-rules: violations in ${failedFiles} file(s)`);
  process.exit(1);
}
console.log(`check-prose-rules: ${files.length} files carry no unsupported praise or curly quotes`);
