---
title: "meteo: the shared foundation"
description: "The @azohra/meteo.core package: units, angle and wind-vector math, zod primitives, the upstream-failure vocabulary, and schema-artifact tooling shared by the station and briefing packages."
---

**`@azohra/meteo.core`** holds the types and helpers the other packages
share. It covers units and conversions, angle and wind-vector math with one
sign convention, zod schema primitives, the upstream-failure vocabulary, and
the code each capability uses to emit its JSON Schema artifacts. The station
and briefing packages depend on it because their documents carry these
quantities. The grib, j2k, and forecast packages don't depend on it.

Most readers want one of the other packages. The
[responsibility table](/docs/#the-responsibility-boundary) on the project
overview lists every package and links its documentation.

Install it on its own with:

```sh
pnpm add @azohra/meteo.core
```

## What lives here

Every export here is a deliberate part of the API. Code doesn't move into
`core` only to shorten an import. The package contains:

- Units: the platform's unit names and conversions
  ([`units.ts`](https://github.com/azohra/meteo/blob/main/core/src/units.ts))
- Angles: angle math and compass conventions
  ([`angles.ts`](https://github.com/azohra/meteo/blob/main/core/src/angles.ts))
- Wind: the platform's one wind sign convention
  ([`wind.ts`](https://github.com/azohra/meteo/blob/main/core/src/wind.ts))
- Schema primitives: the shared zod building blocks `ianaTimeZone`,
  `httpUrl`, and the `positionFields` position claims
  ([`schema.ts`](https://github.com/azohra/meteo/blob/main/core/src/schema.ts))
- Failures: the upstream-failure vocabulary
  ([`failures.ts`](https://github.com/azohra/meteo/blob/main/core/src/failures.ts))
- Schema artifacts: the code that renders each capability's JSON Schema
  artifacts
  ([`schema-artifacts.ts`](https://github.com/azohra/meteo/blob/main/core/src/schema-artifacts.ts))

Everything is exported from the package root. There are no subpaths:

```ts
import { KMH_PER_MPS } from "@azohra/meteo.core";
```

Its only dependency is [zod](https://zod.dev).

## The documentation

| Page | Covers |
|---|---|
| [Units, angles, one wind sign](/docs/core/conventions/) | The unit vocabulary, angle helpers, and the wind sign convention the platform's wire documents share |
| [Failures and schema artifacts](/docs/core/failures-and-schema/) | The upstream-failure vocabulary, the shared zod schema primitives, and how capabilities render their JSON Schema artifacts |
