# @azohra/meteo.forecast

The forecast engine: the write side of the contract whose read side is
`@azohra/meteo.briefing`. It fetches provider bytes (ECCC Datamart whole-file
GRIB2, NOAA `.idx`-indexed byte ranges, NOAA object-store NetCDF),
samples gridpoints through `@azohra/meteo.grib`, derives site forecasts, and
publishes the versioned JSON documents, gzip history archives, and
sidecar indexes that `@azohra/meteo.briefing`'s transport and history
subpaths load.

The engine is the package; an operator's pipeline (the cron schedule,
the site catalogue it builds from, the bucket and its credentials) is
the operator's own repository. This platform ships no production instance;
the reference deployment lives with its operator.

## The documents

The reference lives in [`docs/`](docs/) and is served at
<https://meteo.azohra.com/docs/forecast/>.

- [Forecast architecture](docs/architecture.md): the flow from
  provider bytes to published documents, and which module owns what.
- [Meteogram derivations](docs/derivation-science.mdx): the equations,
  constants, and fallbacks behind every published derived quantity.
- [Builder contract](docs/builder-contract.md): the eight binding
  invariants every builder must honour.
- [Provider transports](docs/provider-transports.md): whole-file ECCC
  sampling, indexed NOAA byte ranges, whole-file GOES granules.

## The CLI

The package ships the `meteo` binary in the platform grammar
(`meteo <capability> <command>`):

```sh
pnpm add @azohra/meteo.forecast
pnpm exec meteo forecast build --model hrrr-conus --sites ./club-sites.json --output ./public/data --dry-run
pnpm exec meteo forecast terrain --sites ./club-sites.json
```

From a workspace checkout, the same commands run as
`node forecast/dist/cli.js forecast ...` after `mise run //forecast:build`.
