---
title: "Climatology: the multi-year cube"
description: "The StationClimatology document: a (month, slot-of-day, sector) cube of the station's whole archive, binned with the consumer's thresholds, re-aggregated client-side under any filter with no refetch."
---

The live feed answers "what is it doing?"; the climatology document answers
"what is this spot like?": the whole archive condensed into one cube that
a client slices by month, season, or time of day without refetching.

## The document

`StationClimatology` is its own document family with its own
`STATION_CLIMATOLOGY_SCHEMA_VERSION`: near-immutable history has a
different lifetime and cadence than the feed, so it versions apart. The
core is `cells`: one entry per **(month, slot-of-day)** bucket that ever
held a record (an empty bucket is absent, never zero-filled), each
carrying `calmCount` (calm belongs to the bucket; calm has no direction)
and per-sector **sums**: `count`, `uSum`/`vSum` (core's wind sign),
`speedSumMps`, `bandCounts`, `maxGustMps`. Sums, not means, so any filter
re-aggregates losslessly.

Three declarations ride beside the cells:

- `thresholdsMps`: the consumer's speed-band bounds the cube was binned
  with, and the bounds behind every `bandCounts` stack. The package ships
  no default.
- `utcOffsetMinutes`: the station's standard offset (no DST) used for
  bucketing, so a slot means the same solar hours in January and July.
- `years`: the coverage ledger: per calendar year, `sampleCount` against
  the `expectedCount` a gapless station would have produced. Leading years
  that predate the station are trimmed. An interior silent year stays; it
  records a real outage.

## Building it

The WindNerd adapter builds the cube the way the vendor's own views do:
one records request per calendar year at the 180-minute period, closed
years cached about 30 days, the running year 6 hours. Any year the
upstream refuses fails the whole document, because a silently missing
year would read as an outage. The yearly fetches cache by raw records, so one shared
cache serves every consumer regardless of thresholds; the fold itself is
cheap and runs per request.

```ts
import { loadStationClimatology } from "@azohra/meteo.station/server";
import type { StationConfigInput } from "@azohra/meteo.station/server";

// A fictional station — substitute your own identifiers.
const stations: StationConfigInput[] = [
  { vendor: "windnerd", id: "launch", name: "Bluff Launch",
    stationKey: "bluff-launch", locationId: 8675 },
];

const cube = await loadStationClimatology({
  stations,
  stationId: "launch",
  thresholds: { unit: "kmh", values: [12, 20, 28] }, // your judgment, required
});
```

The mounted handler serves the same document at `/climatology?station=`
once the host passes its judgment at mount
(`createStationFeedHandler({ …, climatology: { thresholds } })`); without
that option the route answers 404. Responses carry a 6-hour cache life and
the handler's usual `ETag`/304 revalidation.

## Reading it

Every view is a pure function of the document and the consumer's filters;
a filter interaction never refetches:

- `climatologyRose(document, { months?, slots? })`: geometry's
  `WindRoseSummary`, every sector carrying its `bandCounts` stack.
- `climatologyPattern(document, { months? })`: geometry's
  `DailyPatternSlot` list, vector-averaged per slot.
- `climatologyCoverage(document)`: samples held against the ledger's
  expectation.
- `climatologyFavorableShare(document, arcs, filters?)`: the share of the
  filtered non-calm record inside the consumer's arcs, judged at sector
  centres; `null` when nothing non-calm was recorded.

`createStationClimatologyStore(url)` (the client subpath) fetches the
document once and holds it; `climatologyEndpoint(base, stationId)` builds
the URL, and `useStationClimatology(base, stationId)` wraps both for React.
Month filters compose with `METEOROLOGICAL_SEASON_MONTHS` for season
presets.

Two display pairs draw the cube directly:
[`ClimatologyRose` / `<meteo-climatology-rose>`](/docs/station/react/#components)
stacks each wedge by the document's own thresholds and captions the
favorable share and coverage, and
`ClimatologyDailyPattern` / `<meteo-climatology-daily-pattern>` runs the
cube through the daily-pattern drawing; every filter change re-sums the
held document.
