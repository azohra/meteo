---
title: "Forecast: engine and CLI"
description: The forecast engine — fetches ECCC and NOAA model fields, samples catalogued sites through @azohra/meteo.grib, derives soaring quantities, and publishes the versioned documents @azohra/meteo.briefing reads — and the meteo CLI that drives it.
---

The **forecast** capability is the forecast engine: the write side of the
contract whose read side is [`@azohra/meteo.briefing`](/docs/briefing/). It
fetches provider bytes (ECCC Datamart whole-file GRIB2, NOAA `.idx`-indexed
byte ranges, NOAA object-store NetCDF), samples gridpoints through
[`@azohra/meteo.grib`](/docs/grib/), derives site forecasts, and publishes the
versioned JSON documents, gzip history archives, and sidecar indexes that
`@azohra/meteo.briefing`'s transport and history subpaths load.

The package ships the `meteo` binary in the platform grammar
(`meteo <capability> <command>`):

```sh
pnpm add @azohra/meteo.forecast
pnpm exec meteo forecast build --model hrrr-conus --sites ./sites.json --output ./public/data --dry-run
pnpm exec meteo forecast terrain --sites ./sites.json
pnpm exec meteo forecast migrate --model gfs   # dry-run by default
```

From a workspace checkout, the same commands run as
`node forecast/dist/cli.js forecast ...` after `pnpm --dir forecast build`.

## Engine, not instance

The engine is the package; an operator's pipeline is the operator's own
repository. The cron schedule, the site catalogue a deployment builds from,
the bucket and its credentials — none of that ships here, and the platform
ships no production instance; the reference deployment lives with its
operator. What the engine guarantees is the published surface: any
operator's instance publishes the same versioned document shapes at the
same stable paths, so everything on the read side works against any of
them.

## The documentation

Each page is the single authority for its topic:

| Page | Covers |
|---|---|
| [Forecast architecture](/docs/forecast/architecture/) | The flow from provider bytes to published documents, and which module owns what |
| [Meteogram derivations](/docs/forecast/derivation-science/) | The equations, constants, and fallbacks behind every published derived quantity |
| [Builder contract](/docs/forecast/builder-contract/) | The eight invariants every builder must honour — the binding rules |
| [Provider transports](/docs/forecast/provider-transports/) | Whole-file ECCC sampling, indexed NOAA byte ranges, whole-file GOES granules |
| [Add a forecast model](/docs/forecast/adding-a-model/) | The verify-before-code workflow from live feed to registered builder |

## Lineage

The engine began as a module-by-module port of a Python pipeline: each
ported module's spec was the Python test that pinned it, and each builder's
acceptance gate was a published-JSON dual-run diff against the Python
builder for the same run. The dual-run harness retired with the
Python side.
