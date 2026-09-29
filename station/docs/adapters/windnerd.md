---
title: WindNerd
description: "The WindNerd adapter: station key and location id, the temperature, pressure, and battery flags, the records and live endpoints, and the m/s series it validates."
---

WindNerd stations are wind sensors that report to the vendor's site,
[windnerd.net](https://windnerd.net), where each station has a public page.
The adapter reads the same records API and live stream that page calls, and
normalizes the m/s series into
[wire documents](/docs/station/wire-contract/).

## Configuration

`vendor: "windnerd"` selects this adapter. The entry is validated by
`windnerdStationConfigSchema`, exported from `@azohra/meteo.station/server`.

| Field | Type | Meaning |
|---|---|---|
| `id` | string, required | Your feed-local station id, the value `?station=` and `primaryStationId` name. |
| `name` | string, required | The display name carried on the wire. |
| `stationKey` | string, required | The station's key on windnerd.net. Give a bare key (`bluff-launch`) or the station page URL (`https://windnerd.net/en/bluff-launch`). Both normalize to the key. Sets the default `pageUrl`. |
| `locationId` | positive integer, required | The numeric location id the records API is queried by. It is a different identifier from the station key. |
| `hasTemperature` | boolean, default `true` | Whether the station carries a thermometer. Declares the `temperature` capability. When `false`, temperature stays null even if the upstream sends values. |
| `hasPressure` | boolean, default `false` | Whether the station carries a barometer. Declares the `conditions` capability and requires `elevationM`. |
| `hasBattery` | boolean, default `false` | Whether the station reports battery voltage (OnSpot hardware does). Declares the `battery` capability. When `false`, telemetry stays null even if the upstream sends a voltage. |
| `elevationM` | number, optional | The elevation of the sensor itself, not of the launch. Sea-level pressure reduction uses it, so config validation rejects `hasPressure: true` without it. |
| `latitude`, `longitude` | numbers, optional | Position claims, carried on the wire. |
| `timeZone` | IANA zone, optional | Carried on the wire for display. The records API stamps UTC instants, so parsing does not need it. |
| `pageUrl` | http(s) URL, optional | Overrides the default `https://windnerd.net/en/<stationKey>`. |

## Capabilities

`{ gustLull: true, temperature: hasTemperature, conditions: hasPressure,
history: true, live: true, battery: hasBattery }`.

Gust/lull and history are always declared because every record carries
them. `live` is always declared because the live stream belongs to the
WindNerd platform as a whole rather than to one station. Temperature,
conditions, and battery come from config claims. The upstream serves
nullable values for every station, and a series that happens to carry
numbers does not count as a declaration
([capabilities are declared from the hardware](/docs/station/adapters/#the-rulebook)).
`samplingWindowSeconds` and `recommendedPollSeconds` are both 60, because
the raw records are one-minute averages. A current-mode load served from
the live stream advertises `recommendedPollSeconds: 15`.

## Endpoints

The adapter uses two vendor endpoints, and neither needs authentication.
It validates every value in vendor units, degrades to `unavailable` on any
contract break, and identifies itself with the project
[User-Agent](/docs/station/adapters/#environment-injection).

The records endpoint,
`GET https://windnerd.net/api/records?location_id=…&from=…&to=…&period=…`,
serves the m/s series behind full-mode loads. That is the 6-hour history,
with its last record as the reading. Responses cache for 60 seconds at the
raw one-minute period and 900 seconds at aggregate periods, under the key
`windnerd/<locationId>/<historyHours>/<periodMinutes>`.

The live endpoint, `GET https://windnerd.net/api/live-url/<stationKey>`, is
an SSE stream. It opens with one `INIT` frame carrying a digest and a ring
of 3-second samples (about ten minutes). After that it sends a
`WIND_SAMPLES` batch and a `LAST_DIGEST` refresh each minute, with `ping`
keepalives between. The samples have 3-second resolution but arrive in
one-minute batches, so no consumer sees a sample sooner than the batch that
carries it.

The live stream is used in two ways.

- Current mode (`mode: "current"`) reads only the `INIT` frame and hangs
  up. The reading and telemetry come from the digest, the sample ring
  becomes `samples`, and the digest's ten 1-minute and twelve 5-minute step
  blocks become `recentSummaries`. History is null. The frame caches for 15
  seconds under `windnerd/live/<locationId>`. When the live connect fails,
  current mode falls back to the records endpoint and logs the failure, so
  a broken stream leaves current mode no worse than it would be without
  one.
- The open stream, `openWindnerdLive(config, options)`, maps upstream
  frames to [`StationLiveFrame`s](/docs/station/wire-contract/#the-documents)
  for the handler's `/live` route or a host's own transport. The connect
  phase (headers plus `INIT`) rejects on failure. After that, a failure
  emits a terminal `unavailable` frame. A mid-stream contract break closes
  as `contract_break`, an upstream hangup as `upstream_error`, and 75
  seconds of silence (three missed keepalives) as `timeout`. Unknown
  upstream frame types are ignored, so a new vendor frame does not break
  the stream. The server does not reconnect. The client owns the backoff
  loop, and every reconnect gets a fresh `INIT`.

### Direct-adapter options

Beyond the shared `{ historyHours, mode, environment }`,
`loadWindnerdStation(config, options)` accepts:

| Option | Meaning |
|---|---|
| `recordPeriodMinutes` | Record resolution in minutes: `1` (default), `5`, `10`, `15`, `30`, `60`, `180`, or `360`. This is the vendor's own catalogue, verified live (every other value 404s upstream). Any other value throws before fetching. |
| `cacheTtlSeconds` | Overrides the 60 s (period 1) / 900 s (aggregate) default. |
| `recordsUrl` | Overrides the records endpoint, for tests and proxies. |
| `liveUrl` | Overrides the live endpoint base, for tests and proxies. |

The fleet API (`loadStationFeed` and the mounted handler) forwards none of
these options, so a season pull at period 180 calls `loadWindnerdStation`
directly. The slicing functions that turn a season of points into roses and
daily patterns are in
[the client data layer](/docs/station/client-data/#slicing-history).

### Aggregate buckets follow local standard time

At aggregate periods the vendor buckets records by the station's own local
standard time. This was confirmed live. The local grid is the ordinary
`00:00, 03:00, 06:00…`, so for a station eight hours west of UTC those
boundaries arrive stamped `08:00Z, 11:00Z, 14:00Z…`. Each `date_utc` is the
correct UTC instant of its local boundary, and the buckets are not aligned
to UTC. The adapter does not parse the response's historical `time_offset`
column, which is absent below period 180 and is a per-record column where
it appears. The standard offset comes instead from the live `INIT` frame's
location block as `standard_timeoffset`, which `parseWindnerdLiveLocation`
surfaces as `standardUtcOffsetMinutes`. That offset is the correct clock
for climatological bucketing.

### The location block enriches the meta

The live `INIT` frame carries the spot's public metadata, and the adapter
keeps it. `dir_ranges` land on the wire as
[`declaredFavorableDirections`](/docs/station/wire-contract/#the-documents).
That is vendor-declared data a consumer may adopt, and components do not
read it as a default. The frame's `delay` becomes `broadcastDelaySeconds`.
`altitude`, `timezone`, and `guessed_position` fill only the meta fields
the consumer's config left null, so config always wins. Current mode reads
the block off the `INIT` frame it already has. Full (records) mode reads it
through a 6-hour cache under `windnerd/location/<locationId>`, so a feed
poll does not pay for a live connection. When the live endpoint is down, a
15-minute negative cache applies. Enrichment is best-effort. A failure
declares nothing and does not fail the load.

## What the adapter guards

- Speeds arrive in m/s, the wire's own unit, so nothing converts. They are
  validated in the vendor's units. Every average, gust, lull, and sample
  must be finite and within 0–140 m/s. The vendor's dashboard displays
  km/h by multiplying its stored m/s by 3.6 [verified 2026-08-14: location
  240's hourly `wind_avg_1D` values times 3.6 reproduce the station page's
  km/h table exactly]. Directions are validated 0–360 and normalized. A
  calm reading (below the WMO threshold) carries a null direction.
- The current reading is the last history record. A response with no
  records, or with series whose lengths disagree, throws. The station then
  degrades instead of serving an empty document.
- Temperature and pressure are nullable series. The reading takes the
  latest non-null value only when it lies within 15 minutes of the wind
  reading, and is null otherwise, so a sensor that stopped an hour ago is
  not reported as current.
- Live values are held to the same bounds: samples and digest winds 0–140
  m/s, directions 0–360, pressure 300–1100 hPa, and voltage 0–100 V. A live
  reading prefers the freshest complete minute's scalar average (with its
  gust and lull) over the digest's vector average, which matches what the
  records serve. The ring's empty slots are dropped rather than zeroed.
- Station pressure is validated 300–1100 hPa and reduced to sea level using
  `elevationM` and the co-timed temperature. The pressure trend is derived
  from the reduced history with `pressureTendency`. These are the same
  public derivations [custom adapters are asked to match](/docs/station/adapters/#the-custom-arm).
- `standard_timeoffset`, the station's local standard-time offset from the
  live location block, is validated to −720…+840 minutes. An out-of-range
  value reads as null.
  [Aggregate buckets follow local standard time](#aggregate-buckets-follow-local-standard-time)
  explains what it means and where it surfaces.
- Record times must parse as instants. An unparseable `date_utc` throws.

## Setup

```ts
import { createStationFeedHandler } from "@azohra/meteo.station/server";

const handler = createStationFeedHandler({
  stations: [
    {
      vendor: "windnerd",
      id: "bluff",
      name: "Bluff Launch",
      stationKey: "bluff-launch", // or "https://windnerd.net/en/bluff-launch"
      locationId: 8675,
      hasPressure: true,
      elevationM: 1180, // the sensor's elevation — pressure reduction needs it
      timeZone: "America/Vancouver",
    },
  ],
});

export default { fetch: handler };
```

## Where next

To render the station, [getting started § 2](/docs/station/getting-started/)
mounts the card against your feed. WindNerd declares every capability
([What your hardware shows](/docs/station/what-your-hardware-shows/)), so
the chart, the trend, and the `/live` stream all apply. Pick
[React](/docs/station/react/) or [custom elements](/docs/station/elements/),
then [theming](/docs/station/theming/).
