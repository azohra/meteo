---
title: "Forecast: engine and CLI"
description: "The forecast engine: fetches ECCC and NOAA model fields, samples catalogued sites through @azohra/meteo.grib, derives soaring quantities, and publishes the versioned documents @azohra/meteo.briefing reads, plus the meteo CLI that drives it."
---

The **forecast** capability is the forecast engine: the write side of the
contract whose read side is [`@azohra/meteo.briefing`](/docs/briefing/). It
fetches provider bytes (ECCC Datamart whole-file GRIB2, NOAA `.idx`-indexed
byte ranges, NOAA object-store NetCDF), samples gridpoints through
[`@azohra/meteo.grib`](/docs/grib/), derives site forecasts, and publishes the
versioned JSON documents, gzip history archives, and sidecar indexes that
`@azohra/meteo.briefing`'s transport and history subpaths load.

The package requires Node 22 or later and ships the `meteo` binary in the
platform grammar (`meteo <capability> <command>`):

```sh
pnpm add @azohra/meteo.forecast
pnpm exec meteo forecast build --model hrrr-conus --sites ./sites.json --output ./public/data --dry-run
pnpm exec meteo forecast terrain --sites ./sites.json
```

From a workspace checkout, the same commands run as
`node forecast/dist/cli.js forecast ...` after `pnpm --dir forecast build`.

## Engine, not instance

The engine is the package. An operator's pipeline (the cron schedule,
the site catalogue a deployment builds from, the bucket and its
credentials) is the operator's own repository. The platform ships no
production instance; the reference deployment lives with its
operator. The engine guarantees the published surface: any
operator's instance publishes the same versioned document shapes at the
same stable paths, so everything on the read side works against any of
them.

## The documentation

Each page is the single authority for its topic. The publisher's path
runs in order:

| Page | Covers |
|---|---|
| [Configure launches](/docs/forecast/configure-launches/) | The launch catalogue the engine builds forecasts for |
| [Choose models](/docs/forecast/choosing-models/) | Model choice by spatial resolution and forecast schedule, and the slug `--model` takes |
| [Run one model](/docs/forecast/run-one-model/) | The first build: one model, your launches, one CLI command |
| [Environment and credentials](/docs/forecast/environment/) | Every environment variable the engine reads: the published-root pointer, the S3 credential set, host overrides |
| [Schedule builds](/docs/forecast/schedule-builds/) | Scheduling the build command so each model rebuilds when its provider publishes a new run |
| [Tune the wire](/docs/forecast/tune-the-wire/) | The transport report every build prints, and what it decides: connections, hosts, or nothing |
| [Publish static output](/docs/forecast/static-output/) | Moving a build's manifests and forecast documents to storage you control, and serving them publicly, privately, or behind your own membership gate |

The engine's own reference:

| Page | Covers |
|---|---|
| [Forecast architecture](/docs/forecast/architecture/) | The flow from provider bytes to published documents, and which module owns what |
| [Meteogram derivations](/docs/forecast/derivation-science/) | The equations, constants, and fallbacks behind every published derived quantity |
| [The mountain the model sees](/docs/forecast/the-mountain-the-model-sees/) | Why model terrain sits far from the real launch, and what relief and land cover add |
| [Model capabilities](/docs/forecast/model-capabilities/) | What each model's fields mean, and which absences are stated facts |
| [Forecast model feeds](/docs/forecast/forecast-model-feeds/) | Dated provider facts: verified paths, schedules, fields, retention, transport, and licensing |
| [Provider transports](/docs/forecast/provider-transports/) | Whole-file ECCC sampling, indexed NOAA byte ranges, whole-file GOES granules |
| [Builder contract](/docs/forecast/builder-contract/) | For builder authors: the eight binding invariants every builder must honour |
