---
title: Provider transports
description: Understand whole-file ECCC sampling, indexed NOAA byte ranges, whole-file GOES granule reads, and the shared publication boundary.
---

The forecast builders use two broad transport strategies for provider GRIB;
the GOES observation builders add a third for NetCDF granules. All three share
download accounting, site sampling guards, builder invariants, and the
published contract while preserving each provider's storage semantics.

ECCC is read from Datamart files rather than the GeoMet point-extraction
APIs because GeoMet does not carry the full field set the derivations
need — reading and decoding the published files is the only complete
path to ECCC's models.

![A comparison of NOAA indexed byte ranges and ECCC whole-domain streaming. Four HRRR records are located at byte offsets read from the repository index fixture; ECCC builders stream one whole-domain file at a time, sample configured sites in memory, and discard the file.](figures/two-transports.svg)

| Strategy | Current home | Data movement | Important boundary |
| --- | --- | --- | --- |
| ECCC Datamart GRIB | `providers/datamart.ts`, ECCC builders, `@azohra/meteo.grib` decoding | Fetch one whole-domain field file, sample all sites, release bytes — a JPEG 2000 field is sampled once through the pool's region decode, which entropy-decodes only the codeblocks the site gridpoints touch | Paths, field tokens, accumulations, sentinels, and schedules are model declarations |
| NOAA Open Data indexed GRIB | `providers/noaa.ts`, NOAA builders, `@azohra/meteo.grib` `.idx` helpers | Read `.idx`, fetch only byte ranges for needed records, sample sites | Record names, level strings, grid rotation, and accumulation windows are model-specific |
| NOAA object-store NetCDF (GOES observations) | `builders/granule.ts`, `builders/goes.ts` | Download the whole 9–41 MB granule and read it through h5wasm with netCDF4's mask-and-scale semantics | Fixed-grid projection attributes are read per granule; cadence and validity are per product |

GOES granules are deliberately read whole-file. The retired Python pipeline
range-read HDF5 chunks to serve h5py's C callbacks a file-like object; here a
granule is one download whose handful of probe pixels are extracted in
memory, so the block-cached seekable reader has no consumer. Its one rule
that survives — a 200 response to a Range request is a failure, never a body
to use — lives in `@azohra/meteo.grib`'s ranged fetch helpers.

## Preserve provider semantics

Two fields with the same output unit can describe different windows. For
example, a precipitation rate can be an instantaneous diagnostic or a mean
over the publishing step. A gust can be an instantaneous diagnostic or an
hour maximum. Transport code recovers the provider quantity; the builder's
verified semantics declaration keeps its meaning attached to the profile.

## Sampling and domains

Grid readers sample the nearest model point for every configured site and
check distance. A distant result usually means an out-of-domain coordinate
was clamped to the grid edge — `@azohra/meteo.grib`'s `nearestGridpoint`
deliberately never throws; it clamps and reports the true great-circle
distance so the builder owns the rejection. The builder must reject that
sample. Model terrain elevation is a sampled model fact
(`site.modelElevationM`) — distinct from the launch elevation, which the
forecast engine measures into `site-context.json` and no builder ever writes into
a document.

Projected grids may publish winds relative to grid north. Where provider
metadata requires it, builders rotate components to true north before
computing speed and meteorological FROM-direction. Regular latitude/longitude
earth-relative grids require no such correction. These are verified feed
facts, not global transport assumptions.

## Failure and accounting

The shared manifest core records downloads, bytes, retries, and duration.
Transport-specific numeric counters may be added, but consumers cannot build
logic on those unstable extension keys. Missing required records fail a build;
optional capability records may remain absent only when catalogue and builder
behaviour agree.

Live-provider evidence belongs in the dated
[forecast feed reference](/docs/forecast/forecast-model-feeds/).
