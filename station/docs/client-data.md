---
title: The client data layer
description: "The framework-free polling loop and station stores that every binding uses: poller behaviour, cadence rules, the merge clock rule, and display resolution."
---

`@azohra/meteo.station/client` holds the framework-free polling loop and
station stores that every binding uses. It mirrors
`@azohra/meteo.station/server`, with one subpath for each side of the wire.
The React hooks are thin wrappers over this layer. A binding for any other
framework, or for none, subscribes to the same stores, so every binding
shares one cadence, parser, merge, and degradation path. You can import the
subpath anywhere, including SSR passes and node tests. Its loops only
*run* against a live `fetch`.

If you render with the [React](/docs/station/react/) or
[custom-elements](/docs/station/elements/) binding, you do not call this
layer directly. Read on to build your own binding or to understand the
shared behaviour underneath.

## The mount base

Every entry point takes the **mount base**, which is where
`createStationFeedHandler` is mounted (for example `"/api/wind"`). Each
entry point builds its own route from it, mirroring the handler's
pathname-suffix routing. `feedEndpoint(base)`, `currentEndpoint(base,
stationId)`, and `liveEndpoint(base, stationId)` (exported from
`@azohra/meteo.station`) are the only three routes.

## The poller

`createJsonPoller(url, { parse, intervalMsFor, fetchInit?, initial? })`
returns a store with `getSnapshot()`, `subscribe(listener)`, `start()`,
`stop()`, and `refresh()`. `getSnapshot()` keeps the same object identity
until something changes. The poller behaves the same way for every caller:

- It is visibility-gated. A hidden tab skips its ticks and refetches as soon
  as it becomes visible. Where there is no `document` (SSR, node), the page
  counts as visible.
- It suppresses overlapping requests. A slow response does not stack a
  second request. Every request carries a 15 s abort deadline, so a stalled
  upstream cannot park the loop.
- The first interval starts after the first response. The first timer is
  scheduled once the first response settles, so the interval follows the
  feed's advised cadence instead of the pre-data default.
- It keeps the last document on error. A failed or unreadable poll keeps the
  previous validated document and flags a structured error. That error is
  `{ kind: "network", status? }`, with the HTTP status when a response
  arrived, or `{ kind: "contract", cause? }`, with the zod error (or JSON
  syntax error) behind an unreadable body.
- A seed does not replace the first poll. An `initial` snapshot
  (SSR-fetched data) fills state before the first fetch, and the first poll
  still fires.
- The consumer's `fetchInit` goes with every request (headers, credentials,
  cache mode). Pass a function to thread the latest values. The loop applies
  its own abort signal last, and that signal wins.
- A url change means a new poller. Callers key on the url and construct a
  fresh poller with no seed, so a held document is never served under a new
  address.

## The stores

- `createStationFeedStore(base, { pollSeconds?, fetchInit?, initial? })`
  polls `/feed`. Its cadence is `pollSeconds` if set, else the fastest
  `recommendedPollSeconds` that any station in the last feed advised, else
  60 s.
- `createStationCurrentStore(base, stationId, { pollSeconds?, fetchInit?,
  initial? })` polls the light `/current` endpoint. Its cadence is
  `pollSeconds` if set, else the station's own `recommendedPollSeconds`,
  else 15 s. This endpoint exists to be quick.
- `createStationStore(base, stationId, options)` runs both and folds them
  with `mergeCurrent`. The fold follows a **clock rule**. When a current
  response merges, `receivedAtMs` advances to the current response's value.
  When the merge does not take (the station is unavailable or absent from
  the feed), the feed's own clock stays, so a dead station is not credited
  with a response it did not produce. The feed is the backbone, and its
  error outranks the light endpoint's. `refresh()` fans out to both. With
  `live: true`, the live store below replaces the current-poll leg. The feed
  poll and the fold stay the same.

The fold itself is `foldCurrent(feed, feedReceivedAtMs, current,
currentReceivedAtMs)` on `@azohra/meteo.station`, for callers who compose
their own stores.

## The live store

`createStationLiveStore(base, stationId, { fetchInit?, windowSeconds? })`
subscribes to the `/live` route and folds its
[frames](/docs/station/wire-contract/#the-documents) into one snapshot,
`{ status, station, samples, servedAt, receivedAtMs, error }`.

- `status` is `"connecting" | "open" | "backoff" | "stopped"`.
- `station` is seeded by the `init` frame and refreshed in place by
  `reading` frames. `summaries` frames replace its `recentSummaries` block
  whole.
- `samples` is a rolling window (600 s by default), oldest first,
  deduplicated by `observedAt`. The overlap that a reconnect's `init`
  replays folds away.

`sampleIntervalSeconds` is the cadence that the last samples-bearing frame
stated. It stays `null` until such a frame arrives, and the client never
invents it.

The store handles the transport itself.

- It reconnects with backoff. The backoff is exponential from 1 s, capped at
  30 s, with full jitter, and a successful `init` frame resets it. A
  terminal `unavailable` frame, a server close, an unreadable frame
  (`{ kind: "contract" }`), and a failed request (`{ kind: "network" }`) all
  lead to a reconnect. The last station stays and ages visibly.
- An idle watchdog aborts and reconnects after 60 s without a frame. A
  healthy stream pings about every 20 s. The deadline also covers the
  connect itself.
- It is visibility-gated. A hidden tab disconnects. A tab that becomes
  visible reconnects immediately, and the fresh `init` frame fills the gap.

`liveSnapshotToCurrent(snapshot)` shapes a live snapshot into a
`StationCurrent` for `foldCurrent`, with the rolling window standing in for
the init frame's ring. The `live: true` stores and hooks use it to pass live
data through the existing fold unchanged.

To draw the window, use `WindSampleStrip` on `@azohra/meteo.station/react`.
It is the live counterpart of the history chart, with the same frame, grid,
labelled vane rows, and edge-anchored ticks over the rolling window, and it
draws samples only by design. For a layout the component does not cover,
the composition primitives are still available. `sampleRuns`,
`sampleScales`, `samplePoints`, `sampleMeanDirectionDeg`,
`thinSampleVanes`, and `samplesSummary` on `@azohra/meteo.station` mirror
the history machinery and return the same `ChartScales` and `Vane` shapes,
so `chartFrame`, `vanePath`, and `vaneTicks` draw a sample strip exactly as
they draw the six-hour chart. `sampleRuns` splits at gaps of 2.5 intervals,
the history chart's own tolerance. Build the frame at a measured pixel
width. `measuredChartWidth` implements that rule (in React, the
`useMeasuredChartWidth(ref)` hook). A fixed viewBox stretched by CSS
magnifies every label and stroke.

## Slicing history

Six pure functions on `@azohra/meteo.station` re-slice history `points`
that you have already fetched, without a new fetch. Two of them narrow
which points a component sees, and one turns a whole history into a single
day:

```ts
import {
  METEOROLOGICAL_SEASON_MONTHS, // { winter, spring, summer, fall }: number[] (1-12)
  filterByMonth,                // (points, months, utcOffsetMinutes?) => HistoryPoint[]
  filterByTimeOfDay,            // (points, fromMinute, toMinute, utcOffsetMinutes?) => HistoryPoint[]
  dailyPattern,                 // (points, { slotMinutes?, utcOffsetMinutes? }) => DailyPatternSlot[]
} from "@azohra/meteo.station";
```

When `filterByTimeOfDay` gets `fromMinute > toMinute`, the window wraps past
midnight (a "night" window). Both filters and `dailyPattern` take a plain
UTC offset in minutes instead of an IANA zone. This matches the "local
standard time, no DST" that a station page itself commits to. Pass 0 (the
default) to work in UTC.

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

`compareWindow` requires the history to cover the window, and points merely
present in it are not enough. The edges of the matched span must land
within one typical sample period of the window asked for, with the period
scaled by the same gap tolerance used to judge an outage. Otherwise it
returns `null` instead of drawing a two-point trace.

## Browsing the archive with an injected fetcher

To browse back through months, re-slicing the served points is not enough.
The archive uses fetcher injection. The data contract is one function
shape, and the host decides how a window is served.

```ts
import {
  createStationHistoryStore, // (fetcher, { maxWindows? }) => window-keyed LRU
  stationHistoryFetcher, // (base, stationId, fetchInit?) => StationHistoryFetcher
} from "@azohra/meteo.station/client";
import type { StationHistoryFetcher } from "@azohra/meteo.station/client";
```

`StationHistoryFetcher` is `({ fromMs, toMs, periodMinutes }) =>
Promise<StationHistory | null>`. A host that mounts the feed handler gets
the default implementation from `stationHistoryFetcher`, which calls the
[`/history` route](/docs/station/wire-contract/#the-http-protocol). A host
that serves history its own way, such as through an authenticated server
function or a proxy, supplies any function of that shape and never touches
the handler. `createStationHistoryStore` wraps either one in a window-keyed
LRU. A revisited window costs nothing, a window already in flight is
requested once, and a failed fetch is not cached, so the next request
retries. The served document echoes the `periodMinutes` that the source
actually supplied.

The library ships no archive control surface. The host decides what a pager looks
like. The supporting math ships beside the store:

- `archivePeriodFor` is the vendor-shaped resolution ladder.
- `archiveDayWindow`, `archiveDayValue`, and `archiveDayStep` do LOCAL
  calendar-day arithmetic for a date field and ‹ › steps.
- `archiveTrailingWindow` gives a pager's "today".

Pass the chosen window to the store, and pass the returned points to
[`WindHistoryChart`](/docs/station/react/) with `windowHours`,
`compareOffsetDays`, and `nightShading`.

## Display resolution — shared across bindings

The components resolve ambient defaults through one exported rule,
`resolveDisplay(defaults, props)` on `@azohra/meteo.station`. For
`strings`, `unit` (default `"kmh"`), and `formatTime`, an explicit prop
comes first, then the ambient default, then the package default.
`thresholds` resolves from the explicit prop, then the ambient default,
then nothing. It is a judgment parameter, so the package ships no default
for it, and with none declared, readings go ungraded. Thresholds are a
trichotomy, and every binding preserves the distinction:

- Omitted (`undefined`) inherits the ambient thresholds.
- A value grades against exactly those thresholds.
- `null` explicitly opts this component out of ambient grading.

Per-station components resolve their station with `resolveStation(feed,
stationId)`. An explicit `station` always wins. After that comes
`stationId` looked up in the ambient feed, then the feed's
`primaryStationId`, then `stations[0]`. A `stationId` that matches nothing
is a wiring error and does not fall back. Resolving nothing throws a wiring
error that names the binding's provider. `requireResolved` implements that
rule, and every built-in binding calls the same function.

## Freshness between polls

Freshness itself follows the wire contract's
[model](/docs/station/wire-contract/#freshness-the-servedat-anchor) and is
computed by `freshness()` on the root. Between polls, every binding
re-judges the same reading every `FRESHNESS_REEVALUATE_MS` (30 s). A station
that dies therefore ages visibly while the loop keeps returning the last
observation. The bindings also share the hydration rule. The initial clock
is `receivedAtMs`, a value that both a server pass and the client render
from. They do not use `Date.now()` for it, because it differs between the
passes. Bindings correct to the real clock once mounted.

## Words and formatting

Everything a component prints comes from the isomorphic root, so the two
bindings print identical characters. All of the following are on
`@azohra/meteo.station`:

- The strings vocabulary: `defaultStrings`, `resolveStrings`,
  `mergeStringOverrides`, and `localeFormatTime`.
- The formatting rules: `roundSpeed`, `optionalSpeed`, the one-decimal
  temperature, `updatedAtText`, `summaryEntries`, and `directionCell`.
- The air sentences: `airSummary`, `lastStrikeWords`, and `airRows`.
- The instrument geometry: `DIAL_*`, `ROSE_*`, and the sparkline machinery
  (`historyRuns`, `bandStrips`, and the scales), so a custom sparkline draws
  outage gaps exactly as the built-in one does. The geometry returns
  coordinates and path strings, never markup.

## Stability

The package is pre-1.0. The poller and store behaviour is stable. Pin a
minor version if you reach past it.
