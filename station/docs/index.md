---
title: "Station: live weather-station display"
description: The station capability — one wire contract, vendor adapters, a mountable feed handler, and React plus custom-element bindings for rendering live station conditions.
---

The **station** capability reads live weather stations and renders them:
one wire contract, vendor adapters that normalize into it (WindNerd,
WeatherFlow Tempest, Campbell Scientific loggers, or your own), a mountable
`Request → Response` feed handler, a framework-free client data layer, and
two peer display bindings — React components and light-DOM custom elements —
held equivalent by a parity test suite.

See the components live: [/station/](/station/) renders the custom-elements
binding on a synthetic season, on the portal itself.

Station is independent of the forecast and Meteogram capabilities: importing
it loads no forecast, renderer, or SVG code, and every surface is an explicit
subpath of the `@azohra/meteo.station` package.

```ts
import { parseStationFeedJson } from "@azohra/meteo.station";
import { createStationStore } from "@azohra/meteo.station/client";
import { createStationFeedHandler } from "@azohra/meteo.station/server";
```

## Principles

- **Capabilities are declared, never inferred.** A station without a
  thermometer says so; a dark sensor reports null. Absence stays absent —
  never zero, never a guess.
- **Degrade, don't lie.** An upstream that fails or breaks contract renders
  as unavailable with a reason code, not as stale numbers. One broken
  station never takes down the feed.
- **No prose on the wire.** Reason codes and degrees travel; words, units,
  and colours are the client's.
- **Your thresholds, your palette.** Speed banding is computed against the
  consumer's limits and painted with the consumer's tokens.

## The documentation

Each page is the single authority for its topic:

| Page | Covers |
|---|---|
| [Getting started](/docs/station/getting-started/) | Install, mount the handler, render components, the data-level API |
| [Wire contract](/docs/station/wire-contract/) | The document shape, semantics, evolution rules, HTTP protocol, freshness model |
| [Adapters](/docs/station/adapters/) | The adapter shape, custom adapters, `defineStationAdapter`, environment injection, caching, polling etiquette — with a reference page per shipped vendor: [WindNerd](/docs/station/adapters/windnerd/), [Tempest](/docs/station/adapters/tempest/), [Campbell](/docs/station/adapters/campbell/) |
| [Client data](/docs/station/client-data/) | The framework-free client layer: poller semantics, stores, the merge clock rule |
| [React](/docs/station/react/) | Provider, hooks, thresholds, composition, SSR seeding |
| [Elements](/docs/station/elements/) | The custom-elements binding: registration, attributes vs properties |
| [Theming](/docs/station/theming/) | `.meteo-root` scoping, token tables, dark mode, `@layer` |

JSON Schema for the station wire documents lives in
[`schema/`](https://github.com/azohra/meteo/tree/main/station/schema), with
committed annotated examples — the same convention the forecast document
schemas follow in their own package.

## Lineage

Station was developed in its own repository before joining this one; its
history remains archived there. The capability arrived here at feature
parity with that repository's final state.
