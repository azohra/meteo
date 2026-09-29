---
title: Getting started
description: Install @azohra/meteo.station, serve your stations as one feed, and render a live station card on your page.
---

This page takes you from a weather station and a website to a live wind
card on that website. You mount a feed handler on your server, check that
it answers, then render components against it. [Adapters](/docs/station/adapters/),
[theming](/docs/station/theming/), [React](/docs/station/react/), and the
[wire contract](/docs/station/wire-contract/) all build on these steps.

## 1. Install the package

```sh
pnpm add @azohra/meteo.station
```

## 2. Mount the feed handler

List your stations and create a handler. Each entry names its vendor, and
the matching [adapter](/docs/station/adapters/) reads that hardware and
converts its readings to the wire contract.

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

// Mount anywhere that speaks web-standard Request/Response — Node 22+,
// workers, Deno, or a framework route. Routing is by pathname suffix, so
// this page mounts everything under /api/wind — the same MOUNT BASE every
// render example below passes.
export default { fetch: handler }; // e.g. a Cloudflare worker
```

Each vendor's page lists every field its entry takes and the quirks its
adapter handles: [WindNerd](/docs/station/adapters/windnerd/),
[Tempest](/docs/station/adapters/tempest/),
[Campbell](/docs/station/adapters/campbell/), and
[Ecowitt](/docs/station/adapters/ecowitt/).

## 3. Check that the feed answers

```sh
curl 'https://your.host/api/wind/feed'               # every station + history
curl 'https://your.host/api/wind/feed?hours=2'       # narrower window (≤ the ceiling)
curl 'https://your.host/api/wind/current?station=summit' # one station, reading only
```

`/feed` returns a `StationFeed`. It holds every configured station in one
document, whether or not that station's upstream answered. In this
abbreviated example, `…` marks omitted fields; the field names are real.

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

The `meadow` entry shows a failed upstream. The station keeps its place in
the feed with `"status": "unavailable"` and a machine-readable `reason`, and
the other stations are unaffected.

`?hours=2` returns the same shape with `history` cut to the last two hours.
`/current` returns a `StationCurrent`, which holds one station's reading and
a null `history`:

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

A third route, `/live`, streams raw samples for stations that declare the
`live` capability. [What your hardware shows](/docs/station/what-your-hardware-shows/)
lists which vendors have it. The [wire contract](/docs/station/wire-contract/)
describes every field, and `station/schema/` holds annotated examples.

## 4. Render a station card

Import the default styles and the React components, poll the handler's
mount base, and render the card and table inside a provider:

```tsx
import "@azohra/meteo.station/styles.css"; // the default skin (an intentional side effect)
import {
  StationFeedProvider, useStation, StationCard, StationTable,
} from "@azohra/meteo.station/react";

function LiveWind() {
  // The argument is the MOUNT BASE — where the handler is mounted. The hook
  // polls `${base}/feed` AND `${base}/current?station=summit`, folds the
  // fast reading into the full feed, and applies the freshness clock rule.
  const { feed, receivedAtMs } = useStation("/api/wind", "summit", {
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

You should see a card for the primary station and a table of every station
in the feed:

![The station card for a synthetic station, Launch Ridge, with a wind dial beside a six-hour wind history chart.](figures/hero-light.svg)

The history chart appears only for a station that declares `history`.
WindNerd and Campbell do. Tempest and Ecowitt serve only the latest
reading, so their cards show the dial and readouts without a chart.
[What your hardware shows](/docs/station/what-your-hardware-shows/) maps
each capability to the components that use it.

`useStation` polls the feed and adds a lighter `/current` poll for the
station you name. `useStationFeed(url)` polls the feed alone. Hooks,
composition, and seeding the provider during server-side rendering are
covered in
[React](/docs/station/react/), and the tokens behind the default styles are
in [Theming](/docs/station/theming/).

### Without React

The [custom-elements binding](/docs/station/elements/) renders the same
page with one module script and plain markup. `<meteo-station-feed>` polls
the same endpoints through the same stores, and its children render the
same DOM as the React components:

```html
<script type="module">import "@azohra/meteo.station/elements/register";</script>
<meteo-station-feed src="/api/wind" thresholds='{"unit":"kmh","values":[12,20,28]}'>
  <meteo-station-card></meteo-station-card>
  <meteo-station-table></meteo-station-table>
</meteo-station-feed>
```

## Handler options

`maxHistoryHours` defaults to 6. It sets both the default history window
and the largest value `?hours=` accepts; the range and rejection rules are
in [the HTTP protocol](/docs/station/wire-contract/#the-http-protocol).

Routes match by pathname suffix by default. When several handlers are
mounted side by side, pass `basePath: "/api/wind"` to match exact routes
(`/api/wind/feed`, `/api/wind/current`) instead.

Responses carry `Cache-Control` and a weak `ETag`, so a client revalidating
an unchanged feed gets a 304. [The HTTP protocol](/docs/station/wire-contract/#the-http-protocol)
explains how both are derived. To set your own caching for a CDN:

<!-- meteo-doc-fence: ignore — a handler-option fragment, not a standalone module -->
```ts
cacheControl: (route, maxAge) =>
  `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=30`,
```

### Load stations at request time

`stations` can also be a function, such as a database or KV read. The
handler calls it once each time it assembles a document, passing the
`Request` when there is one:

<!-- meteo-doc-fence: ignore — one-line sketch; readStationsFromDb is the reader's own -->
```ts
createStationFeedHandler({ stations: async (request) => readStationsFromDb(request) });
```

A station whose config fails validation, or repeats another station's id,
becomes `unavailable` with reason `not_configured`, and the zod issues are
logged. A bad row never makes the feed return a 500. A static array gets
the same check once, when the handler is created; it logs a warning and
does not throw.

### Call the data layer directly

The handler is a thin HTTP wrapper. Cron jobs, static builds, and framework
loaders can call the functions beneath it:

<!-- meteo-doc-fence: ignore — `stations` is the config array from the mount example above -->
```ts
import { loadStationFeed, loadStationCurrent } from "@azohra/meteo.station/server";

const feed = await loadStationFeed({ stations, historyHours: 3 });             // StationFeed
const current = await loadStationCurrent({ stations, stationId: "summit" });   // StationCurrent
```

Both set `servedAt` and `schemaVersion`, and both contain failures the same
way the handler does: an adapter that throws marks its own station
unavailable and leaves the rest of the document intact.

## Where next

| If you want to | Read |
|---|---|
| Configure your vendor's station entry | Your vendor's page under [Adapters](/docs/station/adapters/) |
| Find out why a station has no chart or column | [What your hardware shows](/docs/station/what-your-hardware-shows/) |
| Build layouts beyond the card and table | [React](/docs/station/react/), or [custom elements](/docs/station/elements/) without a framework |
| Match your site's colours | [Theming](/docs/station/theming/) |
| Pull a season of WindNerd records at coarse record resolution | [Direct-adapter options](/docs/station/adapters/windnerd/#direct-adapter-options) |
| Slice history yourself | [Client data](/docs/station/client-data/#slicing-history) |
| See exactly what the handler sends | [Wire contract](/docs/station/wire-contract/) |
