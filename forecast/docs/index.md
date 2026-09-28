---
title: "Forecast: engine and CLI"
description: "The forecast engine and its meteo CLI. It fetches ECCC and NOAA model data for the launches you catalogue, derives soaring quantities, and publishes the versioned documents that @azohra/meteo.briefing reads."
---

`@azohra/meteo.forecast` is the forecast engine. It downloads provider data from
ECCC and NOAA, samples it at each launch in your
[site catalogue](/docs/glossary/#site-catalogue), derives soaring quantities,
and publishes the results as versioned JSON documents. It also appends each
run to gzip history archives with sidecar indexes.
[`@azohra/meteo.briefing`](/docs/briefing/) reads everything the engine
publishes.

The engine reads three kinds of provider data: whole GRIB2 files from the ECCC
Datamart, byte ranges of NOAA GRIB2 files located through their `.idx`
indexes, and NetCDF files from NOAA's object store. GRIB2 decoding goes
through [`@azohra/meteo.grib`](/docs/grib/).

## Install

The package needs Node 22 or later. It ships the `meteo` binary, whose
commands take the form `meteo <capability> <command>`:

```sh
pnpm add @azohra/meteo.forecast
pnpm exec meteo forecast build --model hrrr-conus --sites ./sites.json --output ./public/data --dry-run
pnpm exec meteo forecast terrain --sites ./sites.json
```

In a checkout of this repository, run `mise run //forecast:build` first, then
use `node forecast/dist/cli.js forecast ...` in place of `pnpm exec meteo`.

## What running it costs

Each build downloads real provider data. The
[feed reference](/docs/forecast/forecast-model-feeds/) records each model's
transport and how much it transfers. Schedule a model's build no more often
than that model publishes a new run.

<a id="engine-not-instance"></a>

## The engine and your instance

This package is the engine. The project runs no production instance. An [operator](/docs/glossary/#operator) runs their own instance from a
repository of their own, which holds the build schedule, the site catalogue,
and the storage bucket with its credentials. The reference operator's
pipeline is [`azohra/acrophobia-forecasts`](https://github.com/azohra/acrophobia-forecasts).

Every instance publishes the same document shapes at the same paths, so
anything built with `@azohra/meteo.briefing` works against any of them.

## Publish forecasts

Read these pages in order to go from nothing to a scheduled, published
forecast:

| Step | Page | What you do |
|---|---|---|
| 1 | [Configure launches](/docs/forecast/configure-launches/) | Write the site catalogue the engine builds forecasts for |
| 2 | [Choose models](/docs/forecast/choosing-models/) | Pick models by spatial resolution and schedule, and find the slug `--model` takes |
| 3 | [Run one model](/docs/forecast/run-one-model/) | Run a first build for one model and your launches |
| 4 | [Environment and credentials](/docs/forecast/environment/) | Set the environment variables the engine reads: the published root, S3 credentials, host overrides |
| 5 | [Schedule builds](/docs/forecast/schedule-builds/) | Rebuild each model when its provider publishes a new run |
| 6 | [Tune the wire](/docs/forecast/tune-the-wire/) | Read the transport report every build prints and decide whether to change connections or hosts |
| 7 | [Publish static output](/docs/forecast/static-output/) | Copy manifests and forecast documents to storage you control and serve them publicly, privately, or behind a membership gate |

## Reference

| Page | Covers |
|---|---|
| [Forecast architecture](/docs/forecast/architecture/) | How provider data becomes published documents, module by module |
| [Meteogram derivations](/docs/forecast/derivation-science/) | The equations, constants, and fallbacks behind each published derived quantity |
| [The mountain the model sees](/docs/forecast/the-mountain-the-model-sees/) | Why model terrain differs from the real launch, and what relief and land cover add |
| [Model capabilities](/docs/forecast/model-capabilities/) | What each model's fields mean, and which fields a model states it does not publish |
| [Forecast model feeds](/docs/forecast/forecast-model-feeds/) | Dated provider facts: verified paths, schedules, fields, retention, transport, and licensing |
| [Provider transports](/docs/forecast/provider-transports/) | How the engine fetches whole ECCC files, NOAA byte ranges, and whole GOES granules |
| [Builder contract](/docs/forecast/builder-contract/) | The eight invariants every builder must honour, for people writing builders |
