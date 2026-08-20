---
title: "What it decodes"
description: "The GRIB2 surface @azohra/meteo.grib covers: grid templates 3.0, 3.1, and 3.30, data representation templates 5.0, 5.2, 5.3, and 5.40, multi-field messages, bitmaps, wind rotation, and the NOMADS .idx byte-range helpers."
---

Coverage is driven by the feeds the forecast engine actually reads, not by
the GRIB2 specification's full surface. The package parses sections over
raw GRIB2 bytes, including repeated sections 2–7 (multi-field messages)
and section 6 bitmaps, and decodes the grid and packing templates below.
Anything else is rejected with a named error, not approximated; for
example, an unsupported packing template fails with the exact template
number and the supported list.

## Grid templates (section 3)

Each grid carries an analytic inverse mapping, so nearest-gridpoint
lookup is O(1) per point.

| Template | Grid | Where it appears in the feeds |
|---|---|---|
| 3.0 | Regular latitude-longitude | GFS 0.25°, GDPS 0.15°, GEPS 0.5° |
| 3.1 | Rotated latitude-longitude | Every ECCC HRDPS, RDPS, REPS, and RAQDPS field |
| 3.30 | Lambert conformal | HRRR CONUS 3 km, NAM 12 km and CONUS nest |

`nearestGridpoint` reports the great-circle distance alongside the
index, because callers use distance as the out-of-domain guard: it
clamps and reports rather than throwing.
[`src/grid.ts`](https://github.com/azohra/meteo/blob/main/grib/src/grid.ts)
holds the inverses;
[`src/nearest.ts`](https://github.com/azohra/meteo/blob/main/grib/src/nearest.ts)
the lookup.

![The rotated graticule drawn over the true one: a schematic globe with the rotated south pole marked and the HRDPS domain lying along the rotated equator, and beside it the launch neighbourhood where tilted rotated gridlines cross the true graticule; toRotated maps the launch to fractional grid coordinates and a storage index, with the great-circle residual nearestGridpoint reports drawn in a magnified inset.](figures/rotated-grid.svg)

## Data representation templates (section 5)

| Template | Packing | Implementation |
|---|---|---|
| 5.0 | Simple packing | Pure TypeScript |
| 5.2 | Complex packing | Pure TypeScript |
| 5.3 | Complex packing with spatial differencing | Pure TypeScript |
| 5.40 | JPEG 2000 | Through an injected decoder interface, so the codec dependency never enters this package's core |

The measured shape of the feeds ([fixture
findings](https://github.com/azohra/meteo/blob/main/grib/test/fixtures/README.md)):
every harvested NOAA record (GFS, HRRR, NAM) uses DRT 5.3, and every
ECCC Datamart product uses DRT 5.40. The JPEG 2000 seam and its Node
wiring have [their own page](/docs/grib/jpeg2000/).

## Wind rotation

Rotated and Lambert grids store wind grid-relative
(`uvRelativeToGrid=1` on every ECCC rotated grid).
[`src/wind.ts`](https://github.com/azohra/meteo/blob/main/grib/src/wind.ts)
rotates grid-relative components to earth-relative, including the
Lambert cone constant.

## The `.idx` byte-range helpers

NOMADS publishes an `.idx` sidecar per GRIB file: one line per record,
with byte offsets. [`src/idx.ts`](https://github.com/azohra/meteo/blob/main/grib/src/idx.ts)
parses the sidecar and fetches single records by HTTP Range request,
with fetch injected rather than ambient:

- `parseIdx` / `findRecord`: parse the sidecar text and locate a record
  by its fields.
- `byteRange`: the inclusive HTTP Range header value for a record,
  open-ended for the last record.
- `pairSpan`: the combined span of a paired U/V record set.
- `fetchIndex`: fetch and parse a sidecar (a plain, unranged GET).
- `fetchRecord`: fetch one record's bytes with a Range request.

A 200 response to a Range request is a failure, never a body to use:
it means the server ignored `Range`
and sent the whole multi-hundred-megabyte file. Only `206 Partial
Content` is success. `fetchRecord` enforces this and throws with the
offending status.

## What the core never does

The browser-safe barrel (`@azohra/meteo.grib`) contains no `node:` imports, no
ambient I/O, and no WASM. Everything that needs a runtime (the JPEG
2000 codecs, the worker pool) lives behind the Node-only
`@azohra/meteo.grib/j2k-node` subpath.
