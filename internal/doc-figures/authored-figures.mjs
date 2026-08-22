import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { frame } from "./page-figures.mjs";

/* Authored figures are drawn as standalone SVG bodies in authored/ (with
   the diagram-design tool; `.diagram-design` at the repo root binds its
   azohra-meteo brand profile) and normalized here into the
   same committed artifact the composed figures produce: chrome colors become
   var(--meteo-gram-*) tokens with light fallbacks, the house frame supplies
   title, lesson, caption, and units, and the generator outlines text. The
   accent family stays a resolved literal — it pairs with itself, not with
   the page theme. A source may use only the colors named below; anything
   else fails the build rather than shipping an untokenized pigment. */

const authoredDir = join(dirname(fileURLToPath(import.meta.url)), "authored");

const CHROME = {
  "#fffdf8": "surface",
  "#f2f4f1": "strip-bg",
  "#152529": "ink",
  "#2f454a": "ink-soft",
  "#40565a": "ink-mute",
  "#776956": "rule",
};

const CHROME_BY_TRIPLET = new Map(
  Object.keys(CHROME).map((hex) => [
    [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(","),
    hex,
  ]),
);

const ACCENT_LITERALS = new Set(["#913b0c", "#743008", "#f2dcc1"]);
const ACCENT_TRIPLET = "145,59,12";

const chromeVar = (hex) => `var(--meteo-gram-${CHROME[hex]}, ${hex})`;

function normalizeAuthoredBody(sourcePath, idPrefix) {
  const raw = readFileSync(sourcePath, "utf8").trim();

  const openTag = /^<svg\b[^>]*>/.exec(raw);
  if (!openTag || !raw.endsWith("</svg>")) {
    throw new Error(`${sourcePath}: authored figure must be a single-root <svg> document`);
  }
  const viewBox = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(openTag[0]);
  if (!viewBox) throw new Error(`${sourcePath}: authored figure needs a 0 0 W H viewBox`);
  const body = raw.slice(openTag[0].length, -"</svg>".length);

  for (const [pattern, why] of [
    [/<(title|desc)\b/, "title and desc belong to the figure registry, not the source"],
    [/<script\b/, "no script"],
    [/\b(width|height)="[\d.]+%"/, "percentage sizes escape the frame; use viewBox units"],
    [/href="(?!#)/, "no external references"],
    [/(?<![-\w])style="/, "use presentation attributes, not style attributes"],
    [/<tspan\b/, "the outliner takes one <text> per line, not tspans"],
  ]) {
    if (pattern.test(body)) throw new Error(`${sourcePath}: ${why}`);
  }

  for (const [, id] of body.matchAll(/\bid="([^"]+)"/g)) {
    if (!id.startsWith(idPrefix)) {
      throw new Error(`${sourcePath}: id "${id}" must carry the "${idPrefix}" prefix`);
    }
  }
  for (const [, family] of body.matchAll(/font-family="([^"]+)"/g)) {
    if (!/IBM Plex Sans|IBM Plex Mono|Big Shoulders/.test(family)) {
      throw new Error(`${sourcePath}: unsupported font family "${family}"`);
    }
  }
  for (const [literal] of body.matchAll(/(?<!&)#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)) {
    if (literal.startsWith("#")) {
      const hex = literal.toLowerCase();
      if (!(hex in CHROME) && !ACCENT_LITERALS.has(hex)) {
        throw new Error(`${sourcePath}: color ${literal} is outside the figure palette`);
      }
      continue;
    }
    const triplet = /rgba?\((\d+),\s*(\d+),\s*(\d+)/
      .exec(literal)
      .slice(1, 4)
      .map(Number)
      .join(",");
    if (!CHROME_BY_TRIPLET.has(triplet) && triplet !== ACCENT_TRIPLET) {
      throw new Error(`${sourcePath}: color ${literal} is outside the figure palette`);
    }
  }

  /* rgba() chrome tints become token + *-opacity so the alpha follows the
     themed color; accent rgba() stays literal like the other accent inks. */
  let tokenized = body.replace(
    /\b(fill|stroke)="rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)"/g,
    (whole, attribute, r, g, b, alpha) => {
      const hex = CHROME_BY_TRIPLET.get(`${r},${g},${b}`);
      if (!hex) return whole;
      return `${attribute}="${chromeVar(hex)}" ${attribute}-opacity="${alpha}"`;
    },
  );
  for (const hex of Object.keys(CHROME)) {
    tokenized = tokenized.replaceAll(`"${hex}"`, `"${chromeVar(hex)}"`);
  }
  return { body: tokenized, bodyWidth: Number(viewBox[1]), bodyHeight: Number(viewBox[2]) };
}

function authoredTarget({ id, file, source, idPrefix, ...frameText }) {
  return {
    id,
    file,
    compose: () => {
      const { body, bodyWidth, bodyHeight } = normalizeAuthoredBody(
        join(authoredDir, source),
        idPrefix,
      );
      return frame({ id: source.replace(/\.svg$/, ""), ...frameText, bodyWidth, bodyHeight, body });
    },
  };
}

export const AUTHORED_FIGURE_TARGETS = [
  authoredTarget({
    id: "docs-publication-flow",
    file: "forecast/docs/figures/publication-flow.svg",
    source: "publication-flow.svg",
    idPrefix: "pubflow-",
    title: "Publication flow from model cycle to browser",
    lesson:
      "A run is published only after completeness and derivation checks, then read as static files.",
    description:
      "A five-stage sequence across three actors: an upstream provider publishes a forecast cycle; the forecast engine probes completeness, builds each model, and publishes once across the static-dataset boundary; the browser reads manifest and profile and exposes a torn pair as stale.",
    caption:
      "Builders complete independently. Each polling cycle publishes every finished model update once; consumers compare independently cached static files and choose their own stale-pair policy.",
    units: "ordered stages; no numeric scale",
  }),
  authoredTarget({
    id: "docs-publication-protocol",
    file: "forecast/docs/figures/publication-protocol.svg",
    source: "publication-protocol.svg",
    idPrefix: "pf-",
    title: "The publication protocol",
    lesson:
      "Static files have no transactions; a strict upload order and a reader-side pair check replace them.",
    description:
      "A sequence diagram across four actors — the upstream provider, the forecast job, the static dataset, and the reader's browser. The build phase resolves and fetches one run; the publish phase uploads history, site documents, the manifest as the commit point, and runs.json in that order, with a read-back check; the read phase shows the browser fetching manifest and profile in a retry loop that treats a disagreeing pair as stale.",
    caption:
      "Everything the manifest references is uploaded before it, so a crash mid-publish never exposes a half-run; runs.json is regenerated last from the published manifests. The reader verifies the manifest and profile name the same run, retries a torn pair once, and flags it stale rather than rendering a blend.",
    units: "time flows downward; no numeric scale",
  }),
];
