---
title: Adapters
description: "How station hardware becomes wire documents: the shipped vendor adapters, custom adapters, defineStationAdapter, environment injection, caching, and polling etiquette."
---

How station hardware becomes wire documents. An adapter is two functions:
`meta` declares the station's identity and capabilities from config alone,
and `load` fetches the vendor's upstream, validates it in the vendor's own
units, and normalizes it into the shapes specified in
[the wire contract](/docs/station/wire-contract/): fetch, normalize,
declare. Whatever the hardware, the client sees one document.

## The shipped adapters

Four vendors are built in; each has its own reference page: config
fields, capabilities, endpoint, and the quirks the adapter guards. Every
vendor page ends with the same Setup block — the
[getting-started](/docs/station/getting-started/) mount with a one-entry
`stations` array — so the pages differ only in the config entry itself:

| Vendor | Hardware | History | Live | Conditions |
|---|---|---|---|---|
| [WindNerd](/docs/station/adapters/windnerd/) | windnerd.net wind stations | yes | **yes** | pressure, when configured |
| [Tempest](/docs/station/adapters/tempest/) | WeatherFlow Tempest | no; the REST endpoint serves one observation | no | the full conditions block |
| [Campbell](/docs/station/adapters/campbell/) | Campbell Scientific loggers | yes | no | none |
| [Ecowitt](/docs/station/adapters/ecowitt/) | Ecowitt arrays behind a gateway (WS90 Wittboy and siblings) | no; the cloud endpoint serves one report | no | humidity, dew point, pressure, rain, solar, UV |

What each declaration turns on — chart, stream, matrix column — is mapped
surface by surface in
[What your hardware shows](/docs/station/what-your-hardware-shows/).

Anything else plugs in as a custom adapter, below.

## The custom arm

Everything from here down is for **writing an adapter of your own** — if
your vendor is in the table above, pick its page and you are done here.

The derivations the built-in vendors fill the wire with are public, so a
custom adapter produces the same physics: `pressureTendency` (the trend
code from recent history) and `seaLevelPressureHpa` (station pressure
reduced to sea level) live on `@azohra/meteo.station`, and skipping them
means your stations disagree with every other vendor's.

Any station without a built-in vendor plugs in as `vendor: "custom"`:

<!-- meteo-doc-fence: ignore — toStation is the reader's own mapping; the fence shows the loader's shape -->
```ts
const stations = [{
  vendor: "custom", id: "ridge", name: "Ridge Sensor",
  latitude: 49.5, longitude: -117.5, timeZone: "America/Vancouver",
  async load({ environment, historyHours, mode, station }) {
    // `station` is the parsed identity from this very config entry (id, name,
    // position, zone, pageUrl — nullish claims normalized to null), so meta
    // never re-declares the fields written three lines up.
    const body = await environment.fetch("https://acme.example/latest");
    return toStation(station, await body.json()); // your mapping; must return a valid Station
  },
}];
```

The returned document is validated against the wire schema; an invalid return
degrades that station to `unavailable`/`contract_break` and the rest of the
feed survives. A loader that **throws** degrades through the same reason
mapping the built-in adapters use: a thrown `UpstreamError("…", "timeout")`
surfaces as `timeout`, a network `TypeError` as `upstream_error`;
`contract_break` is reserved for invalid returned documents and unclassified
throws.

## The plugin-factory pattern

A third-party vendor package ships the same thing as a **plugin factory**, a
function closing over vendor options and returning a config entry:

<!-- meteo-doc-fence: ignore — a vendor-package sketch; toStation is the vendor's own mapping -->
```ts
// @acme/meteo-acmewind
import { emptyConditions, unavailableStation } from "@azohra/meteo.station";
import { fetchUpstreamText, type StationConfigInput } from "@azohra/meteo.station/server";

export function acmeStation(options: {
  id: string; name: string; deviceUrl: string; apiKey: string;
}): StationConfigInput {
  return {
    vendor: "custom", id: options.id, name: options.name,
    async load({ environment, historyHours, mode, station }) {
      const text = await fetchUpstreamText(environment, {
        url: `${options.deviceUrl}/latest`,
        headers: { Authorization: `Bearer ${options.apiKey}` },
        cacheKey: `acmewind/${options.deviceUrl}`, // names the upstream, not the key
        cacheTtlSeconds: 30,
        subject: `AcmeWind ${options.deviceUrl}`,
      });
      return toStation(station, JSON.parse(text)); // the vendor package's own mapping
    },
  };
}

// host app:
// stations: [acmeStation({ id: "ridge", name: "Ridge Sensor", deviceUrl: "…", apiKey: "…" })]
```

## defineStationAdapter

Vendor packages that want the full built-in treatment build their loader with
`defineStationAdapter({ meta, load })` from `@azohra/meteo.station/server`.
It owns environment resolution, meta assembly, the try/catch degradation
belt, failure logging, reason mapping, and `mode: "current"` slimming; the
adapter body is then parse + map, nothing else. Inside its `load`, throw
freely; the belt degrades.

## The rulebook

The rules below bind what an adapter *returns*, however it is built:

- Never resolve a healthy-looking document for an upstream failure: the
  station degrades to `unavailable` with a reason (the belt does this for
  anything thrown).
- Capabilities are declared from what the hardware carries, never inferred
  from the data that happened to arrive.
- Calm (below the WMO threshold) carries no direction; the speed still
  travels.
- Plausibility bounds live in the adapter, in the VENDOR's units (0–500 km/h
  for km/h upstreams, 0–140 m/s for m/s ones), where a lying instrument costs
  one station; the contract only validates shape.
- Cache keys name the upstream identity (vendor + endpoint/station), never a
  host-chosen label.
- `mode: "current"` means history `null` with meta intact: same decoder,
  lighter document.

`emptyConditions()` from `@azohra/meteo.station` is the starting point
for a station carrying one or two conditions-class sensors: spread the
measured fields over it and every absent quantity stays null, never zero.

## Environment injection

Adapters touch the world only through an injected environment:
`{ fetch, cache, logger, userAgent, now }`. Upstream documents go through
`fetchUpstreamText`, which enforces a 4-second timeout and a 512 KiB
response cap, and maps HTTP 429 to `rate_limited`. Upstream streams go
through `fetchUpstreamStream`, whose deadline covers only the connect
(headers must arrive within 10 seconds; the open body answers to the
caller's `signal` and an idle watchdog, never to a whole-response timeout),
with the same failure mapping and no cache: a stream is a connection, not a
document, and every caller owns its own.

- **`cache`**: provide a `FeedCache` backed by KV/Redis when your platform
  runs multiple isolates, so they share one upstream poll instead of each
  keeping a private memory cache. On Cloudflare Workers, `workersCache()`
  ships that shared cache over the ambient `caches.default`, and returns
  `undefined` off-platform so `cache: workersCache()` falls back to the
  memory default.
- **`logger`**: the default writes degradations to the console
  (`warn`/`error`); inject your own to route them, or a no-op to silence
  them. Every `LogEvent` carries a stable `code` (`"upstream_failure"`,
  `"config_invalid"`, `"clock_skew"`, …); match alerting on codes, never on
  the prose `message`.
- **`userAgent`**: overrides the default
  `azohra-meteo/0.1 (+https://meteo.azohra.com)`.
- **`now`**: injectable clock, for tests and replay.

## The cache trust model

**The shared default cache is a trust boundary.** When no cache is injected,
every handler and bare adapter call in the process shares one bounded
in-memory cache, and concurrent misses on a key coalesce into a single
upstream hit. Cache keys name the *upstream* (vendor + endpoint/station
identity), never credentials or host-chosen labels:
[Tempest keys deliberately exclude the token](/docs/station/adapters/tempest/#endpoint-and-the-token-free-cache-key),
so a config carrying a wrong token can be served a payload another config's
valid token warmed. That is by design (payloads are per-station, not
per-credential), but it means the default cache trusts every tenant in the
process: multi-tenant hosts whose tenants must not share payloads, or must
re-prove credentials per request, should inject a cache per tenant.

## Polling etiquette

Every response advertises `recommendedPollSeconds` per station, derived from
upstream cache TTLs; polling faster only reheats a cache. Upstreams that
are not official APIs are treated as guests: validate everything, degrade to
`unavailable` on any contract break rather than guessing, and identify
yourself with a User-Agent that names the project.
[WindNerd's endpoints](/docs/station/adapters/windnerd/#endpoints) are
the shipped example of that stance.
