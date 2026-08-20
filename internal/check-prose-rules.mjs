import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ignoredLine, proseLines, walk, workspaceReadmes } from "./lib/prose-files.mjs";

/* The mechanically checkable slice of the voice rules: unsupported praise
   ("easy", "seamless", "robust", …) fails here across every reader-facing
   source. Judgment rules (the confidence rule, register, dates) stay with
   review. Code fences are skipped: "simple packing" is a GRIB2 packing
   type, not a claim. A legitimate literal use (quoting a source, naming a
   provider product) opts out with `meteo-prose: ignore` on the same or
   preceding line.

   The same pass enforces straight quotes; the 2026-08 sweep normalized
   the corpus and this keeps curly characters out. The quote rule also
   covers package docs, which the praise gate leaves to review. */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IGNORE_MARKER = "meteo-prose: ignore";

/* Word-boundary, case-insensitive. The voice doctrine's banned-praise
   list plus the same claim-words in adjacent forms. */
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

const files = [];
walk(join(repoRoot, "site", "src", "content"), [".md", ".mdx"], files);
walk(join(repoRoot, "site", "src", "components"), [".astro", ".mdx"], files);
walk(join(repoRoot, "site", "src", "pages"), [".astro"], files);
files.push(...workspaceReadmes(repoRoot));

const praiseFiles = new Set(files);
for (const pkg of ["briefing", "core", "forecast", "grib", "j2k", "station"]) {
  walk(join(repoRoot, pkg, "docs"), [".md", ".mdx"], files);
}

let failedFiles = 0;
for (const file of files) {
  const text = readFileSync(file, "utf-8");
  const lines = text.split("\n");
  const errors = [];
  for (const [lineNumber, line] of proseLines(text)) {
    if (ignoredLine(lines, lineNumber - 1, IGNORE_MARKER)) continue;
    for (const match of line.matchAll(CURLY_PATTERN)) {
      errors.push(
        `${relative(repoRoot, file)}:${lineNumber}: "${match[0]}" — curly quote; straight quotes are the convention`,
      );
    }
    if (!praiseFiles.has(file)) continue;
    if (ALLOWED_PHRASES.some((phrase) => phrase.test(line))) continue;
    for (const match of line.matchAll(BANNED_PATTERN)) {
      errors.push(`${relative(repoRoot, file)}:${lineNumber}: "${match[0]}" — unsupported praise`);
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
