---
title: WindNerd
description: The WindNerd adapter — station key and location id, the temperature and pressure flags, the unofficial records endpoint, and the km/h series it validates.
---

WindNerd stations are wind sensors that report to the vendor's site,
[windnerd.net](https://windnerd.net), where each station has a public page.
The adapter reads the same records API that page calls and normalizes the
km/h series into [wire documents](/docs/station/wire-contract/).

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
| `elevationM` | number, optional | The **sensor's** elevation, not the launch's — sea-level pressure reduction uses it, so config validation rejects `hasPressure: true` without it. |
| `latitude`, `longitude` | numbers, optional | Position claims, carried on the wire. |
| `timeZone` | IANA zone, optional | Carried on the wire for display; the records API stamps UTC instants, so parsing does not need it. |
| `pageUrl` | http(s) URL, optional | Overrides the default `https://windnerd.net/en/<stationKey>`. |

## Capabilities

`{ gustLull: true, temperature: hasTemperature, conditions: hasPressure, history: true }`.

Gust/lull and history are always declared — every record carries them.
Temperature and conditions are config claims, not observations: the records
API serves nullable series for every station, and a series that happens to
carry numbers is not a declaration
([capabilities are declared, never inferred](/docs/station/adapters/#the-rulebook)).
`samplingWindowSeconds` and `recommendedPollSeconds` are both 60 — the raw
records are one-minute averages.

## Endpoint

`GET https://windnerd.net/api/records?location_id=…&from=…&to=…&period=…`,
no authentication. The endpoint is unofficial — it is what the vendor's own
station page calls — so the adapter treats it as a guest: it validates every
series, degrades to `unavailable` on any contract break rather than
guessing, and identifies itself with the project
[User-Agent](/docs/station/adapters/#environment-injection).

Responses cache for 60 seconds at the raw one-minute period and 900 seconds
at aggregate periods, under the key
`windnerd/<locationId>/<historyHours>/<periodMinutes>`.

### Direct-adapter options

Beyond the shared `{ historyHours, mode, environment }`,
`loadWindnerdStation(config, options)` accepts:

| Option | Meaning |
|---|---|
| `recordPeriodMinutes` | Record resolution: `1` (default), `15`, `60`, or `180` — the vendor's own whitelist; any other value throws before fetching. |
| `cacheTtlSeconds` | Overrides the 60 s (period 1) / 900 s (aggregate) default. |
| `recordsUrl` | Overrides the endpoint, for tests and proxies. |

The fleet API (`loadStationFeed`, the mounted handler) forwards none of
these — a season pull at period 180 calls the adapter directly, as
[getting started § 3](/docs/station/getting-started/#3--a-season-not-a-window)
walks through.

## What the adapter guards

- Speeds arrive in km/h and are validated in the vendor's units — every
  average, gust, and lull entry must be finite and within 0–500 km/h —
  before conversion to m/s. Directions are validated 0–360 and normalized;
  a calm reading (below the WMO threshold) carries a null direction.
- The current reading is the last history record. A response with no
  records, or with series whose lengths disagree, throws — the station
  degrades instead of serving an empty document.
- Temperature and pressure are nullable series and go stale honestly: the
  reading takes the latest non-null value only when it lies within 15
  minutes of the wind reading, otherwise null — a sensor that stopped an
  hour ago does not pose as current.
- Station pressure is validated 300–1100 hPa and reduced to sea level using
  `elevationM` and the co-timed temperature; the pressure trend is derived
  from the reduced history via `pressureTendency` — the same public
  derivations [custom adapters are asked to match](/docs/station/adapters/#the-custom-arm).
- `time_offset` — the station's local standard-time offset, one entry per
  record — is validated to −720…+840 minutes and surfaced only by
  `parseWindnerdRecords` as `utcOffsetMinutes`; it is not on the `Station`
  document. It matters at period 180, where the vendor buckets by
  station-local standard time — see
  [getting started § 3](/docs/station/getting-started/#3--a-season-not-a-window).
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
