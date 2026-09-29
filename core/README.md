# @azohra/meteo.core

Shared units, wind math, and schema helpers for the meteo by Azohra
packages. You rarely install it directly. For application code, use one of
these instead:

- [`@azohra/meteo.briefing`](../briefing/README.md) reads published
  forecasts. It has the forecast contract, pure derivations, analysis,
  comparison, history, transport, and the Meteogram renderer.
- [`@azohra/meteo.station`](../station/README.md) reads and displays live
  weather stations, with client, server, React, and custom-element
  bindings.

## What lives here

Every export here is a deliberate part of the API. Code doesn't move into
`core` only to shorten an import. The package contains:

- Units: the platform's unit names and conversions (`units.ts`)
- Angles: angle math and compass conventions (`angles.ts`)
- Wind: the platform's one wind sign convention (`wind.ts`)
- Schema primitives: shared zod building blocks (`schema.ts`)
- Failures: the upstream-failure vocabulary (`failures.ts`)
- Schema artifacts: the code that renders each capability's JSON Schema
  artifacts (`schema-artifacts.ts`)

Everything is exported from the package root:

```ts
import { KMH_PER_MPS } from "@azohra/meteo.core";
```

Its only dependency is [zod](https://zod.dev).
