---
title: The wire contract
description: The document shapes, semantics, evolution rules, HTTP protocol, and freshness model between a station feed handler and its clients.
---

The contract between a station feed handler and its clients. JSON Schema and
annotated examples ship in the package under
[`schema/`](https://github.com/azohra/meteo/tree/main/station/schema),
generated from the zod source of truth,
[`station/src/contract.ts`](https://github.com/azohra/meteo/blob/main/station/src/contract.ts),
exported from `@azohra/meteo.station`.

## The documents

`StationFeed` is `{ schemaVersion, servedAt, primaryStationId, stations[] }`.
Each station carries its identity and declared capabilities on both arms of a
status union:

- `status: "ok"`: a `reading` (windowed average, gust/lull, direction,
  temperature, optional extended `conditions`) plus `history` when the
  station keeps one. Two nullish blocks ride this arm where the source
  serves them: `telemetry` (device health: today `batteryVoltage`, volts)
  and `samples` (`{ intervalSeconds, points }` of instantaneous
  `LiveSample`s).
- `status: "unavailable"`: a machine `reason` code; `reading` and
  `history` are null. Never prose, never stale numbers. The vocabulary is
  [core's four upstream-failure codes](/docs/core/failures-and-schema/#the-failure-vocabulary)
  plus one of station's own, `not_configured` (`UNAVAILABLE_REASONS` in
  `contract.ts`).

`StationCurrent` is `{ schemaVersion, servedAt, station }`: one station,
reading only, history null. It reuses the station shape so clients need one
decoder.

`StationLiveFrame` is the unit of the `/live` stream: one JSON document per
SSE data event, discriminated on `type`:

| Frame | Carries | Cadence |
|---|---|---|
| `init` | `{ schemaVersion, servedAt, station }`: a full ok station with its sample ring | once per connection |
| `samples` | `{ stationId, samples }`: the newest batch of instantaneous samples | as the source batches them |
| `reading` | `{ stationId, servedAt, reading, telemetry }`: a fresh reading | as the source digests |
| `ping` | `{ servedAt }`: keepalive; feeds the client's idle watchdog | ~20 s |
| `unavailable` | `{ stationId, reason }`: terminal; the stream closes after it | on failure |

One station entry from the committed example
[`schema/example-feed.json`](https://github.com/azohra/meteo/blob/main/station/schema/example-feed.json):
the `unavailable` arm, identity and capabilities intact, `reading` and
`history` null:

```json
{
  "id": "narrows",
  "name": "Gorge Narrows",
  "sourceLabel": "Campbell logger",
  "pageUrl": "https://example.com/stations/gorge-narrows",
  "latitude": 49.3,
  "longitude": -118.8,
  "timeZone": "America/Vancouver",
  "elevationM": 460,
  "capabilities": {
    "gustLull": true,
    "temperature": true,
    "conditions": false,
    "history": true
  },
  "samplingWindowSeconds": 3,
  "recommendedPollSeconds": 15,
  "status": "unavailable",
  "reason": "upstream_error",
  "reading": null,
  "history": null
}
```

Parse helpers ship with the contract: `parseStationFeed(Json)` /
`parseStationCurrent(Json)` / `parseStationLiveFrame(Json)` return the typed
document or null; they never throw.

## Semantics

- **Capabilities are declared, never inferred.** A station that carries no
  thermometer says so in `capabilities`; a thermometer that is dark right now
  reports null. The two are different facts and both are representable.
  Capabilities gate client UI structure; a dark sensor keeps its structure.
- **Absence stays absent.** A missing quantity is null, never zero.
  `windGustMps: null` means "not measured", not "no gust".
- **Calm carries no direction.** Below the WMO calm threshold (0.5 m/s,
  `CALM_THRESHOLD_MPS`) `windDirectionDeg` is null: a vane parked below its
  start-up torque, or a sonic head reading thermal drift, would fabricate a
  bearing. The measured speed still travels. A null direction on a blowing
  reading is a dead vane.
- **A dropout is an absent record, never a zeroed one.** Gaps in
  `history.points` carry no points; `periodMinutes` is on the wire because
  wind run, vane thinning, and dropout detection are all functions of it; a
  client cannot treat 1-minute records and 5-minute logger records alike.
- **A `LiveSample` is an instant, not a mean.** `HistoryPoint.windAvgMps` is
  contractually a period mean; `LiveSample.windMps` is a single anemometer
  sample. The shapes are separate so neither can pose as the other. The calm
  and dropout rules apply to both.
- **Telemetry is device health, not weather.** `batteryVoltage` sits in its
  own block beside the reading, gated by the `battery` capability, and never
  inside `conditions`: air data stays air data. Like every sensor field, a
  declared battery that reports nothing is null, not absent structure.
- **Declared favorable sectors are data, not judgment.**
  `declaredFavorableDirections` on the meta carries what the *source*
  declares about the spot (null or absent = nothing knowable, `[]` =
  explicitly none). No component reads it: a consumer adopts it explicitly —
  `favorableDirections={declaredFavorableDirections(station) ?? ownArcs}` —
  so a vendor's opinion never becomes a judgment default. The optional
  `broadcastDelaySeconds` states the source's own live-playback delay.
- **History points may carry per-period extremes and the vector mean.**
  `windVectorAvgMps`, `temperatureMinC`/`temperatureMaxC`, and
  `seaLevelPressureMinHpa`/`seaLevelPressureMaxHpa` are additive and
  nullish: absent or null reads as "not published here", never zero. The
  vector mean is at most `windAvgMps` and is the honest input for further
  vector re-aggregation.
- **No prose on the wire.** Failures carry a reason code; degrees, not
  compass words. Display language, units, and colours are the client's.
- **Units are SI: speeds are m/s**, converted for display via
  `speedFromMps`. Everything else keeps its conventional unit: °C, hPa, mm,
  km (lightning distance), W/m², degrees.
- **The `conditions` block is extensible, not universal.** It is
  WeatherFlow-shaped (pressure-trend enum, one-hour lightning bucket,
  station-local "today" fields; the
  [Tempest adapter](/docs/station/adapters/tempest/) fills every field of
  it) and every field is nullable; null means "not reported here" and does
  not distinguish a missing sensor from a dark one; the station-level
  capability flag gates the block.

## Evolution rules

Normative, not advisory — the same additive/breaking pattern
[Compatibility](/docs/compatibility/) states for the forecast document
families, applied to `STATION_SCHEMA_VERSION`:

- An **additive change** (a new field) never bumps `STATION_SCHEMA_VERSION`. New
  fields arrive nullable, with null meaning what absence meant before.
  Readers ignore unknown keys; the schemas parse in strip mode, and that is
  load-bearing.
- New **capability keys** must arrive nullish (null = undeclared = false): a
  required boolean would brick every already-published document that predates
  the key.
- `STATION_SCHEMA_VERSION` bumps only when an existing field changes meaning, unit,
  or shape, or is removed. A reader rejecting an unrecognized version is then
  the intended behaviour, not a bug.
- Because parsing strips unknown keys, **parse-then-reserialize is lossy**. A
  proxy must pass bodies through verbatim.

## The HTTP protocol

A mounted handler serves three routes (suffix-matched by default;
exact-matched under `basePath`):

| Route | Document | Notes |
|---|---|---|
| `GET …/feed` | `StationFeed` | Every station + history. `?hours=` narrows the window; it must be in `(0, maxHistoryHours]` (default 6), out of range is a 400; valid values snap to quarter-hour steps. |
| `GET …/current?station=<id>` | `StationCurrent` | One station, reading only: the light poll. |
| `GET …/live?station=<id>` | `StationLiveFrame` stream | SSE (`text/event-stream`), one frame per data event. `?hours=` is ignored; live carries no history. |

Feed and current responses carry `Cache-Control` derived from upstream cache
TTLs and a weak `ETag` computed over station content excluding `servedAt`, so
unchanged upstreams revalidate to 304. One broken station degrades to a
reason code; the feed survives. A handler 500s only when it cannot produce a
document at all.

The live route never caches (`Cache-Control: no-cache, no-store`, no ETag).
Errors before the stream opens are JSON with a status: 400 with no
`?station=`, 404 for an unknown station or a station whose vendor has no
live arm, 502 with `{ error, reason }` when the upstream connect fails.
After the stream opens, failure is a terminal `unavailable` frame and a
close; the client reconnects, and the fresh `init` frame is the resume
story: there are no SSE ids. Each client connection holds one upstream
connection: the handler does not multiplex, so a host expecting many
concurrent viewers of one station terminates fan-out in its own
infrastructure using the exported `openWindnerdLive` + `encodeStationLiveSse`
seam.

## Freshness: the servedAt anchor

Freshness is judged **on the client, but against the server's clock**. The
wire carries each reading's `observedAt` plus the document's `servedAt` (the
server clock at response time); the client records when it received the
response (`receivedAtMs`) and computes

```
age = (servedAt − observedAt) + (now − receivedAtMs)
```

so a wrong client clock cannot declare a live station stale (or a dead one
live). `freshness()` in `@azohra/meteo.station` grades that age into
`"live" | "aging" | "stale"`; `stationFreshnessThresholds()` scales the
cutoffs to the station's own cadence: ten minutes of silence is routine for
a five-minute logger and a dead feed for a three-second one.

![Three timeline lanes (station, server, client) with the four instants the freshness model reads: the station stamps observedAt, the server stamps servedAt, and the client records receivedAtMs and later reads now on a wall clock running four minutes fast. Braces mark the age's two terms, 15 seconds measured entirely from wire values and 30 seconds measured entirely on the client, summing to 45 seconds, while the naive now minus observedAt on the fast client clock would read 4 minutes 52 seconds and misread a live station as stale.](figures/freshness-clocks.svg)

Each station also advertises `recommendedPollSeconds`, matched to upstream
cache TTLs; see [polling etiquette](/docs/station/adapters/#polling-etiquette).
