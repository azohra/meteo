---
title: Ecowitt
description: "The Ecowitt adapter: application and API keys, the gateway MAC, the cloud real_time endpoint with pinned SI units, piezo rain, and the credential-free cache key."
---

Ecowitt sensor arrays (the WS90 "Wittboy" and its siblings) report by
radio to a gateway or console — GW2000/GW3000 class hardware — which
uploads to the vendor's cloud about once a minute. The adapter reads the
cloud's `real_time` endpoint and normalizes the latest report into a
[wire document](/docs/station/wire-contract/). The gateway itself carries
the barometer; the outdoor array carries wind, temperature, humidity,
rain, solar, and UV.

## Configuration

`vendor: "ecowitt"` selects this adapter. The entry is validated by
`ecowittStationConfigSchema` (exported from `@azohra/meteo.station/server`):

| Field | Type | Meaning |
|---|---|---|
| `id` | string, required | Your feed-local station id: what `?station=` and `primaryStationId` name. |
| `name` | string, required | The display name carried on the wire. |
| `applicationKey` | string, required | The application key generated in the ecowitt.net Private Center. |
| `apiKey` | string, required | The API key generated alongside it; both travel as query parameters. |
| `mac` | MAC address, required | The gateway's MAC (`FF:FF:FF:FF:FF:FF`, shown in the ecowitt.net device list); normalized to uppercase. |
| `elevationM` | number, required | The gateway's elevation — the barometer lives in the gateway, not the outdoor array — used to reduce station pressure to sea level. |
| `hasBattery` | boolean, default `true` | Whether the outdoor array reports supply volts (the WS90 does); declares the battery capability. |
| `latitude`, `longitude` | numbers, optional | Position claims carried on the wire; the `real_time` payload carries none. |
| `timeZone` | IANA zone, optional | Carried on the wire for display; payload fields are epoch-stamped, so parsing does not need it. |
| `pageUrl` | http(s) URL, optional | There is no public per-device URL to derive, so this is the only way a page link reaches the wire. |

## Capabilities

`{ gustLull: true, temperature: true, conditions: true, history: false, battery: <hasBattery> }`.
`live` is undeclared, and on the wire an undeclared capability key reads
as false ([evolution rules](/docs/station/wire-contract/#evolution-rules)).

The array measures gusts but no lull, so `windLullMps` is null on every
reading — the gust/lull structure stays allocated and the absent half
stays null. History is declared `false` because `real_time` serves the
latest report only; the adapter reports what this endpoint carries and
fabricates nothing. `samplingWindowSeconds` is null: the cloud does not
state the averaging window behind its wind values. `recommendedPollSeconds`
is 60, the gateway's own upload cadence — polling faster rereads the same
report.

## Endpoint and the credential-free cache key

`GET https://api.ecowitt.net/api/v3/device/real_time` with
`application_key`, `api_key`, `mac`, a `call_back` naming exactly the field
groups the adapter reads, and unit ids pinning every quantity to SI —
°C, hPa, m/s, mm, W/m² — so the payload never needs unit conversion. The
`realTimeUrl` direct-adapter option overrides the base URL, for tests and
proxies.

Responses cache for 60 seconds under the key `ecowitt/<MAC>`; the keys are
deliberately excluded, because a credential must never leak into a shared
cache. What that means for multi-tenant hosts is
[the cache trust model](/docs/station/adapters/#the-cache-trust-model).

## What the adapter guards

- The cloud answers HTTP 200 even when refusing: a non-zero envelope
  `code` throws with Ecowitt's own code and message. The busy and
  over-limit codes (−1, 45001) surface as `rate_limited`; other refusals
  as `upstream_error`.
- `real_time` only serves reports from the last two hours; a success
  envelope without a wind group is a device gone quiet and degrades as
  `upstream_error`, never as a stale-but-healthy document.
- Every payload value arrives as a string and must parse to a finite
  number; the reading is stamped with the wind field's own epoch, not the
  envelope's.
- Wind speeds are validated as plausible m/s (0–140; the request pins the
  unit); direction is validated 0–360 and normalized; a calm reading
  carries a null direction.
- Rain prefers the piezo group (`rainfall_piezo`, what a WS90 fills) and
  falls back to the tipping-bucket group (`rainfall`), so adding a bucket
  sensor later changes nothing.
- Sea-level pressure is the adapter's own reduction of the gateway's
  absolute pressure through `seaLevelPressureHpa` with the configured
  elevation and the current temperature — the payload's `relative`
  pressure is a user-calibrated offset and is not trusted.
- Humidity must be 0–100; rain, solar, and UV non-negative; battery volts
  positive. `outdoor.feels_like` is a blended comfort index, not wind
  chill, so `windChillC` stays null.

## Setup

```ts
import { createStationFeedHandler } from "@azohra/meteo.station/server";

const handler = createStationFeedHandler({
  stations: [
    {
      vendor: "ecowitt",
      id: "yard",
      name: "Home Yard",
      applicationKey: process.env.ECOWITT_APPLICATION_KEY!, // ecowitt.net Private Center
      apiKey: process.env.ECOWITT_API_KEY!,
      mac: "FF:FF:FF:FF:FF:FF", // the gateway's MAC, from the device list
      elevationM: 1000, // the gateway's elevation, for pressure reduction
    },
  ],
});

export default { fetch: handler };
```
