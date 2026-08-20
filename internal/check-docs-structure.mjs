import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { proseLines, renderedProseLines, walk } from "./lib/prose-files.mjs";

/* Structural checks on the documentation: sidebar shape, labels,
   orphans, and prose conventions. */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* One sidebar section per capability, plus Start here. A new capability
   adds its row here in the same change that adds its docs/ symlink. */
const SECTIONS = {
  Briefing: "briefing",
  Forecast: "forecast",
  Station: "station",
  GRIB: "grib",
  "JPEG 2000": "j2k",
  Core: "core",
};
const START_HERE = "Start here";

/* Label/title divergence is allowed only by declaration, so shorthand is a
   conscious choice instead of drift. Keys are slugs; values are the exact
   sidebar labels allowed to differ from the page title. */
const DECLARED_LABELS = new Map([
  ["docs", "Project overview"],
  ["docs/briefing", "The read side"],
  ["docs/briefing/contract", "Contract"],
  ["docs/briefing/transport", "Transport"],
  ["docs/briefing/derive", "Pure derivations"],
  ["docs/briefing/analyze", "Analyze a profile"],
  ["docs/briefing/compare", "Compare profiles"],
  ["docs/briefing/history", "History and convergence"],
  ["docs/briefing/profile-document", "Profile"],
  ["docs/briefing/site-context-document", "Site context"],
  ["docs/briefing/manifest", "Manifest"],
  ["docs/briefing/catalogue", "Model catalogue"],
  ["docs/briefing/run-an-ingest", "Run an ingest"],
  ["docs/briefing/scene", "Scene graph"],
  ["docs/briefing/svg", "SVG renderer and key"],
  ["docs/briefing/versioning", "Package versioning"],
  ["docs/forecast", "Engine and CLI"],
  ["docs/station", "Live station display"],
  ["docs/station/adapters", "How adapters work"],
  ["docs/grib", "GRIB2 in pure TypeScript"],
  ["docs/grib/coverage", "What it decodes"],
  ["docs/grib/correctness", "The ecCodes gate"],
  ["docs/grib/jpeg2000", "JPEG 2000 and the pool"],
  ["docs/j2k", "A T.800 decoder in TypeScript"],
  ["docs/j2k/subset", "The subset"],
  ["docs/j2k/correctness", "Correctness"],
  ["docs/j2k/performance", "Performance"],
  ["docs/core", "The shared foundation"],
  ["docs/core/conventions", "Units, angles, one wind sign"],
  ["docs/forecast/model-capabilities", "Model capabilities"],
  ["docs/station/client-data", "Client data"],
  ["docs/station/climatology", "Climatology"],
  ["docs/station/wire-contract", "Wire contract"],
]);

/* Vocabulary the 2026-08 audit retired. A hit outside a code fence is a
   regression, not a style choice. */
const RETIRED_VOCABULARY = [
  [/\bdownstream publisher/i, 'say "operator" — one word, two hats (glossary)'],
  [/\bwire v[12]\b/i, 'say "schemaVersion 1/2" — Compatibility defines it'],
  [/\bstatic history profile\b/i, '"profile" is the document; say history is on by default'],
  [/\bterrain catalogue\b/i, "site-context.json is measured context, not a catalogue"],
  [/\bAuthority by quantity\b/, 'the section is named "Who owns each value"'],
];

/* Optional style lane: rejected-phrase patterns from repo git config
   (`git config --add meteo.styleDeny <regex>`), matched case-insensitively
   against prose lines. No config entries, no lane. */
const styleDeny = (() => {
  try {
    const out = execSync("git config --get-all meteo.styleDeny", {
      cwd: repoRoot,
      encoding: "utf-8",
    });
    return out
      .split("\n")
      .filter(Boolean)
      .map((source) => new RegExp(source, "i"));
  } catch {
    return [];
  }
})();

/* Hand-typed schema versions drift (the about figure shipped a retired 1);
   prose renders the imported constant instead. Fenced samples are wire
   documents and keep their literal values. */
const HAND_TYPED_VERSION =
  /(_SCHEMA_VERSION`?\s*\(\d\)|schemaVersion: \d\b|schemaVersion`? is `?\d\b)/;

const failures = [];
function fail(file, message) {
  failures.push(`${file}: ${message}`);
}

const sidebarModule = await import(
  pathToFileURL(join(repoRoot, "site", "src", "lib", "sidebar.mjs")).href
);
const sidebar = sidebarModule.sidebar;

/* ── shape: Start here + one section per capability ─────────────────── */
const labels = sidebar.map((section) => section.label);
if (labels[0] !== START_HERE) fail("sidebar.mjs", `first section must be "${START_HERE}"`);
for (const label of labels.slice(1)) {
  if (!(label in SECTIONS)) fail("sidebar.mjs", `unknown top-level section "${label}"`);
}
for (const label of Object.keys(SECTIONS)) {
  if (!labels.includes(label)) fail("sidebar.mjs", `capability section "${label}" is missing`);
}

/* ── collect every sidebar leaf, in order, per section ──────────────── */
function leaves(items, out) {
  for (const item of items) {
    if (item.items) leaves(item.items, out);
    else out.push(item);
  }
  return out;
}

function pageFile(slug) {
  const parts = slug.split("/");
  let base;
  if (parts.length === 1 || !Object.values(SECTIONS).includes(parts[1])) {
    base = join(repoRoot, "site", "src", "content", "docs", "docs", ...parts.slice(1));
  } else {
    base = join(repoRoot, parts[1], "docs", ...parts.slice(2));
  }
  for (const candidate of [
    `${base}.md`,
    `${base}.mdx`,
    join(base, "index.md"),
    join(base, "index.mdx"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const seen = new Map();
for (const section of sidebar) {
  const items = leaves(section.items, []);
  if (items.length === 0) {
    fail("sidebar.mjs", `section "${section.label}" has no pages`);
    continue;
  }
  const expectedRoot = section.label === START_HERE ? "docs" : `docs/${SECTIONS[section.label]}`;
  if (items[0].slug !== expectedRoot) {
    fail(
      "sidebar.mjs",
      `section "${section.label}" must open with ${expectedRoot}, not ${items[0].slug}`,
    );
  }
  for (const item of items) {
    if (seen.has(item.slug)) fail("sidebar.mjs", `slug ${item.slug} appears twice`);
    seen.set(item.slug, item.label);
    if (section.label !== START_HERE && !item.slug.startsWith(`${expectedRoot}`)) {
      fail(
        "sidebar.mjs",
        `${item.slug} sits in section "${section.label}" outside ${expectedRoot}/`,
      );
    }
    const file = pageFile(item.slug);
    if (!file) {
      fail("sidebar.mjs", `slug ${item.slug} resolves to no page file`);
      continue;
    }
    const head = readFileSync(file, "utf-8").slice(0, 2048);
    const title = head.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1];
    if (!title) {
      fail(relative(repoRoot, file), "no frontmatter title");
    } else if (item.label !== title && DECLARED_LABELS.get(item.slug) !== item.label) {
      fail(
        relative(repoRoot, file),
        `sidebar label "${item.label}" != title "${title}" and is not declared in check-docs-structure.mjs`,
      );
    }
  }
}

/* ── orphans: every docs page is in the sidebar ─────────────────────── */
/* Committed figures sit beside the pages; they are assets, not pages. */
const walkPages = (dir) => walk(dir, [".md", ".mdx"], [], { skip: ["figures"] });

const roots = [
  ["docs", join(repoRoot, "site", "src", "content", "docs", "docs")],
  ...Object.values(SECTIONS).map((dir) => [`docs/${dir}`, join(repoRoot, dir, "docs")]),
];
for (const [slugRoot, dir] of roots) {
  for (const file of walkPages(dir)) {
    const rel = relative(dir, file).replace(/\.mdx?$/, "");
    const slug = rel === "index" ? slugRoot : `${slugRoot}/${rel}`;
    /* Package docs are symlinked into the site tree; skip the mirror copies. */
    if (
      slugRoot === "docs" &&
      Object.values(SECTIONS).some((d) => rel === d || rel.startsWith(`${d}/`))
    ) {
      continue;
    }
    if (!seen.has(slug)) fail(relative(repoRoot, file), `page has no sidebar entry (${slug})`);
  }
}

/* ── prose conventions: retired vocabulary, hand-typed versions ─────── */
for (const [, dir] of roots.slice(1)) {
  for (const file of walkPages(dir)) checkProse(file);
}
for (const file of walkPages(join(repoRoot, "site", "src", "content", "logbook"))) {
  checkProse(file);
}
for (const file of walkPages(join(repoRoot, "site", "src", "content", "docs", "docs"))) {
  const rel = relative(join(repoRoot, "site", "src", "content", "docs", "docs"), file);
  if (!Object.values(SECTIONS).some((d) => rel.startsWith(`${d}/`) || rel === d)) checkProse(file);
}

for (const dir of [
  join(repoRoot, "site", "src", "components"),
  join(repoRoot, "site", "src", "pages"),
]) {
  for (const file of walk(dir, [".astro", ".mdx"])) {
    checkProse(file, renderedProseLines);
  }
}

function checkProse(file, extract = (_file, text) => proseLines(text)) {
  const text = readFileSync(file, "utf-8");
  for (const [line, content] of extract(file, text)) {
    for (const [pattern, advice] of RETIRED_VOCABULARY) {
      if (pattern.test(content)) {
        fail(`${relative(repoRoot, file)}:${line}`, `retired vocabulary ${pattern} — ${advice}`);
      }
    }
    for (const pattern of styleDeny) {
      if (pattern.test(content)) {
        fail(`${relative(repoRoot, file)}:${line}`, `rejected phrase ${pattern} (meteo.styleDeny)`);
      }
    }
    if (HAND_TYPED_VERSION.test(content)) {
      fail(
        `${relative(repoRoot, file)}:${line}`,
        "hand-typed schema version in prose — render the imported constant instead",
      );
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  console.error(`\ncheck-docs-structure: ${failures.length} failure(s)`);
  process.exit(2);
}
console.log(
  `check-docs-structure: ${seen.size} sidebar pages verified — sections, order, labels, orphans, and prose conventions hold`,
);
