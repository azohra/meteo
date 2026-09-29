---
title: "Performance"
description: "Measured timings for @azohra/meteo.j2k. Region decode (the production shape) against full decode per core, full decode against the WASM OpenJPEG oracle on one thread, the Tier-1 profile, and the codeblock-parallel pool."
---

The production shape is a *sampled* decode, which reads a handful of site
gridpoints out of a multi-megapoint field. For that shape,
`decodeJ2kRegion` entropy-decodes only the codeblocks the requested points
touch and runs window-bounded inverse lifts. No whole-image codec can do
this. The values it returns are bit-identical to the full decode, and
[Two-ring correctness](/docs/j2k/correctness/) states the contract.

These timings were measured single-threaded (minimum of 5, Node 24, Apple
M5 Max; 4 uniformly scattered points per field; recorded 2026-08-12).

| fixture | samples | bits | full decode | region, 4 points | ratio | codeblocks touched |
|---|---:|---:|---:|---:|---:|---:|
| gdps-tmp-2m | 2,882,400 | 12 | 266 ms | 22 ms | 11.9× | 49/791 |
| hrdps-continental-tmp-2m | 3,276,600 | 16 | 692 ms | 44 ms | 15.6× | 49/911 |
| raqdps-pm25-sfc | 436,671 | 20 | 101 ms | 20 ms | 5.0× | 28/136 |
| rdps-cape-sfc-jasper | 813,275 | 24 | 295 ms | 4.4 ms | 67× | 25/12,711 |

The 67× row sits outside the trend of the other rows.
`rdps-cape-sfc-jasper` has the JasPer field's one-row bitmapped geometry
([the JasPer story](/docs/j2k/subset/#the-jasper-story)). An 813275×1
image splits into 12,711 tiny codeblocks, so four points touch a far
smaller fraction of them than on any gridded field.

The cost scales sublinearly in points, because nearby points share windows
and every point's coarse-level ancestry converges. On HRDPS-continental
(same machine, single thread), 1 point touches 16 codeblocks (14 ms), 4
points 49 (44 ms), 16 points 145 (121 ms), 64 points 366 (297 ms), and 256
points 674 (538 ms). The full packet-structure parse is unavoidable,
because packet lengths are only discoverable sequentially. It takes under
half a millisecond on every regular fixture.

![Four requested points on the HRDPS continental field, with the 49 of its 911 codeblocks that the 4-point decode entropy-decoded marked across five decomposition levels, and bars showing the touched count growing sublinearly as the same scatter scales from 1 to 256 points.](figures/region-decode.svg)

Through `@azohra/meteo.grib`'s worker pool, this is the sampled path
end-to-end. On the same machine, a 4-point sampled decode of
HRDPS-continental through `sampleFieldValuesAsync` and a 2-worker pool
sustains 25.5 ms per field, against 394 ms per field for full decodes.
That is 15.5× per core. A 3,500-field HRDPS lane therefore projects to
~90 s of sampled decode at pool 2, where full decodes would need ~23
minutes.
[`grib/test/production-codec-throughput.test.ts`](https://github.com/azohra/meteo/blob/main/grib/test/production-codec-throughput.test.ts)
gates the mechanism at ≥6× per core and at bit-exactness against the full
decode.

## Full decode, single thread

Decoding whole images single-threaded, this decoder is slower than the
WASM OpenJPEG build and faster than the asm.js one. The cross-codec bench
([`grib/tools/bench-j2k-single.ts`](https://github.com/azohra/meteo/blob/main/grib/tools/bench-j2k-single.ts))
measured these timings (minimum of 5, Node 24, Apple Silicon; recorded
2026-08-12). It lives in grib because it needs both codecs, and only that
package depends on both.

| fixture | samples | bits | @azohra/meteo.j2k | oracle | ratio |
|---|---:|---:|---:|---:|---:|
| gdps-tmp-2m | 2,882,400 | 12 | 278 ms | 98 ms | 2.84× |
| hrdps-continental-tmp-2m | 3,276,600 | 16 | 723 ms | 282 ms | 2.57× |
| raqdps-pm25-sfc | 436,671 | 20 | 105 ms | 140 ms | **0.75×** |
| twelve-fixture total | | | 2110 ms | 883 ms | 2.39× |

This decoder is already faster outright on the 20-bit field. The WASM
build clamps samples wider than 16 bits, so its former stand-in on that
field was the far slower asm.js artifact. None of the WASM numbers apply
to the production shape. The WASM codec decodes whole images only, so a
sampled decode under it pays the full-decode column every time.

## Where the time goes

Profiling puts ~95% of a full decode in Tier-1 (the MQ/EBCOT bit loops;
the DWT is ~4%). Tier-1 runs per codeblock, so skipping codeblocks skips
the cost, and that is why region decode wins. Tier-1 is also the work
[`src/parallel.ts`](https://github.com/azohra/meteo/blob/main/j2k/src/parallel.ts)
decomposes. The largest field is 911 independent codeblock tasks, each a
pure function over its own byte slice. One *full* decode can therefore
also fan across a worker pool *within* the field. Neither WASM nor native
OpenJPEG can use that dimension at all.

## The worker pool

This package uses no Node APIs, so the pool wiring lives in
`@azohra/meteo.grib/j2k-node`. Under its `strategy: "codeblock"`, a full
decode of the largest field drops from 736 to 133 ms through an 8-worker
pool. See [JPEG 2000 and the pool](/docs/grib/jpeg2000/) for the pool's
API, sizing, and heap behaviour.

Two benches ship with the packages. One times single-thread full decodes
over the corpus
([`tools/bench.ts`](https://github.com/azohra/meteo/blob/main/j2k/tools/bench.ts)).
The other is the region bench behind `J2K_REGION_BENCH=1` in
[`test/region.test.ts`](https://github.com/azohra/meteo/blob/main/j2k/test/region.test.ts).
