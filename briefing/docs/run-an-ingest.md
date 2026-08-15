---
title: Run an ingest
description: "Poll runs.json, ingest coherent publications, and serve through gaps: the recipe for the store-and-serve loop the package deliberately does not ship."
---

An ingest (the loop that polls the published dataset, notices a new
publication, pulls one model's documents as a coherent set, and serves them
from its own storage) is two different kinds of code. The questions with
correct answers ("is this set one publication", "why is this document
missing", "is this run late") are package verbs, and `@azohra/meteo.briefing/transport`
and `@azohra/meteo.briefing/derive` answer every one of them. The loop around those verbs
(the scheduler, the store, retention, what your product tells its users
when a feed runs late) is policy whose shape belongs to the consumer and
its runtime. This page is the recipe for wiring one, not a module to
import; it is the server-side counterpart of
[Wire an inspector](/docs/briefing/wire-an-inspector/).

![The ingest loop's five steps: poll runs.json with loadRuns; compare each model's (referenceTime, generatedAt) pair against seen; fetch a coherent set with loadSiteSet anchored on the manifest; refuse a syncing: true set by ingesting nothing; and atomically swap the store under the new referenceTime. Every path returns to the standing state: serve the newest coherent publication the store holds.](figures/ingest-loop.svg)

## Poll runs.json on your own cadence

The dataset is static files, so there is no webhook to subscribe to and
none is needed: the poll is the subscription. One fetch of `runs.json`
(the cross-model run index, regenerated wholesale at every publish) answers
"what run is current for every model". `loadRuns({ fetch, baseUrl })`
fetches it with the same discriminated miss semantics as every other
loader in the [transport guide](/docs/briefing/transport/).

The cadence is yours. A sensible loop wakes at a small fraction of the
fastest `runIntervalHours` it serves (every few minutes is plenty when the
fastest feed publishes six-hourly), and a poll that finds nothing new costs
one small document.

## Detect a publication by its identity pair

A publication is identified by the pair `(run.referenceTime,
run.generatedAt)`; the fact and its consequences are defined in
[Compatibility](/docs/compatibility/#publication-identity).
For the loop that means: remember the last pair you ingested per model, and
treat any change as work. A new `referenceTime` is a new run; a later
`generatedAt` for the same `referenceTime` is a corrected re-publication,
and re-ingesting it is exactly as mandatory: comparing `referenceTime`
alone would serve retracted values forever.

```ts title="detect-publications.ts"
import type { RunsIndexEntry } from "@azohra/meteo.briefing/contract";
import { loadRuns } from "@azohra/meteo.briefing/transport";

/** The last pair ingested per model slug — persisted however you persist things. */
export type SeenRuns = Record<string, RunsIndexEntry>;

export async function modelsToIngest(
  baseUrl: string,
  seen: SeenRuns,
): Promise<{ changed: string[]; index: SeenRuns }> {
  const index = await loadRuns({ fetch, baseUrl });
  if ("miss" in index) {
    // Either miss is loud here: "absent" means the data root itself is gone.
    console.error(`runs.json ${index.miss} at ${index.url}`);
    return { changed: [], index: seen };
  }
  const changed = Object.keys(index.runs).filter((slug) => {
    const previous = seen[slug];
    const current = index.runs[slug];
    return (
      !previous ||
      previous.referenceTime !== current.referenceTime ||
      previous.generatedAt !== current.generatedAt
    );
  });
  return { changed, index: index.runs };
}
```

Advance `seen[slug]` to the fresh pair only after that model's documents
ingest coherently below; a publish caught mid-flight then stays on the
work list and is retried by the next tick, for free.

## Ingest a coherent set

A model's sites are separate files behind separate cache entries, so around
a publish, per-site fetches can straddle two runs even when each
manifest/document pair looks internally consistent on its own. `loadSiteSet`
exists for exactly this: it fetches the model's manifest once as the commit
point, then every site document, and requires each document to carry that
manifest's run, retrying once on a mid-publish mix; the
[transport guide](/docs/briefing/transport/#load-a-site-set-as-one-publication)
defines the contract. The result discriminates on `syncing`:

```ts title="ingest-coherent-set.ts"
import { parseSiteForecastJson, type SiteForecast } from "@azohra/meteo.briefing/contract";
import { loadSiteSet } from "@azohra/meteo.briefing/transport";

export interface IngestedRun {
  referenceTime: string;
  documents: Record<string, SiteForecast>;
}

/** Returns the coherent publication to store, or null to wait for the next poll. */
export async function ingestProfileModel(
  baseUrl: string,
  modelSlug: string,
  siteSlugs: readonly string[],
): Promise<IngestedRun | null> {
  const set = await loadSiteSet({
    fetch,
    baseUrl,
    modelSlug,
    siteSlugs,
    guard: parseSiteForecastJson,
  });
  if ("miss" in set) {
    // The whole model missed — loud either way for a feed you serve.
    console.error(`${modelSlug} manifest ${set.miss} at ${set.url}`);
    return null;
  }
  if (set.syncing) {
    // A publish is mid-flight; set.runsSeen names the runs observed.
    // Ingest nothing — the next poll reads cleanly.
    return null;
  }
  for (const [siteSlug, miss] of Object.entries(set.misses)) {
    // "absent" is routine: a site outside this model's domain.
    if (miss.miss === "invalid") console.error(`contract break at ${miss.url} (${siteSlug})`);
  }
  return { referenceTime: set.referenceTime, documents: set.documents };
}
```

Three behaviours in that code carry the recipe. On `{ syncing: true }` the
loop ingests **nothing** (not even the sites that agreed with the manifest),
because a partial ingest is a torn store, and the next poll reads the
finished publication cleanly while your store keeps serving what it already
holds. Per-site misses never poison the set: `"absent"` sites are routine
and `"invalid"` is a contract break to log loudly, exactly as in the
[miss table](/docs/briefing/transport/#absent-is-routine-invalid-is-loud).
And a coherent set may be the *previous* publication:
[not syncing, just the newest complete forecast there is](/docs/briefing/transport/#load-a-site-set-as-one-publication);
store it under its `referenceTime` and let the identity-pair check decide
whether it was news. For a smoke model the recipe is identical with
`parseSmokeDocumentJson` as the guard.

## Observation series are the exception

Observation documents are ingested per site with `loadObservation`: a
guarded single fetch, no manifest anchor, no coherence dance. An
observation document has no run: its identity lives in its own `observed`
block, the worst case is being one internally-consistent granule behind,
and the next poll tick heals it. The
[transport guide](/docs/briefing/transport/#observations-one-guarded-fetch-no-dance)
carries the full argument for why the dance would be wrong here.

```ts title="ingest-observations.ts"
import type { ObservationDocument } from "@azohra/meteo.briefing/contract";
import { loadObservation } from "@azohra/meteo.briefing/transport";

export async function ingestObservations(
  baseUrl: string,
  modelSlug: string,
  siteSlugs: readonly string[],
): Promise<Record<string, ObservationDocument>> {
  const documents: Record<string, ObservationDocument> = {};
  await Promise.all(
    siteSlugs.map(async (siteSlug) => {
      const result = await loadObservation({ fetch, baseUrl, modelSlug, siteSlug });
      if ("miss" in result) {
        if (result.miss === "invalid") console.error(`contract break at ${result.url}`);
        return;
      }
      documents[siteSlug] = result;
    }),
  );
  return documents;
}
```

Because there is no run to anchor, observation series also have no
publication pair to detect: poll them on their own tick, sized against the
catalogue's `cadenceMinutes` rather than any `runIntervalHours`.

## Serve the predecessor through gaps

Publishes take time and providers have bad days, so gaps are a when, not an
if: a syncing set, a run that never appears, an ingest tick that dies
halfway. The recipe absorbs all of them one way: the store serves the
newest coherent publication it holds until a newer one has ingested
completely, then swaps atomically under the new `referenceTime`. Never
serve a partially ingested run, and never delete on a miss: a model that
went quiet still has a perfectly good predecessor run, dated by
its own `run` block, and a reader told "this is the 06Z run; the 12Z is
late" is better served than one shown nothing.

How many predecessors to keep (one, a season, forever) is retention, and
retention is consumer policy, not a dataset property. The dataset's own
[history archives](/docs/briefing/history-archives/) already keep the per-site record of
everything published (readable programmatically with the
[`@azohra/meteo.briefing/history` loaders](/docs/briefing/history/)), so your store
only needs what your product serves hot.

## Baseline feeds and bonus feeds

Not every feed you ingest carries the same weight, and the gap-handling
above should not pretend otherwise. A **baseline** feed is one your product
cannot serve its purpose without; a **bonus** feed enriches the picture
while it is there: a second opinion from another model, a smoke overlay,
an observation series. The distinction matters because their failures mean
different things: a baseline model gone stale is *your outage* (alert,
escalate, apologize), while a bonus feed going quiet is weather, or a
provider's bad day: say so in the product and keep serving
everything else. One freshness grade should never take the whole product
down with it.

Which feeds are the baseline is product policy: the catalogue declares what
each model publishes, never which one you depend on. Naming the baseline is
your decision; treating the two failure classes differently is the recipe.

## Judge freshness with `runFreshness`

A store that serves through gaps must answer "how current is
this?". `runFreshness` from `@azohra/meteo.briefing/derive` grades a runs.json entry
`"current" | "delayed" | "stale"`, and its inputs split exactly along the
fact/policy line this page keeps drawing: the facts come from the
[model catalogue](/docs/briefing/catalogue/), the threshold boundaries are
yours. The grading semantics live in the
[derive reference](/docs/briefing/derive/#judge-run-freshness).

```ts title="grade-feeds.ts"
import type { ModelCatalogue, RunsIndex } from "@azohra/meteo.briefing/contract";
import { runFreshness, type RunFreshness } from "@azohra/meteo.briefing/derive";

/** This product's tolerance — yours will differ, and that is the point. */
const THRESHOLDS = {
  currentIntervals: 1, // the successor run may simply not exist yet
  staleAfterIntervals: 3, // a whole run skipped, and the one after is late too
};

export function gradeFeeds(
  index: RunsIndex,
  catalogue: ModelCatalogue,
  now: string,
): Record<string, RunFreshness> {
  const grades: Record<string, RunFreshness> = {};
  for (const model of [...catalogue.models, ...(catalogue.smokeModels ?? [])]) {
    const entry = index.runs[model.slug];
    if (entry) grades[model.slug] = runFreshness(entry, model, now, THRESHOLDS);
  }
  return grades;
}
```

Pass the runs.json entry and the catalogue entry straight in. A
`"delayed"` run is still the newest forecast there is;
`"stale"` means the feed has missed enough runs that presenting it as
current weather would be dishonest; which grade triggers which product
behaviour is the baseline-versus-bonus decision above.
