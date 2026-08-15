---
title: "Two-ring correctness"
description: "How @azohra/meteo.j2k is accepted: bit-exact against an independent codec oracle, end-to-end through @azohra/meteo.grib against ecCodes' recorded answers, and region decode held bit-identical to the full decode."
---

The acceptance gate has two rings. Both run through `@azohra/meteo.grib`, so
the gate lives in that package's suite
([`grib/test/j2k-golden.test.ts`](https://github.com/azohra/meteo/blob/main/grib/test/j2k-golden.test.ts)),
which is what keeps this package's own suite free of a grib
dependency.

## Ring one: bit-exact against an independent oracle

Every ≤16-bit fixture decodes sample-for-sample identical to
`@azohra/meteo.grib/j2k-node` with `codec: "wasm"` pinned (this decoder is
now that seam's default, so the oracle must be the *other* codec), which
is itself gated bit-for-bit against ecCodes. Integer equality on all
436k–3.3M samples per fixture; one mismatch is a decoder bug, never
tolerance.

The 20-bit RAQDPS fixture has no in-process oracle anymore
(OpenJPEG.js was retired in this decoder's favour), so ring two alone
carries it.

## Ring two: end-to-end through GRIB

`decodeFieldValues` with this decoder injected reproduces the ecCodes
sha256 recorded in every fixture's `.expect.json` (every fixture, every
depth) and the recorded out-of-tree oracle answer for the
[JasPer fixture](/docs/j2k/subset/#the-jasper-story) beside the corpus.
The corpus itself and its frozen-by-design provenance are documented in
[The ecCodes gate](/docs/grib/correctness/).

## Region decode is exact by contract

`decodeJ2kRegion` promises bit-identity, not approximation: every value
it returns equals `decodeJ2k(codestream).values[index]` for the same
index. The promise rests on an argument and a gate. The argument: a
windowed inverse 5/3 lift is bit-identical to the full lift at every
output whose dependency cone lies inside the window, and the region
decoder's windows carry the full synthesis margin on every side that is
not a true image boundary; where the window meets the boundary, the
lift's index clamping *is* the full decoder's boundary extension (the
derivation is written out at the top of
[`src/region.ts`](https://github.com/azohra/meteo/blob/main/j2k/src/region.ts)).
The gate:
[`test/region.test.ts`](https://github.com/azohra/meteo/blob/main/j2k/test/region.test.ts)
holds region against full decode over every codestream flavor in the
corpus (12- through 24-bit, corners, full border sweeps, adjacent
clusters, and dense scatters to 5000 points) to integer equality. One
mismatched sample is a decoder bug, never tolerance.

The tie is transitive: the full decode is gated bit-for-bit against the
codec oracle (ring one) and ecCodes' recorded answers (ring two), and
region decode is gated bit-for-bit against the full decode, so a region-decoded sample
carries exactly the oracle's answer. `@azohra/meteo.grib` re-asserts the
chain at its own seam: its sampled worker path must reproduce the full
decode's GRIB-scaled doubles at every requested point
([`grib/test/production-codec-throughput.test.ts`](https://github.com/azohra/meteo/blob/main/grib/test/production-codec-throughput.test.ts),
[`grib/test/j2k-configs.test.ts`](https://github.com/azohra/meteo/blob/main/grib/test/j2k-configs.test.ts)).

## The package's own suite

This package's suite
([`test/`](https://github.com/azohra/meteo/tree/main/j2k/test)) covers
what needs no GRIB seam: the marker walk and subset guards against every
corpus fixture's header, the parallel plan's sample-for-sample equality
with the serial decode, the region-decode exactness sweep, and the
JasPer shape's raw-sample answers.

## Truncation would round-trip too

Tier-1 magnitudes follow OpenJPEG's midpoint convention (coefficients
carry a doubled half, truncated away at the end), so even a truncated
codestream (which lossless GRIB never ships) would reconstruct
bit-for-bit like the oracle.
