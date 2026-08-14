---
title: Tempest
description: The WeatherFlow Tempest adapter — station id and access token, the REST observation endpoint, the token-free cache key, and the conditions block it validates.
---

The WeatherFlow Tempest is a consumer all-in-one weather station that
reports through the vendor's cloud. The adapter reads WeatherFlow's REST
observation endpoint and normalizes the latest observation into a
[wire document](/docs/station/wire-contract/).

## Configuration

`vendor: "tempest"` selects this adapter. The entry is validated by
`tempestStationConfigSchema` (exported from `@azohra/meteo.station/server`):

| Field | Type | Meaning |
|---|---|---|
| `id` | string, required | Your feed-local station id — what `?station=` and `primaryStationId` name. |
| `name` | string, required | The display name carried on the wire. |
| `stationId` | positive integer, required | The WeatherFlow station id — the number in `tempestwx.com/station/<id>`. |
| `token` | string, required | A WeatherFlow personal access token (created in the Tempest app or at tempestwx.com); sent as the `token` query parameter. |
| `latitude`, `longitude`, `elevationM` | numbers, optional | Position claims — fallbacks only: when the observation payload carries elevation, latitude, or longitude, the payload's values win. |
| `timeZone` | IANA zone, optional | Carried on the wire for display; observations are epoch-stamped, so parsing does not need it. |
| `pageUrl` | http(s) URL, optional | Overrides the default `https://tempestwx.com/station/<stationId>`. |

## Capabilities

`{ gustLull: true, temperature: true, conditions: true, history: false }`.
`live` and `battery` are undeclared, and on the wire an undeclared
capability key reads as false
([evolution rules](/docs/station/wire-contract/#evolution-rules)).

The hardware carries the full sensor suite, so gust/lull, temperature, and
the extended conditions block are always declared. History is declared
`false` because the REST observations endpoint serves the latest observation
only — the adapter reports what this endpoint carries and fabricates
nothing, so `history` is null on every document. `samplingWindowSeconds`
and `recommendedPollSeconds` are both 60.

The wire contract's `conditions` block is
[WeatherFlow-shaped](/docs/station/wire-contract/#semantics) — this adapter
is the one that fills every field of it.

## Endpoint and the token-free cache key

`GET https://swd.weatherflow.com/swd/rest/observations/station/<stationId>?token=…`.
The `observationsUrl` direct-adapter option overrides the base URL, for
tests and proxies.

Responses cache for 60 seconds under the key `tempest/<stationId>` — the
token is deliberately excluded, because a credential must never leak into a
shared cache. What that means for multi-tenant hosts is
[the cache trust model](/docs/station/adapters/#the-cache-trust-model).

## What the adapter guards

- The response's `station_id` must echo the configured station — the wrong
  station throws rather than serving someone else's wind.
- The first `obs` entry is the observation; a response without one throws.
- Wind speeds are validated as plausible m/s (0–140 — the vendor's units
  are already SI); direction is validated 0–360 and normalized; a calm
  reading carries a null direction; `wind_lull` is nullable.
- `precip` arrives as mm/min and is converted (×60) to
  `precipitationRateMmPerHour`.
- Lightning: the last-strike epoch becomes an ISO instant; distance (km)
  and the one-hour strike count must be non-negative, the count an integer.
- `relative_humidity` must be 0–100, `sea_level_pressure` positive, solar
  radiation and UV non-negative; `pressure_trend` must be one of `falling`,
  `rising`, `steady`, `unknown`.
- Latitude and longitude from the payload are range-checked; a longitude of
  exactly 180 normalizes to −180.
- Every conditions field is nullable — a null from the vendor travels as
  null, never zero.

## Setup

```ts
import { createStationFeedHandler } from "@azohra/meteo.station/server";

const handler = createStationFeedHandler({
  stations: [
    {
      vendor: "tempest",
      id: "meadow",
      name: "Ridge Meadow",
      stationId: 12345,
      token: process.env.TEMPEST_TOKEN!, // a WeatherFlow personal access token
    },
  ],
});

export default { fetch: handler };
```
