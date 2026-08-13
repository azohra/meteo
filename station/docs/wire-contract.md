---
title: The wire contract
description: The document shapes, semantics, evolution rules, HTTP protocol, and freshness model between a station feed handler and its clients.
---

The contract between a station feed handler and its clients. JSON Schema and
annotated examples live in
[`schema/`](https://github.com/azohra/meteo/tree/main/station/schema) — regenerate
with `pnpm schemas`; a drift test keeps the committed files
in sync. The zod source of truth is
[`station/src/contract.ts`](https://github.com/azohra/meteo/blob/main/station/src/contract.ts),
exported from `@azohra/meteo.station`.

## The documents

`StationFeed` is `{ schemaVersion, servedAt, primaryStationId, stations[] }`.
Each station carries its identity and declared capabilities on both arms of a
status union:

- `status: "ok"` — a `reading` (windowed average, gust/lull, direction,
  temperature, optional extended `conditions`) plus `history` when the
  station keeps one.
- `status: "unavailable"` — a machine `reason` code
  (`upstream_error`, `contract_break`, `timeout`, `not_configured`,
  `rate_limited`); `reading` and `history` are null. Never prose, never
  stale numbers.

`StationCurrent` is `{ schemaVersion, servedAt, station }` — one station,
reading only, history null. It reuses the station shape so clients need one
decoder.

Parse helpers ship with the contract: `parseStationFeed(Json)` /
`parseStationCurrent(Json)` return the typed document or null — never throw.

## Semantics

- **Capabilities are declared, never inferred.** A station that carries no
  thermometer says so in `capabilities`; a thermometer that is dark right now
  reports null. The two are different facts and both are representable.
  Capabilities gate client UI structure; a dark sensor keeps its structure.
- **Absence stays absent.** A missing quantity is null, never zero.
  `windGustMps: null` means "not measured", not "no gust".
- **Calm carries no direction.** Below the WMO calm threshold (0.5 m/s,
  `CALM_THRESHOLD_MPS`) `windDirectionDeg` is null — a vane parked below its
  start-up torque, or a sonic head reading thermal drift, would fabricate a
  bearing. The measured speed still travels. A null direction on a blowing
  reading is a dead vane.
- **A dropout is an absent record, never a zeroed one.** Gaps in
  `history.points` carry no points; `periodMinutes` is on the wire because
  wind run, vane thinning, and dropout detection are all functions of it — a
  client cannot treat 1-minute records and 5-minute logger records alike.
- **No prose on the wire.** Failures carry a reason code; degrees, not
  compass words. Display language, units, and colours are the client's.
- **Units are SI: speeds are m/s**, converted for display via
  `speedFromMps`. Everything else keeps its conventional unit: °C, hPa, mm,
  km (lightning distance), W/m², degrees.
- **The `conditions` block is extensible, not universal.** It is
  WeatherFlow-shaped (pressure-trend enum, one-hour lightning bucket,
  station-local "today" fields — the
  [Tempest adapter](/docs/station/adapters/tempest/) fills every field of
  it) and every field is nullable; null means "not reported here" and does
  not distinguish a missing sensor from a dark one — the station-level
  capability flag gates the block.

## Evolution rules

Normative, not advisory:

- An **additive change** (a new field) never bumps `STATION_SCHEMA_VERSION`. New
  fields arrive nullable, with null meaning what absence meant before.
  Readers ignore unknown keys — the schemas parse in strip mode, and that is
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

A mounted handler serves two routes (suffix-matched by default; exact-matched
under `basePath`):

| Route | Document | Notes |
|---|---|---|
| `GET …/feed` | `StationFeed` | Every station + history. `?hours=` narrows the window — it must be in `(0, maxHistoryHours]` (default 6), out of range is a 400; valid values snap to quarter-hour steps. |
| `GET …/current?station=<id>` | `StationCurrent` | One station, reading only — the light poll. |

Responses carry `Cache-Control` derived from upstream cache TTLs and
a weak `ETag` computed over station content excluding `servedAt`, so
unchanged upstreams revalidate to 304. One broken station degrades to a
reason code; the feed survives — a handler 500s only when it cannot produce a
document at all.

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
cutoffs to the station's own cadence — ten minutes of silence is routine for
a five-minute logger and a dead feed for a three-second one.

Each station also advertises `recommendedPollSeconds`, matched to upstream
cache TTLs — see [polling etiquette](/docs/station/adapters/#polling-etiquette).
