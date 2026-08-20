import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ignoredLine, stripFences, walk, workspaceReadmes } from "./lib/prose-files.mjs";

/* Internal-link integrity for every reader-facing source: the docs
   collection (including the package-docs symlinks), the logbook, the
   narrative .astro/.mdx components, and the repository READMEs. Routes
   are derived from the same sources Astro derives them from — content
   files, pages, and public/ — so the gate needs no build and no network.
   External links are out of scope, except that meteo.azohra.com links
   are checked as the internal routes they are. */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IGNORE_MARKER = "meteo-doc-links: ignore";

/* ── Valid routes ────────────────────────────────────────────────────── */

const routes = new Set(["/"]);
// A route → the content file that renders it, for anchor validation.
const routeSources = new Map();

function addContentRoute(base, file, prefix) {
  const rel = relative(base, file).replace(/\.(mdx?|md)$/, "");
  const slug = rel.endsWith("/index") || rel === "index" ? rel.replace(/\/?index$/, "") : rel;
  const route = `${prefix}${slug === "" ? "" : `${slug}/`}`;
  routes.add(route);
  routeSources.set(route, file);
}

const docsRoot = join(repoRoot, "site", "src", "content", "docs");
const docFiles = [];
walk(docsRoot, [".md", ".mdx"], docFiles);
for (const file of docFiles) addContentRoute(docsRoot, file, "/");

const logbookRoot = join(repoRoot, "site", "src", "content", "logbook");
const logbookFiles = [];
walk(logbookRoot, [".md", ".mdx"], logbookFiles);
for (const file of logbookFiles) addContentRoute(logbookRoot, file, "/logbook/");

const pagesRoot = join(repoRoot, "site", "src", "pages");
const pageFiles = [];
walk(pagesRoot, [".astro"], pageFiles);
for (const file of pageFiles) {
  if (file.includes("[")) continue; // dynamic routes come from their collection
  const rel = relative(pagesRoot, file).replace(/\.astro$/, "");
  const slug = rel.endsWith("/index") || rel === "index" ? rel.replace(/\/?index$/, "") : rel;
  routes.add(`/${slug === "" ? "" : `${slug}/`}`);
}

const publicRoot = join(repoRoot, "site", "public");
const publicFiles = [];
walk(publicRoot, [""], publicFiles);
for (const file of publicFiles) routes.add(`/${relative(publicRoot, file)}`);

// Emitted at build time rather than derived from a source file: the sitemap
// integration's index, and the schema artifacts the astro:build:done hook
// copies in (checked by schemas:check, not here).
routes.add("/sitemap-index.xml");
const BUILD_EMITTED_PREFIXES = ["/schema/"];

/* ── Link extraction ─────────────────────────────────────────────────── */

/* Matches the target of a Markdown link and any href attribute; both forms
   appear in .mdx and .astro sources. */
const LINK_PATTERN = /\]\(([^)\s]+)\)|href=["']([^"']+)["']/g;

/* The github-slugger convention Starlight uses for heading anchors,
   approximated: drop punctuation, spaces become hyphens. */
function slugifyHeading(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/<[^>]*>/g, "")
    .replace(/[`*_]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

const anchorCache = new Map();
function anchorsOf(file) {
  if (anchorCache.has(file)) return anchorCache.get(file);
  const text = readFileSync(file, "utf-8");
  const anchors = new Set();
  for (const heading of stripFences(text).matchAll(/^#{1,6}\s+(.+)$/gm)) {
    anchors.add(slugifyHeading(heading[1]));
  }
  for (const id of text.matchAll(/\bid=["']([^"']+)["']/g)) anchors.add(id[1]);
  anchorCache.set(file, anchors);
  return anchors;
}

function checkTarget(target, sourceFile) {
  let link = target;
  if (link.startsWith("https://meteo.azohra.com")) {
    link = link.slice("https://meteo.azohra.com".length) || "/";
  }
  if (/^(https?:|mailto:|data:)/.test(link)) return null; // external: out of scope
  if (link.startsWith("#")) {
    const anchor = link.slice(1);
    return anchorsOf(sourceFile).has(anchor)
      ? null
      : `#${anchor} — no such heading or id in this file`;
  }
  if (!link.startsWith("/")) return null; // relative imports/srcs are the bundler's problem
  const [path, anchor] = link.split("#");
  if (BUILD_EMITTED_PREFIXES.some((prefix) => path.startsWith(prefix))) return null;
  const normalized = path.endsWith("/") || path.includes(".") ? path : `${path}/`;
  if (!routes.has(normalized)) return `${link} — no route or public file`;
  if (anchor) {
    const source = routeSources.get(normalized);
    if (source && !anchorsOf(source).has(anchor)) {
      return `${link} — route exists but anchor #${anchor} matches no heading or id`;
    }
  }
  return null;
}

/* ── Scan ────────────────────────────────────────────────────────────── */

const scanFiles = [...docFiles, ...logbookFiles];
walk(join(repoRoot, "site", "src", "components"), [".astro", ".mdx"], scanFiles);
walk(join(repoRoot, "site", "src", "layouts"), [".astro"], scanFiles);
scanFiles.push(...pageFiles, ...workspaceReadmes(repoRoot));

let failedFiles = 0;
let checked = 0;
for (const file of scanFiles) {
  const text = readFileSync(file, "utf-8");
  const lines = text.split("\n");
  const errors = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (ignoredLine(lines, i, IGNORE_MARKER)) continue;
    for (const match of lines[i].matchAll(LINK_PATTERN)) {
      const target = match[1] ?? match[2];
      checked += 1;
      const problem = checkTarget(target, file);
      if (problem) errors.push(`${relative(repoRoot, file)}:${i + 1}: ${problem}`);
    }
  }
  if (errors.length > 0) {
    failedFiles += 1;
    console.error(`FAIL ${relative(repoRoot, file)}`);
    for (const error of errors) console.error(`     ${error}`);
  }
}

if (failedFiles > 0) {
  console.error(`\ncheck-doc-links: broken links in ${failedFiles} file(s)`);
  process.exit(1);
}
console.log(`check-doc-links: ${checked} links resolve across ${scanFiles.length} files`);
