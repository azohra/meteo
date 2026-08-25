import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ignoredLine, proseLines, walk, workspaceReadmes } from "./lib/prose-files.mjs";

/* Straight quotes are the convention: the 2026-08 sweep normalized the
   corpus and this keeps curly characters out of every reader-facing
   source, package docs included. Code fences are skipped. A legitimate
   literal use (quoting a source verbatim) opts out with
   `meteo-prose: ignore` on the same or preceding line. */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IGNORE_MARKER = "meteo-prose: ignore";

const CURLY_PATTERN = /[‘’“”]/g;

const files = [];
walk(join(repoRoot, "site", "src", "content"), [".md", ".mdx"], files);
walk(join(repoRoot, "site", "src", "components"), [".astro", ".mdx"], files);
walk(join(repoRoot, "site", "src", "pages"), [".astro"], files);
files.push(...workspaceReadmes(repoRoot));
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
  }
  if (errors.length > 0) {
    failedFiles += 1;
    console.error(`FAIL ${relative(repoRoot, file)}`);
    for (const error of errors) console.error(`     ${error}`);
  }
}

if (failedFiles > 0) {
  console.error(`\ncheck-quotes: violations in ${failedFiles} file(s)`);
  process.exit(1);
}
console.log(`check-quotes: ${files.length} files hold the straight-quote convention`);
