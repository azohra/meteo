---
title: "Performance, honestly"
description: "Measured timings for @azohra/meteo.j2k: region decode (the production shape) against full decode per core, the single-thread table against the WASM OpenJPEG oracle, the Tier-1 profile, and the codeblock-parallel pool."
---

The production shape is a *sampled* decode: a handful of site gridpoints
out of a multi-megapoint field. For that shape this decoder does something
no whole-image codec can: `decodeJ2kRegion` entropy-decodes only the
codeblocks the requested points touch and runs window-bounded inverse
lifts, returning values bit-identical to the full decode (the contract is
in [Two-ring correctness](/docs/j2k/correctness/)).

Measured single-threaded (minimum of 5, Node 24, Apple M5 Max; 4
uniformly scattered points per field; recorded 2026-08-12):

| fixture | samples | bits | full decode | region, 4 points | ratio | codeblocks touched |
|---|---:|---:|---:|---:|---:|---:|
| gdps-tmp-2m | 2,882,400 | 12 | 266 ms | 22 ms | 11.9× | 49/791 |
| hrdps-continental-tmp-2m | 3,276,600 | 16 | 692 ms | 44 ms | 15.6× | 49/911 |
| raqdps-pm25-sfc | 436,671 | 20 | 101 ms | 20 ms | 5.0× | 28/136 |
| rdps-cape-sfc-jasper | 813,275 | 24 | 295 ms | 4.4 ms | 67× | 25/12,711 |

The 67× row is not the trend: `rdps-cape-sfc-jasper` is the JasPer field's
one-row bitmapped geometry
([the JasPer story](/docs/j2k/subset/#the-jasper-story)); an 813275×1
image splits into 12,711 tiny codeblocks, so four points touch a far
smaller fraction of them than on any gridded field.

The cost scales sublinearly in points because nearby points share windows
and every point's coarse-level ancestry converges: on HRDPS-continental
(same machine, single thread) 1 point touches 16 codeblocks (14 ms), 4
points 49 (44 ms), 16 points 145 (121 ms), 64 points 366 (297 ms), 256
points 674 (538 ms). The full packet-structure parse is unavoidable
(packet lengths are only discoverable sequentially), but it is under half a
millisecond on every regular fixture.

![Four requested points on the HRDPS continental field, the tile buffer with all 911 codeblocks drawn across five decomposition levels where only the 49 the 4-point decode entropy-decoded are filled and hatched, and a bar row showing the touched count growing sublinearly as the same scatter scales from 1 to 256 points.](figures/region-decode.svg)

Through `@azohra/meteo.grib`'s worker pool this is the sampled path
end-to-end: on the same machine, a 4-point sampled decode of
HRDPS-continental through `sampleFieldValuesAsync` and a 2-worker pool
sustains 25.5 ms per field against 394 ms per field for full decodes:
15.5× per core, so a 3,500-field HRDPS lane projects to ~90 s of sampled
decode at pool 2 where full decodes would need ~23 minutes. The gate that
holds the mechanism (≥6× per core, and bit-exactness against the full
decode) is
[`grib/test/production-codec-throughput.test.ts`](https://github.com/azohra/meteo/blob/main/grib/test/production-codec-throughput.test.ts).

## Full decode, single thread

Decoding whole images single-threaded, this decoder is slower than the
WASM OpenJPEG build and faster than the asm.js one. Measured by the
cross-codec bench
([`grib/tools/bench-j2k-single.ts`](https://github.com/azohra/meteo/blob/main/grib/tools/bench-j2k-single.ts);
it needs both codecs, and only that package depends on both; minimum
of 5, Node 24, Apple Silicon; recorded 2026-08-12):

| fixture | samples | bits | @azohra/meteo.j2k | oracle | ratio |
|---|---:|---:|---:|---:|---:|
| gdps-tmp-2m | 2,882,400 | 12 | 278 ms | 98 ms | 2.84× |
| hrdps-continental-tmp-2m | 3,276,600 | 16 | 723 ms | 282 ms | 2.57× |
| raqdps-pm25-sfc | 436,671 | 20 | 105 ms | 140 ms | **0.75×** |
| twelve-fixture total | | | 2110 ms | 883 ms | 2.39× |

On the 20-bit field this decoder already wins outright: the WASM build
clamps samples wider than 16 bits, so its former stand-in there was the
far slower asm.js artifact. And none of the WASM numbers apply to the
production shape at all: the WASM codec decodes whole images only, so a
sampled decode under it pays the full-decode column every time.

## Where the time goes

Profiling puts ~95% of a full decode in Tier-1 (the MQ/EBCOT bit loops;
the DWT is ~4%). That is exactly why region decode wins (Tier-1 runs
per codeblock, so skipping codeblocks skips the cost) and exactly the
work
[`src/parallel.ts`](https://github.com/azohra/meteo/blob/main/j2k/src/parallel.ts)
decomposes: the largest field is 911 independent codeblock tasks, each a
pure function over its own byte slice, so one *full* decode can also fan
across a worker pool *within* the field, a dimension neither WASM nor
native OpenJPEG can use at all.

## The pool lives next door

The pool wiring is deliberately not in this package (no Node APIs here,
ever); it lives in `@azohra/meteo.grib/j2k-node`. Its `decodeSampled` rides
`decodeJ2kRegion` directly; for full decodes, `strategy: "codeblock"`
fans one field's codeblocks across the whole pool, cutting its latency
several-fold (736 → 133 ms measured on the largest field through an
8-worker pool) while saturated throughput ties per-field fan-out exactly.
See [JPEG 2000 and the pool](/docs/grib/jpeg2000/) for the pool's API,
sizing, and heap behaviour.

Two benches ship with the packages: single-thread full-decode timing over
the corpus
([`tools/bench.ts`](https://github.com/azohra/meteo/blob/main/j2k/tools/bench.ts)),
and the region bench behind `J2K_REGION_BENCH=1` in
[`test/region.test.ts`](https://github.com/azohra/meteo/blob/main/j2k/test/region.test.ts).
