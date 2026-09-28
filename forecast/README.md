# @azohra/meteo.forecast

The forecast engine for meteo by Azohra. It downloads provider data from ECCC and
NOAA, samples it at each launch you catalogue, derives soaring quantities, and
publishes versioned JSON documents, gzip history archives, and sidecar
indexes. `@azohra/meteo.briefing` reads all of them through its transport and
history subpaths.

The engine reads whole GRIB2 files from the ECCC Datamart, byte ranges of NOAA
GRIB2 files located through their `.idx` indexes, and NetCDF files from NOAA's
object store. GRIB2 decoding goes through `@azohra/meteo.grib`.

This package is the engine only. The project runs no production instance. An
operator runs their own from a repository that holds the build schedule, the
site catalogue, and the storage bucket with its credentials.

## The CLI

The package needs Node 22 or later and ships the `meteo` binary, whose
commands take the form `meteo <capability> <command>`:

```sh
pnpm add @azohra/meteo.forecast
pnpm exec meteo forecast build --model hrrr-conus --sites ./club-sites.json --output ./public/data --dry-run
pnpm exec meteo forecast terrain --sites ./club-sites.json
```

In a checkout of this repository, run `mise run //forecast:build` first, then
use `node forecast/dist/cli.js forecast ...` in place of `pnpm exec meteo`.

## Documentation

The full documentation is at <https://meteo.azohra.com/docs/forecast/>, and
its source is in [`docs/`](docs/). Operators should start with
[Configure launches](https://meteo.azohra.com/docs/forecast/configure-launches/).
The reference pages include:

- [Forecast architecture](docs/architecture.md): how provider data becomes
  published documents, module by module.
- [Meteogram derivations](docs/derivation-science.mdx): the equations,
  constants, and fallbacks behind each published derived quantity.
- [Builder contract](docs/builder-contract.md): the eight invariants every
  builder must honour.
- [Provider transports](docs/provider-transports.md): how the engine fetches
  whole ECCC files, NOAA byte ranges, and whole GOES granules.
