---
title: "meteo: the shared foundation"
description: "The @azohra/meteo.core package, the physical vocabulary the station and briefing packages build on: units, angle and wind-vector math, zod primitives, the upstream-failure vocabulary, and schema-artifact tooling."
---

**`@azohra/meteo.core`** is the platform's shared physical vocabulary:
units and conversions, angle and wind-vector math with one sign convention,
zod schema primitives, the upstream-failure vocabulary, and the machinery
each capability uses to emit its JSON Schema artifacts. The packages that
carry these quantities on their wires (station and briefing) build on it;
grib, j2k, and forecast declare no dependency on it.

**Looking for a product, not a foundation?**

- **Forecasts**: the published site-forecast contract, pure derivations,
  analysis, comparison, history, transport, and the Meteogram presentation
  tier → [`@azohra/meteo.briefing`](/docs/briefing/)
- **The forecast engine**: fetch provider bytes, derive, and publish the
  documents yourself → [`@azohra/meteo.forecast`](/docs/forecast/)
- **Live stations**: live weather-station reading, derivation, and display
  → [`@azohra/meteo.station`](/docs/station/)
- **Provider bytes**: the pure-TypeScript GRIB2 decoder →
  [`@azohra/meteo.grib`](/docs/grib/), and the JPEG 2000 decoder inside it →
  [`@azohra/meteo.j2k`](/docs/j2k/)

## What lives here

Curated exports only. `core` is deliberate API, not a junk drawer; nothing
moves here merely to shorten an import:

- **Units**: the platform's unit vocabulary and conversions
  ([`units.ts`](https://github.com/azohra/meteo/blob/main/core/src/units.ts))
- **Angles**: angular math and compass conventions
  ([`angles.ts`](https://github.com/azohra/meteo/blob/main/core/src/angles.ts))
- **Wind**: the platform's ONE wind sign convention
  ([`wind.ts`](https://github.com/azohra/meteo/blob/main/core/src/wind.ts))
- **Schema primitives**: the shared zod building blocks `ianaTimeZone`,
  `httpUrl`, and the `positionFields` position claims
  ([`schema.ts`](https://github.com/azohra/meteo/blob/main/core/src/schema.ts))
- **Failures**: the upstream-failure vocabulary
  ([`failures.ts`](https://github.com/azohra/meteo/blob/main/core/src/failures.ts))
- **Schema artifacts**: the rendering machinery behind each capability's
  emitted JSON Schema artifacts
  ([`schema-artifacts.ts`](https://github.com/azohra/meteo/blob/main/core/src/schema-artifacts.ts))

Everything exports through the one curated root surface (the package
declares no subpaths):

```ts
import { KMH_PER_MPS } from "@azohra/meteo.core";
```

Dependencies: [zod](https://zod.dev) only.

## The documentation

| Page | Covers |
|---|---|
| [Units, angles, one wind sign](/docs/core/conventions/) | The unit vocabulary, angle helpers, and the wind sign convention every platform package shares |
| [Failures and schema artifacts](/docs/core/failures-and-schema/) | The upstream-failure vocabulary, the shared zod schema primitives, and how capabilities render their JSON Schema artifacts |
