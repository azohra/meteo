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

export function normalizeAuthoredBody(sourcePath, idPrefix) {
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
  authoredTarget({
    id: "docs-platform-boundary",
    file: "site/src/content/docs/docs/figures/platform-boundary.svg",
    source: "platform-boundary.svg",
    idPrefix: "platb-",
    title: "Responsibility by layer",
    lesson:
      "An engine publishes versioned JSON; packages read what it published. Station reads live hardware over its own wire and never crosses that boundary.",
    description:
      "Two lanes flow left to right into the operator. A tall tinted band — the versioned JSON documents: manifest, site profiles, month archives, site context — stands as a wall across the top lane: provider model files decode through the grib and j2k packages, the forecast engine publishes through the wall, and the briefing package reads on the far side. The wall stops above the bottom lane, where weather-station hardware feeds the station package over one long wire that passes beneath it, marked never crosses. Both lanes end at the operator column on the right, and a dashed bar beneath the lanes marks the core package's shared vocabulary imported by briefing and station.",
    caption:
      "Every layer runs on infrastructure its operator controls. The versioned documents are the data boundary between publisher and consumer; the operator owns everything their readers see around them.",
    units: "layer diagram; no numeric scale",
  }),
  authoredTarget({
    id: "docs-torn-read",
    file: "briefing/docs/figures/torn-read.svg",
    source: "torn-read.svg",
    idPrefix: "torn-",
    title: "Two cache entries, two runs, one page",
    lesson:
      "Independently cached manifest and profile files can describe different runs; loadForecast detects the torn pair and retries it once.",
    description:
      "A sequence diagram of the transport's reference-time skew dance, with three lifelines: the loadForecast consumer and the two independently cached static files, the model manifest and the site profile. A publish refreshes the manifest cache entry before the profile cache entry, so the parallel fetch returns a manifest from the 06Z run and a profile from the 00Z run. loadForecast compares the pair's reference times with runsConsistent, waits 1.5 seconds inside a single retry frame, refetches the pair once, and a bottom row lists every resolution: a consistent pair to render, the freshest complete pair marked stale, or a discriminated DocumentMiss.",
    caption:
      "The retry delay defaults to 1500 ms and is injectable. The transport keeps no cache and writes no storage: the stale flag is a report, and the policy it triggers belongs to the caller.",
    units: "one publish cycle; no numeric scale",
  }),
  authoredTarget({
    id: "docs-pointer-states",
    file: "briefing/docs/figures/pointer-states.svg",
    source: "pointer-states.svg",
    idPrefix: "ptr-",
    title: "Preview, pin, and the touch policy",
    lesson:
      "The state machine is small and consumer-owned; the package supplies the pure queries its transitions call.",
    description:
      "A three-state machine on two tiers. Resting and Previewing sit side by side on top: pointer movement with a non-touch pointer moves right into Previewing, and leaving the chart returns to Resting. Both drop to the accented Pinned state below on a click or tap; the edge from Resting notes that a touch pointer pins without previewing. From Pinned, clicking the pinned target again or Escape climbs back to Resting, a small self-loop marks re-pinning, and a dashed edge exits to a model or day swap, where the consumer chooses reset or carry by validAt.",
    caption:
      "Touch pointers skip the Previewing state: a finger cannot hover, so a tap pins directly. The swap edge is the carry-or-reset decision: key the stored selection by validAt and re-resolve it with hourIndexForValidAt, or reset, as the measured first consumer does.",
  }),
  authoredTarget({
    id: "docs-observation-quality-gate",
    file: "briefing/docs/figures/observation-quality-gate.svg",
    source: "observation-quality-gate.svg",
    idPrefix: "oqg-",
    title: "Two products, one quality gate",
    lesson:
      "DSR and AOD ride the same grid and the same fill code, but their fill and DQF semantics disagree: DSR's fill hides inside valid_range and its binary DQF flags night as good, while AOD's fill separates cleanly under a graded DQF. The builder trusts neither shortcut and gates both on unmasked AND quality, publishing a nonzero accepted DQF as the entry's quality label.",
    description:
      "A comparison grid holding the GOES-18 DSR and AOD product semantics side by side, with shared row labels between the two product columns: the uint16 codes, the DQF states, and what a night pixel arrives as. Column A, DSR (ABI-L2-DSRF, W/m², scale 0.02289028): a uint16 number line whose valid_range spans 0 to 65535, so the fill value 65535 sits inside it and range checks cannot separate fill from data; the physical span is 0 to 1500 W/m². Its DQF row shows two solid published states, 0 good and 1 degraded/invalid labelled quality: 1, plus a dashed 255 space chip; the gate note reads codes 0 and 1 publish, degraded labelled. Its night pixel arrives as fill with DQF 0, highlighted as the trap: DQF 0 does not imply a retrieval. Column B, AOD (ABI-L2-AODF, at 550 nm, scale 7.706e-5, offset -0.05): the same number line, but valid_range [0, 65530] ends short of the fill value, which sits just outside it, so range masking alone separates fill from data; the physical span is -0.05 to +5.0. Its DQF row is graded: solid published chips 0 high and 1 medium labelled quality: 1, an outlined rejected 2 low, and a dashed 3 no retrieval; the gate note reads codes 0 and 1 publish, medium labelled. Its night pixel arrives as fill with DQF 3, the explicit no-retrieval flag DSR's night-fill-with-DQF-0 lacks. Arrows from both columns feed one full-width band beneath: one gate, both products, unmasked and quality; the builder applies the shared gate even where AOD's fill separates cleanly, since one code path can only reject more; a nonzero accepted DQF publishes as the entry's quality label, and anything that fails publishes as absence: never zero, never a guess.",
    caption:
      "Encodings, ranges, and DQF vocabularies are the product facts verified live from the granules on 2026-08-10 and recorded above; the number lines are schematic (codes are not drawn to scale). The gate is goes.ts's one code path for both datasets.",
    units: "uint16 codes, schematic scale · DSR W/m² · AOD dimensionless at 550 nm",
  }),
  authoredTarget({
    id: "docs-freshness-clocks",
    file: "station/docs/figures/freshness-clocks.svg",
    source: "freshness-clocks.svg",
    idPrefix: "fresh-",
    title: "Freshness across three clocks",
    lesson:
      "Freshness is judged on the client, but against the server's clock: the wire carries observedAt and servedAt, the client records receivedAtMs, and each subtraction stays inside one clock domain, so a wrong client clock cannot declare a live station stale, or a dead one live.",
    description:
      "Three swimlane bands (station, server, client) under a shared true-time UTC axis ticked every ten seconds, holding the four instants the freshness model reads. The station stamps observedAt 12:00:45Z; an arrow carries the reading to the server, which stamps the response servedAt 12:01:00Z; a second arrow carries the response to the client, which records receivedAtMs and later reads now, and its wall clock runs four minutes fast, printing 12:05:07 and 12:05:37 beside those two dots. Below the lanes, two measure brackets mark the age's two terms: servedAt minus observedAt is 15 seconds, both stamps riding the wire, and now minus receivedAtMs is 30 seconds, both read on the client. A verdict strip sums them: age 45 seconds, while the naive now minus observedAt on the fast client wall clock would read 4 minutes 52 seconds and misread a live station as stale. Two footer panels close the model: freshness() grades the age live to aging to stale, with every binding re-judging the same reading every 30 seconds between polls, and stationFreshnessThresholds() scales the cutoffs to the station's own cadence, so ten minutes of silence is routine for a five-minute logger and a dead feed for a three-second one.",
    caption:
      "The instants are schematic, but every printed number obeys the arithmetic it illustrates, including the deliberate four-minute client clock error the two-clock form cancels. freshness() and stationFreshnessThresholds() are exported from @azohra/meteo.station; the re-judge cadence is FRESHNESS_REEVALUATE_MS.",
    units: "wall-clock instants UTC · age seconds · client offset schematic",
  }),
  authoredTarget({
    id: "docs-convergence-ladder",
    file: "briefing/docs/figures/convergence-ladder.svg",
    source: "convergence-ladder.svg",
    idPrefix: "conv-",
    title: "The convergence ladder, settled beside unsettled",
    lesson:
      "compareRuns stacks successive runs of one model against one target local day; settled is arithmetic over the newest minRuns rungs' magnitudes: a statement about runs, not probability and not skill.",
    description:
      "Two five-rung convergence ladders for the same schematic target local day, newest run first, each rung labelled with its run reference time, its leadHours to the day's local-noon anchor (19 to 67 hours), and its vote, with every stated magnitude also plotted as a dot on the panel's shared magnitude scale so the spread is visible as distance. Left, a settled day: the newest three rungs vote window with magnitudes 1480, 1370, and 1520 m above launch, their dots huddled under a short bracket; spreadM = 1520 - 1370 = 150 m, narrower than the magnitudeBandM 300 ruler drawn at the same scale, so settled is true. Right, an unsettled day: window rungs at 1980 and 1420 m and a quiet rung at 990 m of depth scatter across the scale under a long bracket; spreadM = 1980 - 990 = 990 m, far wider than the same 300 m ruler, so settled is false. In both ladders a tinted band encloses only the newest minRuns = 3 rungs; an older rung sits plotted below the band, and the oldest rung is an abstention with the stated reason outOfHorizon and no magnitude. A four-row ledger beneath defines rungs, leadHours, settled, and the embedded thresholds.",
    caption:
      "Rung values are schematic (a structural diagram, not measured runs), but every printed number obeys the arithmetic it illustrates: leads step 12 hours for a twice-daily model against a local-noon anchor seven hours behind UTC, and each spreadM is max - min over its sample. minRuns 3 and magnitudeBandM 300 are the embedded defaults (DEFAULT_SETTLED_THRESHOLDS), trial values calibrated on a thin archive.",
    units:
      "leads hours · magnitudes m above launch (quiet rungs: m of depth) · schematic; no measured data",
  }),
  authoredTarget({
    id: "docs-ingest-loop",
    file: "briefing/docs/figures/ingest-loop.svg",
    source: "ingest-loop.svg",
    idPrefix: "ingest-",
    title: "The ingest loop returns to serving",
    lesson:
      "Five package-verb steps (poll, compare the identity pair, fetch the coherent set, refuse a syncing one, swap atomically) all return to one standing state: serve the newest coherent publication the store holds.",
    description:
      "A flowchart of the ingest loop with the happy path as a vertical spine. Step 1 polls runs.json with loadRuns (one small fetch; the poll is the subscription); step 2 compares each model's (referenceTime, generatedAt) identity pair against seen[slug] per model. An unchanged pair exits right to serving with nothing new this tick; a changed pair continues down to step 3, loadSiteSet, where the manifest is the commit point and per-site misses never poison the set. A set still mixed after one retry branches right to step 4, syncing: true (a publish mid-flight; runsSeen names the runs), which ingests nothing and drops to serving what the store already holds. A coherent set (syncing: false; one run anchors the whole set) continues down the spine to step 5, the atomic swap: store the set under its new referenceTime and advance seen[slug], and the new run becomes what you serve. Every path lands on the wide strip at the bottom, the standing state rather than a step: serving the newest coherent publication the store holds, the predecessor kept serving through syncing sets, late runs, and dead ticks, never a partially ingested run and never deleting on a miss. A dashed edge climbs from the strip back to step 1 on the next tick: your cadence, a small fraction of the fastest runIntervalHours you serve.",
    caption:
      "A later generatedAt for the same referenceTime is a corrected re-publication, and re-ingesting it is exactly as mandatory as a new run. loadSiteSet retries a mid-publish mix once before reporting syncing: true. How many predecessors to keep is retention: consumer policy, never a dataset property.",
    units: "one poll tick; no numeric scale",
  }),
];
