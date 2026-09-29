---
title: Provider transports
description: How the builders read providers. ECCC files are sampled whole, NOAA records are fetched by indexed byte range, GOES granules are read whole, and all three share one publication boundary.
---

The forecast builders read provider GRIB with two broad transport strategies,
and the GOES observation builders add a third for NetCDF granules. All three
share download accounting, site sampling guards, builder invariants, and the
published contract, and each keeps its provider's storage semantics.

ECCC is read from Datamart files because the GeoMet point-extraction APIs do
not carry the full field set the derivations need. Reading and decoding the
published files is the only complete path to ECCC's models.

![NOAA indexed byte ranges compared with ECCC whole-domain streaming. Four HRRR records sit at byte offsets read from the repository index fixture, while ECCC builders stream one whole-domain file at a time, sample configured sites in memory, and discard the file.](figures/two-transports.svg)

| Strategy | Current home | Data movement | Important boundary |
| --- | --- | --- | --- |
| ECCC Datamart GRIB | `providers/datamart.ts`, ECCC builders, `@azohra/meteo.grib` decoding | Fetch one whole-domain field file, sample all sites, and release the bytes. A JPEG 2000 field is sampled once through the pool's region decode, which entropy-decodes only the codeblocks the site gridpoints touch | Paths, field tokens, accumulations, sentinels, and schedules are model declarations |
| NOAA Open Data indexed GRIB | `providers/noaa.ts`, NOAA builders, `@azohra/meteo.grib` `.idx` helpers | Read `.idx`, fetch only the byte ranges for needed records, and sample sites | Record names, level strings, grid rotation, and accumulation windows are model-specific |
| NOAA object-store NetCDF (GOES observations) | `builders/granule.ts`, `builders/goes.ts` | Download the whole 9–41 MB granule and read it through h5wasm with netCDF4's mask-and-scale semantics | Fixed-grid projection attributes are read per granule. Cadence and validity are per product |

A GOES granule is read as one whole-file download, and its handful of probe
pixels are extracted in memory. It takes one fetch and has no fallback
machinery. Every ranged fetch shares `@azohra/meteo.grib`'s guard, which
treats a 200 answer to a Range request as an error and does not read it as a
body ([What it decodes](/docs/grib/coverage/#the-idx-byte-range-helpers)).

## Preserve provider semantics

Two fields with the same output unit can describe different windows. A
precipitation rate can be an instantaneous diagnostic or a mean over the
publishing step. A gust can be an instantaneous diagnostic or an hour maximum.
Transport code recovers the provider quantity, and the builder's verified
semantics declaration keeps its meaning attached to the profile.

## Sampling and domains

Grid readers sample the nearest model point for every configured site and
check the distance. A distant result usually means an out-of-domain coordinate
was clamped to the grid edge. `@azohra/meteo.grib`'s `nearestGridpoint` does
not throw. It clamps and reports the true great-circle distance, and the
builder is responsible for rejecting that sample. Model terrain elevation is a
sampled model fact (`site.modelElevationM`). It is distinct from the launch
elevation, which the forecast engine measures into `site-context.json` and
which no builder writes into a document.

Projected grids may publish winds relative to grid north. Where provider
metadata requires it, builders rotate components to true north before
computing speed and meteorological FROM-direction. Regular latitude/longitude
earth-relative grids need no such correction. These are verified per-feed
facts.

## Failure and accounting

The shared manifest core records downloads, bytes, retries, and duration.
Transports may add their own numeric counters, but these extension keys are
unstable and consumers cannot build logic on them. Missing required records
fail a build. Optional declared-capability records may stay absent only when
the catalogue and builder behaviour agree.

Live-provider evidence belongs in the dated
[forecast feed reference](/docs/forecast/forecast-model-feeds/).
