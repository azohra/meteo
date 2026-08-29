import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { frame } from "./page-figures.mjs";

/* Authored figures are standalone SVG bodies in authored/. This module turns
   them into the same committed artifact the composed figures produce. Chrome
   colors become var(--meteo-gram-*) tokens with light fallbacks. The house frame
   supplies title, lesson, caption, and units, and the generator outlines text. The
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
  authoredTarget({
    id: "docs-builder-stage",
    file: "forecast/docs/figures/builder-stage.svg",
    source: "builder-stage.svg",
    idPrefix: "bstage-",
    title: "Module-owned steps inside the builder stage",
    lesson:
      "Provider bytes move through module-owned steps: gridpoint samples become source-shaped hours, deriveSiteForecast produces the derived values, and contract rounding plus validation fan out to the three published artifacts.",
    description:
      "A pipeline flowing top to bottom inside the builder stage. A configuration node, models.json plus sites.json, feeds a three-step row: provider transport owned by providers/transport.ts, gridpoint sampling owned by the datamart and NOAA clients with the grib decoder, and source-shaped hours assembled by the builders on their common skeletons. The hours descend to the accented deriveSiteForecast step in derive.ts, then to contract rounding and validation tests in publish.ts and builders/publication.ts, which fans out to the three published artifacts: the per-site profile under sites/, manifest.json, and the append-only monthly gzip history archive.",
    caption:
      "models.json and sites.json are configuration, passed explicitly, never held in ambient state. Each step names its owning module: one transport supplies the User-Agent, timeout, and download telemetry; the provider clients and the grib decoder fetch, decode, and sample; builders assemble source hours; derive.ts produces the published profile blocks and derived values; and publish.ts with builders/publication.ts rounds, writes, and appends — a builder never open-codes those writes.",
    units: "module-owned pipeline steps; no numeric scale",
  }),
  authoredTarget({
    id: "docs-sidecar-index",
    file: "briefing/docs/figures/sidecar-index.svg",
    source: "sidecar-index.svg",
    idPrefix: "sidx-",
    title: "The sidecar index places every member",
    lesson:
      "A month archive is concatenated independent gzip members whose boundaries only decompression reveals. The sidecar index states each member's byteOffset and byteLength, so a reader Range-fetches exactly the members it needs — here one run — without downloading or decompressing the month.",
    description:
      "A month history archive drawn as a horizontal bar of four concatenated gzip members, each starting with the gzip magic bytes 1f 8b, with byte offsets 0, 20991, 41449, and 63220 marked at the member boundaries and archiveLength 83325 at the end. Directly beneath, the sidecar index 2026-08.index.json lists one entry per member in archive order, each entry aligned under the member it places and carrying byteOffset, byteLength, lines, referenceTime, and generatedAt. A read row walks one read: a reader wants the 2026-08-12T06:00:00Z run, the accented entry 3 supplies byteOffset 41449 and byteLength 21771, the request sends Range: bytes=41449-63219, and the 206 response returns member 3 alone, split from its member boundary and gunzipped to one profile line; the other 61554 bytes never leave the server. Footer notes state that the index is recomputed from the archive bytes after every append and is advisory, never authoritative — a missing or stale sidecar degrades to the full-month fetch — and that a profile entry's identity is referenceTime and generatedAt while an observation batch carries firstObservedAt and lastObservedAt, with lines counting its instants.",
    caption:
      "Offsets, lengths, and stamps are schematic, but every printed number obeys the byte arithmetic: each byteOffset is the running sum of the byteLengths before it, archiveLength 83325 is their total, and the Range end 63219 is 41449 + 21771 - 1. A real month holds one member per append, not four. The shipped since fast path sends an open-ended range (bytes=offset-) because an append can outrun the sidecar; the placement arithmetic is identical.",
    units: "byte offsets and lengths in bytes · timestamps UTC · values schematic",
  }),
  authoredTarget({
    id: "docs-adapter-flow",
    file: "station/docs/figures/adapter-flow.svg",
    source: "adapter-flow.svg",
    idPrefix: "adapt-",
    title: "The adapter fan-in",
    lesson:
      "Every vendor upstream, whatever its shape and units, fans in through its own adapter to the one wire contract — everything downstream speaks only the contract.",
    description:
      "Five lanes on the left, one per adapter, each pairing a vendor upstream with the adapter that guards it. WindNerd: windnerd.net live and records endpoints, already in m/s; the adapter validates speeds 0 to 140 m/s and its live INIT block enriches the meta, with config winning over vendor values. Tempest: the WeatherFlow REST endpoint at swd.weatherflow.com, m/s; the adapter validates 0 to 140 m/s and fills every field of the conditions block. Campbell: the logger's own DataQuery web API with no vendor cloud, tables in km/h; the adapter bounds speeds 0 to 500 km/h then converts with kmhToMps, and pinned field contracts check the units. Ecowitt: the cloud real_time endpoint, roughly one upload a minute; the request pins SI units because the defaults are imperial, and speeds are validated 0 to 140 m/s. A fifth dashed lane, Custom, takes any upstream you can fetch: your mapping must return a valid Station, and defineStationAdapter supplies the full belt. All five lanes' arrows, labelled normalized Station, converge on one accented node, the wire contract's Station document: identity plus capabilities on both arms of the status union, status ok carrying reading and history, status unavailable carrying a reason code, speeds in m/s with null never zero, and capabilities declared, never inferred. An italic note beneath states the point: whatever the hardware, the client sees one document. To the right, a downstream zone that speaks only the contract, never a vendor: the station feed handler assembles stations into StationFeed and serves /feed, /current, /live, and the other routes over HTTP to components and clients, which keep one decoder for every station. A footer strip states the degradation belt: a throw or an invalid return degrades that station to status unavailable with a machine reason code — still the contract — and the rest of the feed survives.",
    caption:
      "The four shipped adapters and the custom arm each fetch their vendor's upstream and validate it in the vendor's own units — 0–140 m/s for the m/s upstreams, 0–500 km/h for Campbell's km/h tables, with Ecowitt pinning SI units in the request — before normalizing into one Station document. The feed handler assembles those documents into StationFeed and serves them over HTTP; clients keep one decoder. Failure stays on the contract too: a throw or an invalid return degrades the station to an unavailable reason code and the rest of the feed survives.",
    units:
      "schematic; no numeric scale — printed units are each vendor's upstream units and the wire's m/s",
  }),
  authoredTarget({
    id: "docs-climatology-cube",
    file: "station/docs/figures/climatology-cube.svg",
    source: "climatology-cube.svg",
    idPrefix: "clim-",
    title: "The climatology cube",
    lesson:
      "StationClimatology is one (month, slot-of-day, sector) cube of sums; every view is a re-aggregation of the held document, and the years ledger says how much record stands behind it.",
    description:
      "A recessed panel holds the StationClimatology document. Inside it, a 12-by-8 grid of cells spans months January to December across and eight 3-hour slots of standard time down; shaded cells hold records, a few blank cells are absent rather than zero-filled, and one accented cell opens into a detail panel. The opened cell lists sampleCount (all records, calm included), calmCount (calm belongs to the bucket, not a sector — calm has no direction), and a row of 16 sector boxes, the third axis, each carrying count, uSum, vSum, speedSumMps, bandCounts of length thresholds plus one, and maxGustMps; a note says sums, not means, so any filter re-aggregates losslessly. Two declaration boxes ride beside the cells: thresholdsMps, the consumer's bounds with no shipped default, and utcOffsetMinutes, the standard offset with no DST so a slot means the same solar hours in January and July. A ledger strip shows per-year bars of sampleCount within expectedCount, one interior year silent, noting that a silent interior year stays as a real outage while leading pre-station years are trimmed. Four arrows leave the document to the views: climatologyRose collapses month and slot into per-sector totals that keep their bandCounts stacks; climatologyPattern collapses month and sector and vector-averages each slot; climatologyFavorableShare yields the share of the filtered non-calm record inside the consumer's arcs, judged at sector centres; and climatologyCoverage sums the ledger. A heading over the views says every view is a pure function of the held document — a filter change re-sums and never refetches.",
    caption:
      "Cells are keyed by month and slot-of-day, bucketed in the station's standard time; the sector axis lives inside each cell as per-sector sums. Sums, not means, so any month, season, or time-of-day filter re-sums losslessly without a refetch. Months are fixed at 12; the 8 slots (180-minute) and 16 sectors drawn are the WindNerd adapter's defaults — slotMinutes must divide 1440 and sectorCount is at least 4. The opened cell's coordinates and the ledger bars are schematic.",
    units:
      "schematic; grid axes: month 1-12 across, slot-of-day in station standard time down; ledger bars: sampleCount within expectedCount per year",
  }),
  authoredTarget({
    id: "docs-schema-rollout",
    file: "site/src/content/docs/docs/figures/schema-rollout.svg",
    source: "schema-rollout.svg",
    idPrefix: "roll-",
    title: "Rolling a schemaVersion bump",
    lesson:
      "Guards normalize up and writers emit only the newest, so the release that bumps a family ships the upgraded reader with the new writer, and consumers pin-bump at their own pace — never move a writer to a version no released reader parses.",
    description:
      "A three-lane swimlane read left to right through a schematic v1-to-v2 schemaVersion bump. The lanes are the writer (an operator pinning @azohra/meteo.forecast, which embeds its own briefing as the writer), the published dataset between them, and readers pinning @azohra/meteo.briefing. In the before column the writer emits v1, v1 documents sit on the wire, and a reader parses them — a guard parses every version ever published, normalized up. In phase 1 the release that bumps the family ships the upgrade with it: the new briefing parses v2 and everything before it, and the forecast release that embeds it is the new writer, emitting only v2; the dataset now holds v2 current documents while v1 archives stay on the wire, append-only and immutable. In phase 2 consumers upgrade at their own pace, in any order: a reader that bumps its pin early keeps parsing the old documents still being published, while a reader that bumps late sees, for new documents only, a miss of invalid with declaredSchemaVersion 2 against a supported 1 — the signal to upgrade the package, not to debug bytes — and an ingesting reader serves what it last stored. A callout carries the release rule: never move a writer to a version no released reader parses.",
    caption:
      'Versions are schematic (a v1 to v2 bump). A reader that upgrades late keeps serving until it does: its only symptom for new documents is { miss: "invalid" } with declaredSchemaVersion naming the newer number — the signal to upgrade the package, not to debug bytes — and an ingesting reader serves what it last stored throughout.',
    units:
      "one schema bump; three phases, time left to right; versions schematic — no numeric scale",
  }),
];
