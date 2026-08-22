---
title: History and run convergence
description: Load the append-only month archives with the member-splitting reader, then compare successive runs of one model at the findings level.
---

`@azohra/meteo.briefing/history` is documents through time, in two halves that feed each
other: loaders that read the published
[month archives](/docs/briefing/history-archives/) into deduped,
chronological runs, and
`compareRuns`, which turns [`@azohra/meteo.briefing/compare`](/docs/briefing/compare/)'s
member axis from "models at one instant" to "runs of one model" and states
the convergence ladder: what each successive run said about the same local
day.

This is the briefing capability's one server-side subpath: the archive
reader is built on `node:zlib`, so it runs in Node, Bun, and Deno but not in
browsers. Every other subpath of the package stays runtime-agnostic
([why, below](#why-the-reader-splits-gzip-members-itself)).

## Why the reader splits gzip members itself

A month archive is a sequence of independent gzip members
([the archive format](/docs/briefing/history-archives/)). Never assume
one line per member: forecast archives run one line per member, while
observation archives batch a whole granule of instants per member
(re-verified 2026-08-10 across every published model). The reader splits
members first and lines second.

WHATWG `DecompressionStream("gzip")` cannot be trusted with these
archives. The spec treats bytes trailing the first member's end as an
error, and these archives are multi-member. Worse, the
runtimes disagree (measured 2026-08-10):

| Runtime | `DecompressionStream("gzip")` on a multi-member archive |
| --- | --- |
| Node 24.19 | throws `ERR_TRAILING_JUNK_AFTER_STREAM_END` |
| Deno 2.9 | throws a different `TypeError` |
| Bun 1.3 | silently decompresses every member |

Hence `splitHistoryArchive`: a member-splitting reader on `node:zlib`'s
raw-deflate decoder, which reports exactly how many input bytes each
member's deflate stream consumed: the boundary `DecompressionStream`
never surfaces. It returns `null` on structurally corrupt bytes (not
gzip, truncated member, trailer length mismatch), mirroring the contract
guards' never-throw convention; the loaders report that as a
`"miss": "invalid"`. It accepts any slice that starts on a member
boundary, so a Range fetch from a member offset splits with the same
code as a full fetch.

That decoder is also why the subpath is server-side: only `node:zlib`
reports consumed input bytes. Verified 2026-08-10: Node 24.19 runs the
full test suite; Bun 1.3 (split and load) and Deno 2.9 (member
splitting) run it via their `node:zlib` compatibility layers.
**Browsers are not supported by this subpath**, and no other subpath is
affected: contract, derive, analyze, compare, transport, scene, and SVG
stay runtime-agnostic exactly as before.

## Load a site's months

`loadForecastHistory` and `loadSmokeHistory` are the typed faces of
`loadHistory`, whose `guard` parameter types each archive line: a
history line is exactly the published document, so the guards are the
contract's own (`parseSiteForecastJson`, `parseSmokeDocumentJson`).
No observation-shaped face ships: `loadHistory`'s line type requires the
run stamp (`model`, `run.referenceTime`, `run.generatedAt`) that drives
the dedupe, and an [observation archive](/docs/briefing/history-archives/)
line is a single observation object that does not satisfy
it; a reader of those months splits them with `splitHistoryArchive` and
types the lines itself.
Transport manners match [`@azohra/meteo.briefing/transport`](/docs/briefing/transport/):
injected fetch, discriminated `DocumentMiss`, `TransportHttpError` as the
only throw, no storage side effects.

```ts title="load-history.ts"
import { loadForecastHistory } from "@azohra/meteo.briefing/history";

export async function loadRecentRuns(baseUrl: string) {
  const result = await loadForecastHistory({
    fetch, // the global WHATWG fetch satisfies HistoryFetch directly
    baseUrl,
    modelSlug: "hrdps-continental",
    siteSlug: "test-hill",
    months: ["2026-07", "2026-08"],
    // Inclusive referenceTime lower bound — also the index fast path's key.
    since: "2026-07-25T00:00:00Z",
  });

  // "absent" here means EVERY requested month is absent — the site simply
  // has no history at this root. Months absent beside present ones stay
  // routine per-month entries in result.misses instead.
  if ("miss" in result) return null;

  for (const line of result.invalidLines) {
    // A guard-rejected line is a contract break or prototype data — never
    // routine; the surviving lines still load.
    console.error(`contract break in ${line.url} @ member ${line.memberByteOffset}`);
  }
  return result;
}
```

A `LoadedHistory` carries four statements:

| Field | What it states |
| --- | --- |
| `runs` | The deduped runs, ascending by `referenceTime`: one per `(model, referenceTime)`, keep-latest-`generatedAt` |
| `revisions` | Republications the dedupe discarded: which stamps were superseded, per run |
| `invalidLines` | Guard-rejected lines, located by archive URL, member byte offset, and line number; log loudly |
| `misses` | Per requested month with nothing to contribute: `"absent"` is routine (a month file exists only once a run of that month was archived); `"invalid"` (archive bytes that failed to split) never is |

The dedupe is mandatory. The same `referenceTime` can
legitimately appear on more than one archive line (a corrected
re-publication appends a new line rather than rewriting bytes). The
loader keeps the line with the latest `generatedAt` and reports what it
discarded as `revisions`.
Without that statement, convergence would score a publisher fix as
weather, which is exactly what `compareRuns`'s `identityDrift` finding
exists to prevent.

## The sidecar index and the since-suffix strategy

The forecast engine publishes an advisory byte-offset index beside every
archive as `{YYYY-MM}.index.json`: per gzip member, where its bytes sit
and which run they carry. When you pass `since` and a month's sidecar
exists, the loader Range-fetches from the first needed member's offset
**to end-of-file** instead of fetching the whole month.

The suffix request is what makes the narrowing safe: the archives are
append-only, so a sidecar that has not yet seen the newest appended
members (an append racing the index upload, or a stale CDN cache) still
yields every byte the selection could need. When nothing indexed matches
`since`, the loader probes the uncovered tail past the last indexed
member; a `416` past end-of-file means nothing new. The index
is advisory, never authoritative: a missing sidecar (the launch
state), an unparsable one, any index fetch failure, or a server that
ignores `Range` and answers `200` with the full body all degrade to the
full-archive fetch, silently correct: both paths filter identically, so
index-present and index-absent loads are equivalent.

## Compare a model's runs through time

`compareRuns` points [compare's discipline](/docs/briefing/compare/)
(every verdict reduces to stated arithmetic over embedded,
caller-movable thresholds, agreement comes only from the votes, and
every non-vote has a stated reason) at successive runs
of one model at one site. Compare vocabulary 2 made the axis
literal (a member already *is* a `(model, referenceTime)` run), so the
per-day vote constructions are delegated to `compareAnalyses` wholesale;
what this half adds is the run axis. The product is the convergence
ladder: per target local day, the ordered per-run statement stack,
newest run first.

```ts title="compare-runs.ts"
import type { SiteForecast } from "@azohra/meteo.briefing/contract";
import { compareRuns, type RunComparison } from "@azohra/meteo.briefing/history";
import type { HistoryRevision } from "@azohra/meteo.briefing/history";

export function convergenceLadder(
  runs: readonly SiteForecast[], // loadForecastHistory(...).runs, as-is
  revisions: readonly HistoryRevision[], // ...and its revisions statement
): RunComparison {
  return compareRuns(runs, {
    timeZone: "America/Vancouver",
    launch: { elevationM: 1225.1 },
    // Pass the loader's republication statements through, so a corrected
    // re-publication is stated on identityDrift instead of silenced.
    revisions,
  });
}
```

The natural feed is the history loader: `runs` is already deduped and
chronological, and `revisions` passes straight through. Mixed models
throw: one model through time is this axis; models at one instant are
`compareForecasts`'. `compareRunAnalyses` is the seam `compareRuns`
wraps; like `compareAnalyses`, it takes cached envelopes: analyze at
the edge, cache as JSON, compare through time later, with every
coherence check (one site, one zone, one launch, one threshold set,
duplicate runs, version skew, missing self-description) delegated to
`compareAnalyses` and thrown as its named errors.

The `RunComparison` envelope carries its own
`RUN_COMPARISON_VOCABULARY_VERSION` (currently `2`), a sibling of `COMPARE_VOCABULARY_VERSION`, versioned
independently so through-time statements can grow without a cross-model
contract event and vice versa. The same tolerant-reader convention
applies: readers of serialized envelopes ignore kinds and fields they do
not know. The `runs` ledger reuses compare's member ledger verbatim,
newest first; `runAgeHours` and `stepHours` are stated ledger facts,
and `benched` is a benched run's stated reason for appearing on no
rung.

Every `leadHours` in the envelope is anchored to one instant per target
day: hour `leadAnchorLocalHour` of that day in the comparison's zone
(default `12`, local noon), a
single instant for "the flying day" that takes no position on window
timing. Negative lead is arithmetic like any other: a run
restating a past day simply reads negative.

## The five run-comparison kinds

`existenceTrajectory` is the worked example: per target local day, every
unbenched run's vote (window, quiet, or an
abstention with its reason), newest run first. An existence flip is read
off the `vote` sequence; the finding never names it with an adjective.
Each rung carries the run's own sensitivity flip values against the
shared floors, so a genuine flip at a threshold knife-edge reads as
knife-edge arithmetic, not model chaos.

```ts title="existence-ladder.ts"
import type { RunComparison } from "@azohra/meteo.briefing/history";

export function existenceLadder(comparison: RunComparison) {
  return comparison.findings.flatMap((finding) => {
    if (finding.kind !== "existenceTrajectory") return [];
    return [{
      day: finding.day,
      rungs: finding.rungs.map((rung) => ({
        referenceTime: rung.referenceTime,
        leadHours: rung.leadHours,
        vote: rung.vote, // "window" | "quiet" | "abstained"
        abstained: rung.abstained ?? null, // the stated non-vote reason
        // A quiet rung one flip value under the floor is a knife-edge
        // case; see the sensitivity note above.
        wstarFlipAtMps: rung.sensitivity.wstarFlipAtMps,
      })),
    }];
  });
}
```

The other four kinds narrow the same way. Their statements and reading
caveats:

| Kind | What it states | Reading caveats |
| --- | --- | --- |
| `timingTrajectory` | Window start and end instants across runs (`starts` / `ends`), reusing compare's timing construction verbatim, with per-edge spread facts: `startSpreadHours` / `endSpreadHours` (max − min, null below two) and `startStepHoursMax` / `endStepHoursMax` | Only unclipped edges vote: a horizon-clipped edge reads as "open since at least", never as timing; an edge joins the day whose local calendar date contains its instant; every vote carries its window's `stepHours`, and up to that many minus one hours of run-to-run difference is quantization, not drift |
| `magnitudeTrajectory` | Per voting run: peak W\* (`peakThermalVelocityMps`), launch-relative peak lift, and covered window duration: the numbers whose run-to-run deltas state themselves | Whole-window numbers belong to the window's own day: a run touching the day only via a midnight spanner keyed elsewhere states `null` rather than restating another day's magnitudes. Ensemble runs carry per-day p10–p90 band widths (`bandWidth`) as evidence with no narrowing verdict: the recorded spike measured band widths moving both directions as lead fell, so "narrowing = converging" would misstate the data |
| `identityDrift` | Non-meteorological facts that changed between runs: the loader's republication statements pass through verbatim (`revisions`), and a ledger walk names identity facts (`modelElevationM`, `stepHours`, `hours`) that differ between chronologically adjacent runs | Exists so a publisher or model change is never read as weather; day-less, and emitted only when there is drift to state |
| `settled` | Arithmetic stability per target local day: whether the newest `minRuns` runs' launch-relative lift magnitudes all sit within `magnitudeBandM` of each other (max − min ≤ band), the embedded constants echoed on `thresholds` | A stability statement about runs ("the forecast has stopped moving"), and explicitly not probability and not skill: a settled forecast can be settled on the wrong answer, and nothing here scores the atmosphere. `settled` is `false` whenever the arithmetic cannot run (fewer runs than `minRuns`, or any sampled run stating no magnitude), with `spreadM` null and the `sample` roster showing which, so "not stable" and "not statable" stay readable apart |

The default constants (`minRuns: 3`, `magnitudeBandM: 300`) are
trial values, calibrated on a thin
archive (days of runs, one basin), not a sweep over a representative
one; a re-sweep at two or more weeks of month-file archive is a recorded
obligation (~2026-08-24). They are caller-movable per call via
`CompareRunsOptions.settled`, and every finding echoes the values that
produced it.

![Two five-rung convergence ladders for the same schematic target local day, newest run first, each rung labelled with its run reference time, its leadHours to the day's local-noon anchor (19 to 67 hours), and its vote, with every stated magnitude also plotted as a dot on the panel's shared magnitude scale so the spread is visible as distance. Left, a settled day: the newest three rungs vote window with magnitudes 1480, 1370, and 1520 m above launch, their dots huddled under a short bracket; spreadM = 1520 - 1370 = 150 m, narrower than the magnitudeBandM 300 ruler drawn at the same scale, so settled is true. Right, an unsettled day: window rungs at 1980 and 1420 m and a quiet rung at 990 m of depth scatter across the scale under a long bracket; spreadM = 1980 - 990 = 990 m, far wider than the same 300 m ruler, so settled is false. In both ladders a tinted band encloses only the newest minRuns = 3 rungs; an older rung sits plotted below the band, and the oldest rung is an abstention with the stated reason outOfHorizon and no magnitude. A four-row ledger beneath defines rungs, leadHours, settled, and the embedded thresholds.](figures/convergence-ladder.svg)

## What this vocabulary refuses to say

These rejections are binding:

- **no trend adjectives**: no "converging", "diverging", "shrinking",
  or "growing" tokens anywhere. Trajectories are series; deltas and
  rosters state themselves, and the reader sees the shape;
- **no run weighting**: run age is the ledger's `runAgeHours` fact;
  nothing weights by it;
- **no graded agreement enums**;
- **no staleness-as-finding**: a target day beyond an old run's horizon
  is an `outOfHorizon` abstention with a reason, never a "changed
  forecast";
- **no ensemble-narrowing verdict**: band widths ride the magnitude
  trajectory as evidence and nothing more;
- **no per-finding version tags**: the envelope's `vocabularyVersion`
  governs, as everywhere else.

Candidate kinds beyond the core five (flip counts, oscillation
summaries, cross-model convergence) wait for their own evidence spike;
none is pre-approved.
