# @azohra/meteo.core

The foundation of the meteo by Azohra platform: the shared physical vocabulary
every other `@azohra/*` meteorology package builds on.

**Looking for a product, not a foundation?**

- **Forecasts** — the published site-forecast contract, pure derivations,
  analysis, comparison, history, transport, and the Meteogram presentation
  tier → [`@azohra/meteo.briefing`](../forecast/README.md)
- **Live stations** — live weather-station reading, derivation, and display
  (client, server, React, and custom-element bindings) →
  [`@azohra/meteo.station`](../station/README.md)

## What lives here

Curated exports only — `core` is deliberate API, not a junk drawer; nothing
moves here merely to shorten an import:

- **Units** — the platform's unit vocabulary and conversions (`units.ts`)
- **Angles** — angular math and compass conventions (`angles.ts`)
- **Wind** — the platform's ONE wind sign convention (`wind.ts`)
- **Schema primitives** — shared zod building blocks (`schema.ts`)
- **Failures** — the upstream-failure vocabulary (`failures.ts`)
- **Schema artifacts** — the rendering machinery behind each capability's
  emitted JSON Schema artifacts (`schema-artifacts.ts`)

Everything is exported through the one curated surface:

```ts
import { KMH_PER_MPS } from "@azohra/meteo.core";
```

Dependencies: [zod](https://zod.dev) only.
