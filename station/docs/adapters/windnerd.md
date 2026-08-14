---
title: WindNerd
description: The WindNerd adapter — station key and location id, the temperature, pressure, and battery flags, the records and live endpoints, and the m/s series it validates.
---

WindNerd stations are wind sensors that report to the vendor's site,
[windnerd.net](https://windnerd.net), where each station has a public page.
The adapter reads the same records API and live stream that page calls and
normalizes the m/s series into
[wire documents](/docs/station/wire-contract/).

## Configuration

`vendor: "windnerd"` selects this adapter. The entry is validated by
`windnerdStationConfigSchema` (exported from `@azohra/meteo.station/server`):

| Field | Type | Meaning |
|---|---|---|
| `id` | string, required | Your feed-local station id — what `?station=` and `primaryStationId` name. |
| `name` | string, required | The display name carried on the wire. |
| `stationKey` | string, required | The station's key on windnerd.net — a bare key (`bluff-launch`) or the station page URL (`https://windnerd.net/en/bluff-launch`); both normalize to the key. Sets the default `pageUrl`. |
| `locationId` | positive integer, required | The numeric location id the records API is queried by. It is a different identifier from the station key. |
| `hasTemperature` | boolean, default `true` | Whether the station carries a thermometer. Declares the `temperature` capability; when `false`, temperature stays null even if the upstream sends values. |
| `hasPressure` | boolean, default `false` | Whether the station carries a barometer. Declares the `conditions` capability and requires `elevationM`. |
| `hasBattery` | boolean, default `false` | Whether the station reports battery voltage (OnSpot hardware does). Declares the `battery` capability; when `false`, telemetry stays null even if the upstream sends a voltage. |
| `elevationM` | number, optional | The **sensor's** elevation, not the launch's — sea-level pressure reduction uses it, so config validation rejects `hasPressure: true` without it. |
| `latitude`, `longitude` | numbers, optional | Position claims, carried on the wire. |
| `timeZone` | IANA zone, optional | Carried on the wire for display; the records API stamps UTC instants, so parsing does not need it. |
| `pageUrl` | http(s) URL, optional | Overrides the default `https://windnerd.net/en/<stationKey>`. |

## Capabilities

`{ gustLull: true, temperature: hasTemperature, conditions: hasPressure,
history: true, live: true, battery: hasBattery }`.

Gust/lull and history are always declared — every record carries them — and
`live` is always declared: the live stream is a property of the WindNerd
platform, not of one station. Temperature, conditions, and battery are
config claims, not observations: the upstream serves nullable values for
every station, and a value that happens to carry numbers is not a
declaration
([capabilities are declared, never inferred](/docs/station/adapters/#the-rulebook)).
`samplingWindowSeconds` and `recommendedPollSeconds` are both 60 — the raw
records are one-minute averages — and a current-mode load served from the
live stream advertises `recommendedPollSeconds: 15`.

## Endpoints

Two vendor endpoints, both unauthenticated, both treated as guests: the
adapter validates every value in vendor units, degrades to `unavailable` on
any contract break rather than guessing, and identifies itself with the
project [User-Agent](/docs/station/adapters/#environment-injection).

**Records** — `GET https://windnerd.net/api/records?location_id=…&from=…&to=…&period=…`
serves the m/s series behind full-mode loads: the 6-hour history and its
last record as the reading. Responses cache for 60 seconds at the raw
one-minute period and 900 seconds at aggregate periods, under the key
`windnerd/<locationId>/<historyHours>/<periodMinutes>`.

**Live** — `GET https://windnerd.net/api/live-url/<stationKey>` is an SSE
stream: one `INIT` frame carrying a digest and a ring of 3-second samples
(about ten minutes), then a `WIND_SAMPLES` batch and a `LAST_DIGEST` refresh
each minute, with `ping` keepalives between. The samples are 3-second
resolution delivered in one-minute batches — no consumer sees a sample
sooner than the batch that carries it.

The live stream backs two arms:

- **Current mode** (`mode: "current"`) reads only the `INIT` frame and hangs
  up: reading and telemetry from the digest, the sample ring as `samples`,
  history null. The frame caches for 15 seconds under
  `windnerd/live/<locationId>`. When the live connect fails, current falls
  back to the records road and logs the failure — a broken stream never
  makes current worse than it was without one.
- **The open stream** — `openWindnerdLive(config, options)` — maps upstream
  frames to [`StationLiveFrame`s](/docs/station/wire-contract/#the-documents)
  for the handler's `/live` route or a host's own transport. The connect
  phase (headers plus `INIT`) rejects on failure; after that, failures emit
  a terminal `unavailable` frame: mid-stream contract breaks close as
  `contract_break`, an upstream hangup as `upstream_error`, and 75 seconds
  of silence — three missed keepalives — as `timeout`. Unknown upstream
  frame types are ignored; the vendor's future is not a contract break.
  There is no server-side reconnect: the client owns the backoff loop, and
  every reconnect gets a fresh `INIT`.

### Direct-adapter options

Beyond the shared `{ historyHours, mode, environment }`,
`loadWindnerdStation(config, options)` accepts:

| Option | Meaning |
|---|---|
| `recordPeriodMinutes` | Record resolution: `1` (default), `15`, `60`, or `180` — the vendor's own whitelist; any other value throws before fetching. |
| `cacheTtlSeconds` | Overrides the 60 s (period 1) / 900 s (aggregate) default. |
| `recordsUrl` | Overrides the records endpoint, for tests and proxies. |
| `liveUrl` | Overrides the live endpoint base, for tests and proxies. |

The fleet API (`loadStationFeed`, the mounted handler) forwards none of
these — a season pull at period 180 calls the adapter directly, as
[getting started § 3](/docs/station/getting-started/#3--a-season-not-a-window)
walks through.

### Aggregate buckets follow local standard time

At period 180 the vendor buckets by the station's own local standard time,
not UTC — confirmed live: the local grid is the ordinary
`00:00, 03:00, 06:00…`, but a station eight hours west of UTC has those
boundaries arrive stamped `08:00Z, 11:00Z, 14:00Z…` — each `date_utc` is the
correct UTC instant of its local boundary, not a UTC-aligned bucket. The
response carries that offset as `time_offset` — one entry per record, not a
single field, and only at period 180 — and `parseWindnerdRecords` takes the
first, surfacing it as the result's `utcOffsetMinutes`. It is not on the
`Station` document `loadWindnerdStation` returns; only a caller running
`parseWindnerdRecords` directly against the raw upstream text sees it.

## What the adapter guards

- Speeds arrive in m/s — the wire's own unit, so nothing converts — and are
  validated in the vendor's units: every average, gust, lull, and sample
  must be finite and within 0–140 m/s. The vendor's dashboard displays
  km/h, multiplying its stored m/s by 3.6 [verified 2026-08-14: location
  240's hourly `wind_avg_1D` values times 3.6 reproduce the station page's
  km/h table exactly]. Directions are validated 0–360 and normalized; a
  calm reading (below the WMO threshold) carries a null direction.
- The current reading is the last history record. A response with no
  records, or with series whose lengths disagree, throws — the station
  degrades instead of serving an empty document.
- Temperature and pressure are nullable series and go stale honestly: the
  reading takes the latest non-null value only when it lies within 15
  minutes of the wind reading, otherwise null — a sensor that stopped an
  hour ago does not pose as current.
- Live values hold to the same bounds — samples and digest winds 0–140 m/s,
  directions 0–360, pressure 300–1100 hPa, voltage 0–100 V — and a live
  reading takes the freshest complete minute's scalar average (with its
  gust and lull) over the digest's vector average, matching what records
  serve. The ring's empty slots are dropped, never zeroed.
- Station pressure is validated 300–1100 hPa and reduced to sea level using
  `elevationM` and the co-timed temperature; the pressure trend is derived
  from the reduced history via `pressureTendency` — the same public
  derivations [custom adapters are asked to match](/docs/station/adapters/#the-custom-arm).
- `time_offset` — the station's local standard-time offset — is validated
  to −720…+840 minutes; what it means and where it surfaces is
  [Aggregate buckets follow local standard time](#aggregate-buckets-follow-local-standard-time).
- Record times must parse as instants; an unparseable `date_utc` throws.

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
