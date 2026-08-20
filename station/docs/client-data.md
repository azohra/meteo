---
title: The client data layer
description: "The framework-free polling loop and station stores every binding rides: poller semantics, cadence rules, the merge clock rule, and display resolution."
---

`@azohra/meteo.station/client`: the framework-free polling loop and station
stores every binding rides: the mirror of `@azohra/meteo.station/server`,
one subpath per side of the wire. The react hooks are thin wrappers over
this layer; a binding for any other framework (or none) subscribes to the
same stores, so no binding can drift on cadence, parsing, merging, or
degradation. Importing the subpath is safe anywhere (SSR passes, node
tests); its loops only ever *run* against a live `fetch`.

If you render with the [React](/docs/station/react/) or
[custom-elements](/docs/station/elements/) binding you never call this
layer directly; read on to build your own binding, or to understand the
shared behaviour underneath.

## The mount base

Every entry point takes the **mount base** (where
`createStationFeedHandler` is mounted, e.g. `"/api/wind"`) and builds its
own route from it, mirroring the handler's pathname-suffix routing.
`feedEndpoint(base)`, `currentEndpoint(base, stationId)`, and
`liveEndpoint(base, stationId)` (exported from `@azohra/meteo.station`) are
the only three routes.

## The poller

`createJsonPoller(url, { parse, intervalMsFor, fetchInit?, initial? })`
returns a store: `getSnapshot()` (stable object identity between changes),
`subscribe(listener)`, `start()`, `stop()`, `refresh()`. Its semantics are
owed to every caller identically:

- **Visibility-gated**: a hidden tab skips its ticks and refetches the
  moment it becomes visible; no `document` (SSR, node) counts as visible.
- **In-flight suppression**: a slow response never stacks a second request;
  every request carries an abort deadline (15 s), so a stalled upstream can
  never park the loop.
- **First interval after first response**: the first timer is scheduled
  once the first response settles, so the interval honours the feed's
  advised cadence rather than the pre-data default.
- **Keep-last-on-error**: a failed or unreadable poll keeps the previous
  validated document and flags a structured error:
  `{ kind: "network", status? }` with the HTTP status when a response
  arrived; `{ kind: "contract", cause? }` with the zod error (or JSON syntax
  error) behind an unreadable body.
- **Seeds refresh**: an `initial` snapshot (SSR-fetched data) fills state
  before the first fetch; the first poll still fires.
- **The consumer's `fetchInit` rides every request** (headers, credentials,
  cache mode; pass a function to thread the latest values); the loop's own
  abort signal is applied last and wins.
- **A url change is a new poller.** Callers key on the url and construct a
  fresh, seed-less poller, so a held document is never served under a new
  address.

## The stores

- `createStationFeedStore(base, { pollSeconds?, fetchInit?, initial? })`:
  polls `/feed`. Cadence: `pollSeconds`, else the fastest
  `recommendedPollSeconds` any station in the last feed advised, else 60 s.
- `createStationCurrentStore(base, stationId, { pollSeconds?, fetchInit?,
  initial? })`: polls the light `/current` endpoint. Cadence:
  `pollSeconds`, else the station's own `recommendedPollSeconds`, else 15 s;
  this endpoint exists to be quick.
- `createStationStore(base, stationId, options)`: both at once, folded with
  `mergeCurrent` and its **clock rule**: a merged current response advances
  `receivedAtMs` to the current's; a merge that didn't take (station
  unavailable, or absent from the feed) keeps the feed's own clock: never
  credit a dead station with a response it never produced. The feed is the
  backbone: its error outranks the light endpoint's. `refresh()` fans out to
  both. With `live: true` the current-poll leg is replaced by the live
  store below; the feed poll and the fold are unchanged.

The fold itself is `foldCurrent(feed, feedReceivedAtMs, current,
currentReceivedAtMs)` on `@azohra/meteo.station`, for callers composing
their own stores.

## The live store

`createStationLiveStore(base, stationId, { fetchInit?, windowSeconds? })`
subscribes to the `/live` route and folds its
[frames](/docs/station/wire-contract/#the-documents) into one snapshot:
`{ status, station, samples, servedAt, receivedAtMs, error }`. `status` is
`"connecting" | "open" | "backoff" | "stopped"`; `station` is seeded by the
`init` frame and refreshed in place by `reading` frames, its
`recentSummaries` block replaced whole by `summaries` frames; `samples` is a
rolling window (default 600 s), oldest first, deduplicated by `observedAt`;
the overlap a reconnect's `init` replays folds away. `sampleIntervalSeconds`
is the cadence the last samples-bearing frame stated — `null` until one
has; the client never invents it.

The store owns the transport discipline:

- **Reconnect with backoff**: exponential from 1 s, capped at 30 s, full
  jitter, reset by a successful `init` frame. A terminal `unavailable`
  frame, a server close, an unreadable frame (`{ kind: "contract" }`), and a
  failed request (`{ kind: "network" }`) all land here; the last station
  stays and ages visibly.
- **Idle watchdog**: 60 s without a frame (a healthy stream pings every
  ~20 s) aborts and reconnects, and the deadline covers the connect itself.
- **Visibility-gated**: a hidden tab disconnects; a visible one reconnects
  immediately, healed by the fresh `init`.

`liveSnapshotToCurrent(snapshot)` shapes a live snapshot into a
`StationCurrent` for `foldCurrent`, with the rolling window standing in for
the init frame's ring; it is how the `live: true` stores and hooks ride the
existing fold unchanged.

Drawing the window: `WindSampleStrip` on `@azohra/meteo.station/react` is
the history chart's live sibling: the same frame, grid, labelled vane
rows, and edge-anchored ticks over the rolling window, samples-only by
design. For a layout the component doesn't cover, the composition
primitives remain: `sampleRuns` (gap-split at 2.5 intervals, the history
chart's own tolerance), `sampleScales`, `samplePoints`,
`sampleMeanDirectionDeg`, `thinSampleVanes`, and `samplesSummary` on
`@azohra/meteo.station` mirror the history machinery and return the same
`ChartScales` and `Vane` shapes, so `chartFrame`, `vanePath`, and
`vaneTicks` draw a sample strip exactly as they draw the six-hour chart.
Build the frame at a measured pixel width: `measuredChartWidth` (in
react, the `useMeasuredChartWidth(ref)` hook) is that rule; a fixed
viewBox stretched by CSS magnifies every label and stroke.

## Slicing history

Six pure functions on `@azohra/meteo.station` re-slice already-fetched
history `points`, never a new fetch. Two narrow which points a component
sees, and one turns a whole history into a single day:

```ts
import {
  METEOROLOGICAL_SEASON_MONTHS, // { winter, spring, summer, fall }: number[] (1-12)
  filterByMonth,                // (points, months, utcOffsetMinutes?) => HistoryPoint[]
  filterByTimeOfDay,            // (points, fromMinute, toMinute, utcOffsetMinutes?) => HistoryPoint[]
  dailyPattern,                 // (points, { slotMinutes?, utcOffsetMinutes? }) => DailyPatternSlot[]
} from "@azohra/meteo.station";
```

`filterByTimeOfDay`'s `fromMinute > toMinute` wraps past midnight (a "night"
window). Both filters and `dailyPattern` take a plain UTC-offset minutes,
not an IANA zone, matching the "local standard time, no DST" a station page
itself commits to; pass 0 (the default) to work in UTC.

The history chart's `windowHours` and `compareOffsetDays` props
([React](/docs/station/react/) / [Elements](/docs/station/elements/)) are
built from the other three:

```ts
import {
  windowPoints,       // (points, hours: number | undefined) => ReadonlyArray<HistoryPoint> — trailing N hours; an undefined hours is a no-op
  compareWindow,       // (points, offsetDays, windowHours?) => HistoryPoint[] | null — a prior period's own span, re-sliced from `points`; null when history doesn't reach back far enough
  compareTracePoints, // (comparePoints, scales, offsetDays) => string — the compare trace's coordinates, shifted onto the CURRENT chart's own x-axis
} from "@azohra/meteo.station";
```

`compareWindow` requires coverage, not just presence: the matched
span's own edges must land within one typical sample period of the window
asked for — the period scaled by the same gap tolerance an outage is
judged by — or it returns `null` rather than drawing a two-point trace.

## Browsing the archive — fetcher injection

Where re-slicing served points is not enough (browsing back through
months), the archive road is fetcher injection: the data contract is
one function shape, and how a window is served is the host's business.

```ts
import {
  createStationHistoryStore, // (fetcher, { maxWindows? }) => window-keyed LRU
  stationHistoryFetcher, // (base, stationId, fetchInit?) => StationHistoryFetcher
} from "@azohra/meteo.station/client";
import type { StationHistoryFetcher } from "@azohra/meteo.station/client";
```

`StationHistoryFetcher` is `({ fromMs, toMs, periodMinutes }) =>
Promise<StationHistory | null>`. A host that mounts the feed handler gets
the default implementation from `stationHistoryFetcher` against the
[`/history` route](/docs/station/wire-contract/#the-http-protocol); a host
that serves history its own way — an authenticated server function, a
proxy — supplies any function of that shape and never touches the handler.
`createStationHistoryStore` wraps either in a window-keyed LRU: a revisited
window costs nothing, an in-flight window is asked once, and a failed
fetch is never cached so the next ask retries. The served document echoes
the `periodMinutes` the source actually supplied.

The library ships no archive control surface; what a pager looks like is
the host's product decision. The supporting math ships beside the store:
`archivePeriodFor` (the vendor-shaped resolution ladder),
`archiveDayWindow`, `archiveDayValue`, and `archiveDayStep` (LOCAL
calendar-day arithmetic for a date field and ‹ › steps), and
`archiveTrailingWindow` (a pager's "today"). Feed the chosen window to
the store, and the returned points to
[`WindHistoryChart`](/docs/station/react/) with `windowHours`,
`compareOffsetDays`, and `nightShading`.

## Display resolution — shared across bindings

The components' ambient-default discipline is one exported rule,
`resolveDisplay(defaults, props)` on `@azohra/meteo.station`: explicit prop
→ ambient default → package default, for `strings`, `unit` (default
`"kmh"`), and `formatTime`. `thresholds` resolves explicit → ambient →
nothing: a judgment parameter ships no package default, and with none
declared, readings go ungraded. Thresholds are a trichotomy, and
every binding preserves the distinction:

- **omitted** (`undefined`): inherit the ambient thresholds;
- **a value**: grade against exactly these;
- **`null`**: explicitly opt this component out of ambient grading.

Station resolution for per-station components is `resolveStation(feed,
stationId)`: an explicit `station` always wins, then `stationId` looked up
in the ambient feed, then the feed's `primaryStationId`, then `stations[0]`.
A `stationId` that matches nothing is a wiring error, not a fallback, and
resolving nothing throws a wiring error naming the binding's provider;
`requireResolved` is that rule as code, the same function every built-in
binding calls.

## Freshness between polls

Freshness itself is the wire contract's
[model](/docs/station/wire-contract/#freshness-the-servedat-anchor),
computed by `freshness()` on the root. Between polls every binding re-judges
the same reading every `FRESHNESS_REEVALUATE_MS` (30 s), so a station that
dies visibly ages while the loop keeps returning the last observation. The
hydration rule is shared too: the initial clock is `receivedAtMs` (a value
both a server pass and the client render from), never `Date.now()`, which
differs between the passes; bindings correct to the real clock once mounted.

## Words and formatting

Everything a component prints comes from the isomorphic root, so the two
bindings print identical characters: the strings vocabulary
(`defaultStrings`, `resolveStrings`, `mergeStringOverrides`,
`localeFormatTime`), the formatting rules (`roundSpeed`, `optionalSpeed`,
the one-decimal temperature, `updatedAtText`, `summaryEntries`,
`directionCell`), the air sentences (`airSummary`, `lastStrikeWords`,
`airRows`), and the instrument geometry (`DIAL_*`, `ROSE_*`, and the
sparkline machinery: `historyRuns`, `bandStrips`, and the scales, so a
custom sparkline draws outage gaps exactly as the built-in one does;
coordinates and path strings, never markup). All on
`@azohra/meteo.station`.

## Stability

Pre-1.0: the poller and store semantics are stable; pin a minor version if
you reach past them.
