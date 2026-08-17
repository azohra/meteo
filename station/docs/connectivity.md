---
title: Connectivity
description: "Backhaul health for cellular stations: the StationConnectivity contract, the Hologram loader, what a SIM platform can and cannot tell you, and why there is no signal field."
---

A remote station is only as alive as its uplink. When the hardware reports
over a cellular SIM, the SIM platform knows things the weather feed cannot:
whether the device is in a data session right now, when it last connected,
which carrier it attached to, and how much data it has moved this billing
period. `StationConnectivity` is that context — backhaul health, a third
concern beside the reading (weather) and telemetry (device power), with the
same honesty rules.

It never rides the public station feed. Data usage and carrier identity are
operational facts for the station's operator, so the loader returns a
standalone document for the operator's own routes — an admin page, a
health check — and the [wire contract](/docs/station/wire-contract/) is
untouched.

## The contract

`stationConnectivitySchema` (exported from `@azohra/meteo.station`, with
`parseStationConnectivity` for revalidating across your own wire):

| Field | Type | Meaning |
|---|---|---|
| `sourceLabel` | string | The backhaul provider, e.g. `"Hologram"`. |
| `checkedAt` | ISO timestamp | When this snapshot was taken from the provider, to within the loader's cache lifetime. |
| `deviceName` | string \| null | The device's name on the provider's dashboard. |
| `online` | boolean \| null | In a data session right now. null when the provider does not say — never inferred from usage recency. |
| `lastConnectedAt` | ISO \| null | When the current or most recent data session began. |
| `carrier` | string \| null | The network the device last attached to, as the provider spells it. |
| `radioTechnology` | string \| null | Radio access technology of the last session, e.g. `"LTE"`. |
| `sim.service` | enum | The SIM lifecycle normalized across providers: `active`, `paused`, `inactive`, `retired`, `unknown`. |
| `sim.vendorState` | string \| null | The provider's own lifecycle word, e.g. `"LIVE"`, `"PAUSED-USER"`. |
| `sim.expiresAt` | ISO \| null | When the SIM's current term ends, in the provider's meaning of expiry; rolling plans renew through this boundary. |
| `usage.currentPeriodBytes` | int \| null | Data used in the current billing period. |
| `usage.previousPeriodBytes` | int \| null | Data used in the one before it. |
| `usage.planName` | string \| null | The data plan's name. |
| `usage.planIncludedBytes` | int \| null | Bytes the plan includes per period. null when the plan declares no allotment (flat-rate or pay-per-byte) — never zero. |
| `usage.overageLimitBytes` | int \| null | The operator-set usage cap. null means uncapped — never zero. |
| `lastSession` | object \| null | `{ beganAt, endedAt, bytes }`; `endedAt` is null exactly while the session is still open. |

Every null above means "the provider does not report this", never a zero
measurement — the same absence rule the
[wire contract](/docs/station/wire-contract/#semantics) holds for sensors.

## Why there is no signal field

Cellular platforms do not expose signal strength through their clouds: RSSI
is measured by the modem, on the device, and stays there unless the device
firmware reports it through its own channel. A connectivity document that
carried a signal number would have to invent one. The honest
connection-quality signal from the backhaul side is `radioTechnology` plus
session recency — a station on LTE that connected minutes ago is healthy;
one whose `lastConnectedAt` is days old is not, however strong its last
bar was.

## The Hologram loader

[Hologram](https://www.hologram.io/) is the SIM platform under many
station deployments (WindNerd's OnSpot hardware ships with a Hologram SIM).
`loadHologramConnectivity` (exported from `@azohra/meteo.station/server`)
reads one device from Hologram's REST API and normalizes it:

```ts
import { loadHologramConnectivity } from "@azohra/meteo.station/server";

declare const env: { HOLOGRAM_API_KEY: string };

const connectivity = await loadHologramConnectivity({
  apiKey: env.HOLOGRAM_API_KEY,
  deviceId: 4200001,
});
```

The config is validated by `hologramConnectivityConfigSchema`:

| Field | Type | Meaning |
|---|---|---|
| `apiKey` | string, required | A Hologram API key (Settings → API keys on the dashboard); sent as basic auth. The key sees every organization its owner belongs to, and a device fetch needs no org scoping. |
| `deviceId` | positive integer, required | Hologram's numeric device id — the number in the dashboard's device URL, or `id` from `GET /api/1/devices`. |

The options bag takes the standard
[`environment`](/docs/station/adapters/#environment-injection) plus
`cacheTtlSeconds` and `apiBase` (tests and proxies). Failures throw
`UpstreamError` with the usual reason taxonomy; the loader refuses a
response whose device id is not the one asked for.

`GET https://dashboard.hologram.io/api/1/devices/<deviceId>`. Responses
cache for 300 seconds by default (a trial value, caller-movable — Hologram
devices report in hourly-ish sessions, so five minutes keeps an admin view
current without leaning on the API) under the key
`hologram/device/<deviceId>`; the API key is deliberately excluded, because
a credential must never leak into a shared cache
([the cache trust model](/docs/station/adapters/#the-cache-trust-model)).

Two Hologram habits the normalizer absorbs so you never see them: an open
session's end stamp is an all-zeros sentinel (it becomes
`lastSession.endedAt: null`), and a flat-rate plan declares `data: 0`
(it becomes `planIncludedBytes: null` — no allotment, not a zero cap).
