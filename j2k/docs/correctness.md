---
title: "Two-ring correctness"
description: "How @azohra/meteo.j2k is accepted: bit-exact against an independent codec oracle, end-to-end through @azohra/meteo.grib against ecCodes' recorded answers, and with region decode held bit-identical to the full decode."
---

The acceptance gate has two rings. Both run through `@azohra/meteo.grib`, so
the gate lives in that package's suite
([`grib/test/j2k-golden.test.ts`](https://github.com/azohra/meteo/blob/main/grib/test/j2k-golden.test.ts)).
That keeps this package's own suite free of a grib dependency.

## Ring one: bit-exact against an independent oracle

Every ≤16-bit fixture decodes sample-for-sample identical to
`@azohra/meteo.grib/j2k-node` with `codec: "wasm"` pinned. This decoder is
now that seam's default, so the oracle has to be the *other* codec. That
codec is itself gated bit-for-bit against ecCodes. The check is integer
equality on all 436k–3.3M samples per fixture. It allows no tolerance, so
one mismatch is a decoder bug.

The 20-bit RAQDPS fixture no longer has an in-process oracle, because
OpenJPEG.js was retired in this decoder's favour. Ring two alone carries
it.

## Ring two: end-to-end through GRIB

`decodeFieldValues` with this decoder injected reproduces the ecCodes
sha256 recorded in every fixture's `.expect.json`, for every fixture at
every depth. It also reproduces the recorded out-of-tree oracle answer for
the [JasPer fixture](/docs/j2k/subset/#the-jasper-story) beside the corpus.
[The ecCodes gate](/docs/grib/correctness/) documents the corpus itself
and its provenance, which is frozen by design.

## Region decode is exact by contract

`decodeJ2kRegion` promises bit-identity. Every value it returns equals
`decodeJ2k(codestream).values[index]` for the same index. A derivation and
a test hold that promise.

The derivation starts from the fact that a windowed inverse 5/3 lift is
bit-identical to the full lift at every output whose dependency cone lies
inside the window. The region decoder's windows carry the full synthesis
margin on every side that is not a true image boundary. Where the window
meets the boundary, the lift's index clamping *is* the full decoder's
boundary extension. The derivation is written out at the top of
[`src/region.ts`](https://github.com/azohra/meteo/blob/main/j2k/src/region.ts).

The test,
[`test/region.test.ts`](https://github.com/azohra/meteo/blob/main/j2k/test/region.test.ts),
holds region decode to integer equality with the full decode over every
codestream flavor in the corpus. It covers 12- through 24-bit fields,
corners, full border sweeps, adjacent clusters, and dense scatters of up
to 5000 points.

The chain is transitive. The full decode is gated bit-for-bit against the
codec oracle (ring one) and ecCodes' recorded answers (ring two). Region
decode is held to integer equality with the full decode. So a
region-decoded sample carries exactly the oracle's answer.
`@azohra/meteo.grib` re-asserts the chain at its own seam. Its sampled
worker path must reproduce the full decode's GRIB-scaled doubles at every
requested point
([`grib/test/production-codec-throughput.test.ts`](https://github.com/azohra/meteo/blob/main/grib/test/production-codec-throughput.test.ts),
[`grib/test/j2k-configs.test.ts`](https://github.com/azohra/meteo/blob/main/grib/test/j2k-configs.test.ts)).

## The package's own suite

This package's suite
([`test/`](https://github.com/azohra/meteo/tree/main/j2k/test)) covers
what needs no GRIB seam. It checks the marker walk and subset guards
against every corpus fixture's header, the parallel plan's
sample-for-sample equality with the serial decode, the region-decode
exactness sweep, and the JasPer shape's raw-sample answers.

## Truncation would round-trip too

Tier-1 magnitudes follow OpenJPEG's midpoint convention. Coefficients
carry a doubled half that is truncated away at the end. Lossless GRIB
never ships a truncated codestream, but if one arrived it would still
reconstruct bit-for-bit like the oracle.
