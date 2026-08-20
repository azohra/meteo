---
title: Campbell
description: "The Campbell Scientific adapter: logger web-API config, pinned field contracts, naive-local-time disambiguation across DST, and the split between current and history tables."
---

Campbell Scientific dataloggers are industrial measurement loggers,
programmed per installation. The adapter reads one through the logger's own
web-service API (`command=DataQuery`), no vendor cloud involved, and
normalizes two of its tables into a
[wire document](/docs/station/wire-contract/).

## Configuration

`vendor: "campbell"` selects this adapter. The entry is validated by
`campbellStationConfigSchema` (exported from `@azohra/meteo.station/server`):

| Field | Type | Meaning |
|---|---|---|
| `id` | string, required | Your feed-local station id: what `?station=` and `primaryStationId` name. |
| `name` | string, required | The display name carried on the wire. |
| `baseUrl` | http(s) URL, required | The logger's web-service endpoint: the URL that answers `?command=DataQuery`. |
| `source` | string, required | The data-source symbol tables are addressed under, e.g. `LOGGER01:Wind Station`. The segment after the colon must match the `station_name` the logger reports in table headers; the adapter verifies the match on every response. |
| `timeZone` | IANA zone, **required** | The zone the logger stamps records in. Optional for other vendors, required here: records arrive as naive local time with no offset. |
| `currentTable` | string, default `"I3Sec"` | The fast wind table serving the current reading. |
| `historyTable` | string, default `"I5Min"` | The aggregate table serving history, temperature, and wind chill. |
| `currentIntervalSeconds` | positive number, default `3` | The current table's own record interval, verified against the table header, and declared as `samplingWindowSeconds`. |
| `historyPeriodMinutes` | positive number, default `5` | The history table's record interval, verified against the table header, and carried as `history.periodMinutes`. |
| `currentCacheTtlSeconds` | number ≥ 3, default `15` | Cache TTL for the current table (history caches for 120 s). |
| `latitude`, `longitude`, `elevationM` | numbers, optional | Position claims, carried on the wire. |
| `pageUrl` | http(s) URL, optional | A public page for the station; no vendor default; omitted means null. |

## Capabilities

`{ gustLull: true, temperature: true, conditions: false, history: true }`.
`live` and `battery` are undeclared, and on the wire an undeclared
capability key reads as false
([evolution rules](/docs/station/wire-contract/#evolution-rules)).

The pinned field contracts (below) carry wind, temperature, and wind chill:
no barometer, so `conditions` is `false` and the block never appears
([absence stays absent](/docs/station/adapters/#the-rulebook)).
`samplingWindowSeconds` is `currentIntervalSeconds`;
`recommendedPollSeconds` is the larger of `currentIntervalSeconds` and
`currentCacheTtlSeconds`; polling a three-second table faster than its
cache TTL returns the cached rows.

## Endpoint

`GET <baseUrl>?command=DataQuery&uri=<source>.<table>&format=json&…`: the
current table with `mode=most-recent`, the history table with
`mode=backfill` over the requested window. The config carries no credential
fields and requests carry only the project
[User-Agent](/docs/station/adapters/#environment-injection): access control
to the logger is the deployment's, not the adapter's. Responses are capped
at 512 KiB and cache under the key
`campbell/<baseUrl>/<source>/<table>/<mode>/<period>/<order>`: the current
table for `currentCacheTtlSeconds` (default 15 s), the history table for
120 s.

## What the adapter guards

- **Pinned field contracts.** The current table must carry `Wind_Speed`
  (Avg), `Wind_Lull` (Min), `Wind_Gust` (Max) in `kilometers/hour` and
  `WindDir` (Smp) in `degrees`; the history table must carry `Temp` and
  `Wind_Chill` (Smp, `Deg C`), `WindDir`, and `WS_kph_Max`/`Avg`/`Min`. A
  field whose name, process, type, or units changed throws; a reprogrammed
  logger degrades to `unavailable` instead of serving renumbered columns.
- **Header verification.** Every response's `station_name` (the text after
  the colon in `source`), `table_name`, and record interval must match the
  config; a response not marked complete (`more: false`) throws.
- **Naive local time, disambiguated by context.** The logger stamps records
  in station-local time with no offset; the configured IANA zone converts
  them. A DST fall-back makes one local hour name two instants: history
  points resolve to the candidate strictly after the previous point, the
  current reading to the candidate nearest now. A spring-forward names no
  instant at all; the timestamp resolves to the transition itself.
- **Clock-skew warning.** A current reading sitting about an hour from now
  (within five minutes of exactly one hour) logs a `clock_skew` warning:
  loggers are often pinned to standard time year-round while the configured
  zone observes DST; configure a fixed-offset zone (`Etc/GMT+8` for
  Pacific) instead, or vice versa.
- **History fails soft, current fails hard.** Both tables are fetched in
  parallel. A history failure costs history (and the temperature and wind
  chill it carries) with the failure logged and the station still `ok`; a
  current-table failure degrades the whole station.
- **Air rides the history table.** The current table carries wind only. In
  `mode: "current"` the adapter reads just the current table and reuses the
  last full load's temperature and wind chill from cache (TTL 120 s);
  beyond that they are null rather than stale.
- Speeds are validated 0–500 in the vendor's km/h before conversion to m/s;
  directions are validated 0–360 and normalized; a calm reading carries a
  null direction.

## Setup

```ts
import { createStationFeedHandler } from "@azohra/meteo.station/server";

const handler = createStationFeedHandler({
  stations: [
    {
      vendor: "campbell",
      id: "summit",
      name: "Summit Logger",
      baseUrl: "http://logger.example:30001/.",
      source: "LOGGER01:Wind Station",
      timeZone: "America/Vancouver",
      latitude: 49.5,
      longitude: -118.5,
    },
  ],
});

export default { fetch: handler };
```

## Where next

Render it: [getting started § 2](/docs/station/getting-started/) mounts the
card against your feed — history is declared, so the chart and trend draw;
`conditions` is not, so the air matrix carries no column for this station
([What your hardware shows](/docs/station/what-your-hardware-shows/) maps
the rest). Pick [React](/docs/station/react/) or
[custom elements](/docs/station/elements/), then
[theming](/docs/station/theming/).
