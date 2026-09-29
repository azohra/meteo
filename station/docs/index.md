---
title: "Station: live weather-station display"
description: "Read live weather stations through one wire contract and show them on your own page with React components or custom elements."
---

`@azohra/meteo.station` reads live weather stations and shows their
conditions on your own page, drawn by the package rather than embedded
from a vendor iframe. It has five parts:

- a wire contract, the one document shape every station is served in;
- adapters that convert each vendor's readings to that shape (four are
  built in, and [you can write your own](/docs/station/adapters/));
- a feed handler you mount on your server, which serves every station
  as one feed over web-standard `Request` and `Response`;
- a client data layer that polls the feed, with no framework
  dependency; and
- two display bindings, React components and custom elements, which a
  [parity suite keeps byte-identical](/docs/station/elements/).

The [component gallery](/docs/station/component-gallery/) renders every
custom element live on a synthetic season.

Station is independent of the forecast and Meteogram packages. Importing it
loads no forecast, renderer, or SVG code. Each part is its own subpath:

```ts
import { parseStationFeedJson } from "@azohra/meteo.station";
import { createStationStore } from "@azohra/meteo.station/client";
import { createStationFeedHandler } from "@azohra/meteo.station/server";
```

[Getting started](/docs/station/getting-started/) walks through installing
the package, mounting the handler, and rendering a live card.

## How it behaves

- Each station declares on the wire what it measures, and the components
  follow those declarations. A station without a thermometer says so, and
  a sensor that has gone dark reports null rather than zero.
- A station whose upstream fails, or sends data that breaks the contract,
  shows as unavailable with a reason code. The other stations in the feed
  are unaffected.
- The wire carries reason codes and degrees. The client chooses the words,
  units, and colours.
- Wind-speed bands use the thresholds you pass in and the colours your
  theme sets.

The [wire contract](/docs/station/wire-contract/#semantics) sets out these
rules in full.

## Pages in this section

| Page | Covers |
|---|---|
| [Getting started](/docs/station/getting-started/) | Install, mount the handler, render components, call the data layer |
| [Adapters](/docs/station/adapters/) | How adapters work, writing your own with `defineStationAdapter`, environment injection, caching, and polling etiquette. Each built-in vendor has its own page: [WindNerd](/docs/station/adapters/windnerd/), [Tempest](/docs/station/adapters/tempest/), [Campbell](/docs/station/adapters/campbell/), [Ecowitt](/docs/station/adapters/ecowitt/) |
| [What your hardware shows](/docs/station/what-your-hardware-shows/) | What each vendor measures, and which components appear, degrade, or stay hidden as a result |
| [Component gallery](/docs/station/component-gallery/) | Every custom element, rendered live on a synthetic season |
| [React](/docs/station/react/) | The provider, hooks, thresholds, composition, and seeding the provider during server-side rendering |
| [Custom elements](/docs/station/elements/) | Registering the elements, and when to use attributes or properties |
| [Theming](/docs/station/theming/) | `.meteo-root` scoping, design tokens, dark mode, and `@layer` |
| [Client data](/docs/station/client-data/) | The layer beneath both bindings: how polling works, the stores, and how readings merge |
| [Climatology](/docs/station/climatology/) | A station's whole archive summed by month, time slot, and wind sector, filtered in the browser without another request |
| [Wire contract](/docs/station/wire-contract/) | The document shape, its semantics and evolution rules, the HTTP protocol, and freshness |

JSON Schema for the station wire documents is in
[`schema/`](https://github.com/azohra/meteo/tree/main/station/schema),
with annotated examples. It follows the
[schema-artifact convention](/docs/core/failures-and-schema/#schema-artifacts)
that every package publishing wire documents uses.

## Lineage

Station was developed in its own repository before it moved here. Its
earlier history is archived there.
