---
title: "Station: live weather-station display"
description: "The station capability: one wire contract, vendor adapters, a mountable feed handler, and React plus custom-element bindings for rendering live station conditions."
---

The **station** capability reads live weather stations and renders them
natively in your page, with no vendor iframe: one wire contract, vendor
adapters that normalize into it ([four built in, or your
own](/docs/station/adapters/)), a mountable
`Request → Response` feed handler, a framework-free client data layer, and
two peer display bindings, React components and light-DOM custom
elements, [held byte-identical by a parity suite](/docs/station/elements/).

See the components live: the [component
gallery](/docs/station/component-gallery/) renders every element of the
custom-elements binding on a synthetic season, right in these docs.

Station is independent of the forecast and Meteogram capabilities: importing
it loads no forecast, renderer, or SVG code, and every surface is an explicit
subpath of the `@azohra/meteo.station` package.

```ts
import { parseStationFeedJson } from "@azohra/meteo.station";
import { createStationStore } from "@azohra/meteo.station/client";
import { createStationFeedHandler } from "@azohra/meteo.station/server";
```

## Principles

- Capability flags on the wire say what each station carries, and the
  display surfaces trust them. A station without a thermometer says so; a
  dark sensor reports null rather than zero.
- Degrade, don't lie. An upstream that fails or breaks contract renders
  as unavailable with a reason code, and one broken station leaves the
  rest of the feed intact.
- The wire carries reason codes and degrees; words, units, and colours
  are the client's.
- Speed banding is computed against the consumer's limits and painted
  with the consumer's tokens.

The [wire contract](/docs/station/wire-contract/#semantics) states the
full semantics.

## The documentation

| Page | Covers |
|---|---|
| [Getting started](/docs/station/getting-started/) | Install, mount the handler, render components, the data-level API |
| [Adapters](/docs/station/adapters/) | The adapter shape, custom adapters, `defineStationAdapter`, environment injection, caching, polling etiquette, with a reference page per shipped vendor: [WindNerd](/docs/station/adapters/windnerd/), [Tempest](/docs/station/adapters/tempest/), [Campbell](/docs/station/adapters/campbell/), [Ecowitt](/docs/station/adapters/ecowitt/) |
| [What your hardware shows](/docs/station/what-your-hardware-shows/) | Each vendor's declared capabilities, and exactly which surfaces appear, degrade, or stay hidden |
| [Component gallery](/docs/station/component-gallery/) | Every element in the custom-elements binding, rendered live on a synthetic season |
| [React](/docs/station/react/) | Provider, hooks, thresholds, composition, SSR seeding |
| [Custom elements](/docs/station/elements/) | The custom-elements binding: registration, attributes vs properties |
| [Theming](/docs/station/theming/) | `.meteo-root` scoping, token tables, dark mode, `@layer` |
| [Client data](/docs/station/client-data/) | The framework-free layer beneath both bindings: poller semantics, stores, the merge clock rule |
| [Climatology](/docs/station/climatology/) | The multi-year cube: the whole archive as (month, slot, sector) sums, filtered client-side with no refetch |
| [Wire contract](/docs/station/wire-contract/) | The document shape, semantics, evolution rules, HTTP protocol, freshness model |

JSON Schema for the station wire documents lives in
[`schema/`](https://github.com/azohra/meteo/tree/main/station/schema), with
committed annotated examples;
[the schema-artifact convention](/docs/core/failures-and-schema/#schema-artifacts)
is core's, shared by every capability that publishes wire documents.

## Lineage

Station was developed in its own repository before joining this one; its
history remains archived there.
