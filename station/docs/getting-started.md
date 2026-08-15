---
title: Getting started
description: Install @azohra/meteo.station, mount the station feed handler, render components against it, and reach the data-level API directly.
---

Two moves: mount the feed handler on your server, then render components
against it. Everything else ([adapters](/docs/station/adapters/),
[theming](/docs/station/theming/), [the React surface](/docs/station/react/),
[the wire itself](/docs/station/wire-contract/)) layers on top of this page.

## Install

```sh
pnpm add @azohra/meteo.station
```

## 1 · Mount the feed

```ts
import { createStationFeedHandler } from "@azohra/meteo.station/server";

// Every station below is fictional — substitute your own identifiers.
const handler = createStationFeedHandler({
  stations: [
    { vendor: "windnerd", id: "bluff", name: "Bluff Launch",
      stationKey: "bluff-launch", locationId: 8675 },
    { vendor: "tempest", id: "meadow", name: "Ridge Meadow",
      stationId: 12345, token: process.env.TEMPEST_TOKEN! },
    { vendor: "campbell", id: "summit", name: "Summit Logger",
      baseUrl: "http://logger.example:30001/.", source: "LOGGER01:Wind Station",
      timeZone: "America/Vancouver", latitude: 49.5, longitude: -118.5 },
    { vendor: "ecowitt", id: "yard", name: "Home Yard",
      applicationKey: process.env.ECOWITT_APPLICATION_KEY!,
      apiKey: process.env.ECOWITT_API_KEY!,
      mac: "FF:FF:FF:FF:FF:FF", elevationM: 1000 },
  ],
  primaryStationId: "summit",
  cors: true,
});

// Mount anywhere that speaks web-standard Request/Response — Node 20+,
// workers, Deno, or a framework route. Routing is by pathname suffix.
export default { fetch: handler }; // e.g. a Cloudflare worker
```

```sh
curl 'https://your.host/wind/feed'                   # every station + history
curl 'https://your.host/wind/feed?hours=2'           # narrower window (≤ the ceiling)
curl 'https://your.host/wind/current?station=summit' # one station, reading only
```

`/feed` answers with a `StationFeed`, every configured station on one
document, whether its upstream answered or not (abbreviated with `…`; the
field names are real):

```json
{
  "schemaVersion": 2,
  "servedAt": "2026-08-05T22:13:00.000Z",
  "primaryStationId": "summit",
  "stations": [
    { "id": "bluff", "name": "Bluff Launch", "status": "ok",
      "capabilities": { "gustLull": true, "history": true, "live": true, … },
      "reading": { "observedAt": "2026-08-05T22:12:45.000Z",
        "windAvgMps": 2.5, "windGustMps": 3.9, "windLullMps": 1.7,
        "windDirectionDeg": 290, … },
      "history": { "periodMinutes": 1, "points": [ … ] }, … },
    { "id": "meadow", "status": "unavailable", "reason": "upstream_error",
      "reading": null, "history": null, … },
    { "id": "summit", "status": "ok", … }
  ]
}
```

`?hours=2` serves the same shape with `history` narrowed to the trailing
two hours. `/current` answers with a `StationCurrent` (one station,
reading only, `history` null):

```json
{
  "schemaVersion": 2,
  "servedAt": "2026-08-05T22:13:00.000Z",
  "station": { "id": "summit", "name": "Summit Logger", "status": "ok",
    "reading": { "observedAt": "2026-08-05T22:12:57.000Z",
      "windAvgMps": 2.5, … },
    "history": null, … }
}
```

A failed upstream keeps its station's slot with `"status": "unavailable"`
and a machine `reason`; the documents, field by field, are the
[wire contract](/docs/station/wire-contract/), with committed annotated
examples in `station/schema/`.

Every field each vendor entry takes, and the quirks its adapter guards,
is on that vendor's reference page:
[WindNerd](/docs/station/adapters/windnerd/),
[Tempest](/docs/station/adapters/tempest/),
[Campbell](/docs/station/adapters/campbell/),
[Ecowitt](/docs/station/adapters/ecowitt/).

`maxHistoryHours` (default 6) is both the default window and the ceiling for
`?hours=`; the range and rejection rules are in
[the HTTP protocol](/docs/station/wire-contract/#the-http-protocol). Routing
matches by pathname suffix by default; pass `basePath: "/api/wind"` to pin
exact-match routes (`/api/wind/feed`, `/api/wind/current`) when several
handlers are mounted beside each other.

Responses carry `Cache-Control` and a weak `ETag`, so unchanged upstreams
revalidate to 304; the derivation is
[the HTTP protocol's](/docs/station/wire-contract/#the-http-protocol).
Override caching for a CDN with:

<!-- meteo-doc-fence: ignore — a handler-option fragment, not a standalone module -->
```ts
cacheControl: (route, maxAge) =>
  `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=30`,
```

### Dynamic configuration

`stations` may also be a resolver (a database read, a KV fetch) called once
per assembly, with the `Request` when the handler invoked it:

<!-- meteo-doc-fence: ignore — one-line sketch; readStationsFromDb is the reader's own -->
```ts
createStationFeedHandler({ stations: async (request) => readStationsFromDb(request) });
```

A station whose config fails validation (or repeats an id) degrades to
`unavailable`/`not_configured` with the zod issues logged; a bad row never
500s the feed. Static arrays get the same check eagerly at construction,
which warns loudly but does not throw.

### The data-level API

The handler is a thin HTTP wrapper. For cron jobs, static builds, or
framework loaders, call the data layer directly:

<!-- meteo-doc-fence: ignore — `stations` is the config array from the mount example above -->
```ts
import { loadStationFeed, loadStationCurrent } from "@azohra/meteo.station/server";

const feed = await loadStationFeed({ stations, historyHours: 3 });             // StationFeed
const current = await loadStationCurrent({ stations, stationId: "summit" });   // StationCurrent
```

Both own the degradation belt (an adapter that throws costs one station,
never the document), `servedAt`, and `schemaVersion`.

## 2 · Render the fleet

```tsx
import "@azohra/meteo.station/styles.css"; // the default skin (an intentional side effect)
import {
  StationFeedProvider, useStation, StationCard, StationTable,
} from "@azohra/meteo.station/react";

function LiveWind() {
  // The argument is the MOUNT BASE — where the handler is mounted. The hook
  // polls `${base}/feed` AND `${base}/current?station=bluff`, folds the
  // fast reading into the full feed, and applies the freshness clock rule.
  const { feed, receivedAtMs } = useStation("/api/wind", "bluff", {
    fetchInit: { cache: "no-store" },
  });
  if (!feed) return null;
  return (
    <div className="meteo-root">
      <StationFeedProvider
        feed={feed}
        receivedAtMs={receivedAtMs}
        thresholds={{ unit: "kmh", values: [12, 20, 28] }} // your wind vocabulary
        unit="knots"                                       // what the numbers wear
      >
        <StationCard />     {/* the feed's primary station, provider-fed */}
        <StationTable />  {/* the whole fleet, no props re-threaded */}
      </StationFeedProvider>
    </div>
  );
}
```

![The station card rendered from a synthetic station, Launch Ridge: the wind dial with lull and gust flanks beside a six-hour graded history chart.](figures/hero-light.svg)

No react? The same page is one module script and plain markup with the
[custom-elements binding](/docs/station/elements/):
`<meteo-station-feed src="/api/wind">` polls the same endpoints through the
same shared stores and its children render the same DOM:

```html
<script type="module">import "@azohra/meteo.station/elements/register";</script>
<meteo-station-feed src="/api/wind" thresholds='{"unit":"kmh","values":[12,20,28]}'>
  <meteo-station-card></meteo-station-card>
  <meteo-station-table></meteo-station-table>
</meteo-station-feed>
```

`useStationFeed(url)` polls the feed alone; `useStation` adds the light
`/current` poll for the station you name. Hooks, the provider contract,
composition, and SSR seeding are covered in [React](/docs/station/react/);
the tokens the components wear are in [Theming](/docs/station/theming/).

## 3 · A season, not a window

[`loadWindnerdStation`](/docs/station/adapters/windnerd/) accepts a record
resolution alongside the window. This is a
[direct-adapter option](/docs/station/adapters/windnerd/#direct-adapter-options):
`loadStationFeed` and `loadStationCurrent` forward only
`{ historyHours, mode, environment }` to any vendor, windnerd included,
so a season pull calls `loadWindnerdStation` itself rather than going
through the fleet-feed API.

A live card wants `historyHours: 6` at the default one-minute resolution. A
season's rose wants months of history at a coarse resolution instead:
`{ historyHours: 24 * 120, recordPeriodMinutes: 180 }` pulls four months as
under a thousand three-hour aggregates, not two hundred thousand raw
minutes. `history.periodMinutes` on the returned document always reflects
the resolution actually served, so `historyGaps` and every duration-aware
reader keep judging dropouts correctly regardless of which one you asked for.

One trap: the 180-minute aggregates bucket by the station's own
[local standard time, not UTC](/docs/station/adapters/windnerd/#aggregate-buckets-follow-local-standard-time).
`dailyPattern` and the month and time-of-day filters default to
`utcOffsetMinutes: 0` (plain UTC), which will look entirely plausible
right up until you compare it to the station's actual afternoon: pass your
station's own standard-time offset (you configured it, or you own the
hardware and already know it) to bucket in local time instead.

The slicing itself is six pure functions on `@azohra/meteo.station`:
`filterByMonth`, `filterByTimeOfDay`, and `dailyPattern` narrow or bucket
the points; `windowPoints`, `compareWindow`, and `compareTracePoints` back
the chart's `windowHours` and `compareOffsetDays` props. Signatures and
rules are in
[the client data layer](/docs/station/client-data/#slicing-history). Feed
the filtered points straight into `<WindRose points={...} />`; feed a whole
history's points into `<DailyPattern points={...} />` (or `station={...}`,
which also turns the caption into a true coverage fraction via the
station's own `periodMinutes` instead of a bare sample count) and it
buckets internally.

## Where next

| Topic | Page |
|---|---|
| The document shape, semantics, and HTTP protocol | [Wire contract](/docs/station/wire-contract/) |
| Built-in vendors, custom adapters, environment injection | [Adapters](/docs/station/adapters/) |
| Hooks, provider, components, SSR | [React](/docs/station/react/) |
| Tokens, dark mode, `@layer` | [Theming](/docs/station/theming/) |
