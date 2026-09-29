---
title: Tempest
description: "The WeatherFlow Tempest adapter: station id and access token, the REST observation endpoint, the token-free cache key, and the conditions block it validates."
---

The WeatherFlow Tempest is a consumer all-in-one weather station that
reports through the vendor's cloud. The adapter reads WeatherFlow's REST
observation endpoint and normalizes the latest observation into a
[wire document](/docs/station/wire-contract/).

## Configuration

`vendor: "tempest"` selects this adapter. The entry is validated by
`tempestStationConfigSchema`, exported from `@azohra/meteo.station/server`.

| Field | Type | Meaning |
|---|---|---|
| `id` | string, required | Your feed-local station id, the value `?station=` and `primaryStationId` name. |
| `name` | string, required | The display name carried on the wire. |
| `stationId` | positive integer, required | The WeatherFlow station id, which is the number in `tempestwx.com/station/<id>`. |
| `token` | string, required | A WeatherFlow personal access token, created in the Tempest app or at tempestwx.com. Sent as the `token` query parameter. |
| `latitude`, `longitude`, `elevationM` | numbers, optional | Position claims used only as fallbacks. When the observation payload carries elevation, latitude, or longitude, the payload's values win. |
| `timeZone` | IANA zone, optional | Carried on the wire for display. Observations are epoch-stamped, so parsing does not need it. |
| `pageUrl` | http(s) URL, optional | Overrides the default `https://tempestwx.com/station/<stationId>`. |

## Capabilities

`{ gustLull: true, temperature: true, conditions: true, history: false }`.
`live` and `battery` are undeclared. On the wire, an undeclared capability
key reads as false
([evolution rules](/docs/station/wire-contract/#evolution-rules)).

The hardware carries the full sensor suite, so gust/lull, temperature, and
the extended conditions block are always declared. History is declared
`false` because the REST observations endpoint serves only the latest
observation. The adapter reports only what this endpoint carries, so
`history` is null on every document. `samplingWindowSeconds` and
`recommendedPollSeconds` are both 60.

[What your hardware shows](/docs/station/what-your-hardware-shows/) maps
these declarations to your page's surfaces.

The wire contract's `conditions` block is
[WeatherFlow-shaped](/docs/station/wire-contract/#semantics), and this
adapter is the one that fills every field of it.

## Endpoint and the token-free cache key

`GET https://swd.weatherflow.com/swd/rest/observations/station/<stationId>?token=…`.
The `observationsUrl` direct-adapter option overrides the base URL, for
tests and proxies.

Responses cache for 60 seconds under the key `tempest/<stationId>`. The
token is left out of the key so the credential does not land in a shared
cache. Multi-tenant hosts should read
[the cache trust model](/docs/station/adapters/#the-cache-trust-model).

## What the adapter guards

- The response's `station_id` must match the configured station. A
  response for another station throws rather than serving someone else's
  wind.
- The first `obs` entry is the observation. A response without one throws.
- Wind speeds are validated as plausible m/s (0–140), since the vendor's
  units are already SI. Direction is validated 0–360 and normalized, and a
  calm reading carries a null direction. `wind_lull` is nullable.
- `precip` arrives as mm/min and is converted (×60) to
  `precipitationRateMmPerHour`.
- The lightning last-strike epoch becomes an ISO instant. Strike distance
  (km) and the one-hour strike count must be non-negative, and the count
  must be an integer.
- `relative_humidity` must be 0–100 and `sea_level_pressure` positive.
  Solar radiation and UV must be non-negative. `pressure_trend` must be one
  of `falling`, `rising`, `steady`, `unknown`.
- Latitude and longitude from the payload are range-checked. A longitude of
  exactly 180 normalizes to −180.
- Every conditions field is nullable. A null from the vendor travels as
  null rather than zero.

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

## Where next

To render the station, [getting started § 2](/docs/station/getting-started/) mounts the
card against your feed, in [React](/docs/station/react/) or as
[custom elements](/docs/station/elements/), and
[theming](/docs/station/theming/) matches it to your site.
