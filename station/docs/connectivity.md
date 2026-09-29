---
title: Connectivity
description: "Backhaul health for cellular stations. Covers the StationConnectivity contract, the Hologram loader, what a SIM platform can and cannot report, and why there is no signal field."
---

`StationConnectivity` reports the backhaul health of a station that sends
its data over a cellular SIM. The SIM platform knows things the weather
feed does not: whether the device is in a data session right now, when it
last connected, which carrier it attached to, and how much data it has
moved this billing period. Backhaul health is a third concern beside the
reading (weather) and telemetry (device power), and it follows the same
absence rules.

The connectivity document stays off the public station feed. Data usage
and carrier identity are operational facts for the station's operator, so
the loader returns a standalone document for the operator's own routes,
such as an admin page or a health check. The
[wire contract](/docs/station/wire-contract/) is unchanged.

## The contract

`@azohra/meteo.station` exports `stationConnectivitySchema`, and
`parseStationConnectivity` to revalidate the document after it crosses
your own wire.

| Field | Type | Meaning |
|---|---|---|
| `sourceLabel` | string | The backhaul provider, e.g. `"Hologram"`. |
| `checkedAt` | ISO timestamp | When this snapshot was taken from the provider, to within the loader's cache lifetime. |
| `deviceName` | string \| null | The device's name on the provider's dashboard. |
| `online` | boolean \| null | In a data session right now. null when the provider does not say. It is not inferred from usage recency. |
| `lastConnectedAt` | ISO \| null | When the current or most recent data session began. |
| `carrier` | string \| null | The network the device last attached to, as the provider spells it. |
| `radioTechnology` | string \| null | Radio access technology of the last session, e.g. `"LTE"`. |
| `sim.service` | enum | The SIM lifecycle normalized across providers: `active`, `paused`, `inactive`, `retired`, `unknown`. |
| `sim.vendorState` | string \| null | The provider's own lifecycle word, e.g. `"LIVE"`, `"PAUSED-USER"`. |
| `sim.expiresAt` | ISO \| null | When the SIM's current term ends, in the provider's meaning of expiry; rolling plans renew through this boundary. |
| `usage.currentPeriodBytes` | int \| null | Data used in the current billing period. |
| `usage.previousPeriodBytes` | int \| null | Data used in the one before it. |
| `usage.planName` | string \| null | The data plan's name. |
| `usage.planIncludedBytes` | int \| null | Bytes the plan includes per period. null when the plan declares no allotment (flat-rate or pay-per-byte). It is not zero in that case. |
| `usage.overageLimitBytes` | int \| null | The operator-set usage cap. null means uncapped, and uncapped is not reported as zero. |
| `lastSession` | object \| null | `{ beganAt, endedAt, bytes }`; `endedAt` is null exactly while the session is still open. |

Every null above means "the provider does not report this". A null is
never a zero measurement. The
[wire contract](/docs/station/wire-contract/#semantics) applies the same
absence rule to sensors.

## Why there is no signal field

Cellular platforms do not expose signal strength through their clouds.
The modem measures RSSI on the device, and the value stays there unless the
device firmware reports it through its own channel. A connectivity document
that carried a signal number would have to invent one. From the backhaul
side, the usable measure of connection quality is `radioTechnology` plus
session recency. A station on LTE that connected minutes ago is healthy.
A station whose `lastConnectedAt` is days old is not, however strong its
last bar was.

## The Hologram loader

[Hologram](https://www.hologram.io/) is the SIM platform under many
station deployments (WindNerd's OnSpot hardware ships with a Hologram SIM).
`loadHologramConnectivity`, exported from `@azohra/meteo.station/server`,
reads one device from Hologram's REST API and normalizes it.

```ts
import { loadHologramConnectivity } from "@azohra/meteo.station/server";

declare const env: { HOLOGRAM_API_KEY: string };

const connectivity = await loadHologramConnectivity({
  apiKey: env.HOLOGRAM_API_KEY,
  deviceId: 4200001,
});
```

`hologramConnectivityConfigSchema` validates the config.

| Field | Type | Meaning |
|---|---|---|
| `apiKey` | string, required | A Hologram API key (Settings → API keys on the dashboard), sent as basic auth. The key sees every organization its owner belongs to, and a device fetch needs no org scoping. |
| `deviceId` | positive integer, required | Hologram's numeric device id. It is the number in the dashboard's device URL, or `id` from `GET /api/1/devices`. |

The options bag takes the standard
[`environment`](/docs/station/adapters/#environment-injection) plus
`cacheTtlSeconds` and `apiBase` (for tests and proxies). Failures throw
`UpstreamError` with the usual reason taxonomy. The loader refuses a
response whose device id is not the one it asked for.

The loader calls `GET https://dashboard.hologram.io/api/1/devices/<deviceId>`.
Responses cache for 300 seconds by default under the key
`hologram/device/<deviceId>`. The 300 seconds is a trial value, and the
caller can move it. Hologram devices report in sessions roughly an hour
apart, so five minutes keeps an admin view current without leaning on the
API. The API key is not part of the cache key, which keeps credentials out
of shared caches
([the cache trust model](/docs/station/adapters/#the-cache-trust-model)).

The normalizer handles two Hologram conventions so they never reach you.
An open session's end stamp is an all-zeros sentinel, which becomes
`lastSession.endedAt: null`. A flat-rate plan declares `data: 0`, which
becomes `planIncludedBytes: null`, meaning no allotment rather than a zero
cap.
