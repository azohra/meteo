---
title: "The ecCodes gate"
description: "How @azohra/meteo.grib is accepted: bit-for-bit equality against ecCodes over a frozen twenty-message golden corpus, with exact-equality assertions and no tolerances."
---

The decoder's acceptance gate is bit-for-bit agreement with ecCodes,
ECMWF's reference implementation. Not close, not within tolerance:
identical.

## Why exact equality is possible

Decoded GRIB values are integers scaled by powers of two and ten, so
every value assertion is exact equality: an inexact double is a decoder
bug. Two refinements the gate
forced:

- Scale factors use ecCodes' iterated `codes_power`, not `Math.pow`;
  they differ by an ulp at decimal scale 6.
- The recorded mean is recomputed with numpy's pairwise summation,
  because a naive left-to-right sum differs in the last ulp over
  millions of doubles.

## The twenty-message corpus

The golden corpus in
[`test/fixtures/`](https://github.com/azohra/meteo/tree/main/grib/test/fixtures)
is twenty real messages harvested from every live feed the forecast engine
reads: GFS, HRRR, NAM, HRDPS (continental and West 1 km), RDPS, GDPS,
REPS, GEPS, RAQDPS. Each is paired with an ecCodes-derived (2.48.0)
expectation sidecar:

- a sha256 of the decoded Float64Array (serialized as little-endian
  float64),
- exact statistics (count, missing count, min, max, mean),
- 200 evenly spread sampled values, plus known-missing indexes on
  bitmapped fields, and
- ecCodes' own nearest-gridpoint answer for every catalogued site.

A decoder that reproduces a sidecar is bit-for-bit compatible with
ecCodes on that message. The corpus was curated to cover the awkward
shapes: a two-submessage NCEP paired-wind message, a sparse bitmap
(76 of 1,905,141 points masked), grid-relative ensemble wind for
rotation validation, and the GEPS orography field whose values are
decametres despite metadata claiming metres.

## A frozen corpus, by design

The fixtures README,
[`grib/test/fixtures/README.md`](https://github.com/azohra/meteo/blob/main/grib/test/fixtures/README.md),
tells the full story: provenance URLs, the harvest process, and why
the corpus cannot be regenerated. In short: ECCC's Datamart keeps
roughly one day of files, so every ECCC source URL expired within ~24 h
of harvest and no harvester ships in this repository; and the site
coordinates in the sidecars are a frozen copy of the
catalogue as it stood at harvest (2026-08-11), part of the golden data
rather than a live catalogue. The committed bytes are the ground truth;
the URLs are provenance only.

`rdps-cape-sfc-jasper` sits beside the corpus rather than in it:
a JasPer-encoded RDPS field that a live smoke
surfaced after the corpus froze. It answers to a different oracle
(OpenJPEG.js, verified out-of-tree before that codec's retirement), so
the golden suite's enumeration stays the twenty ecCodes messages and the
suites that gate this fixture name it directly. Its role in the JPEG
2000 story is covered in [the j2k subset page](/docs/j2k/subset/).

## Where the gate runs

The golden suite lives in the package's `test/` directory alongside the
module suites. The JPEG 2000 codec configurations sit behind the same
gate: every codec and strategy combination must reproduce the golden
answers, full-decode and sampled
([`test/j2k-configs.test.ts`](https://github.com/azohra/meteo/blob/main/grib/test/j2k-configs.test.ts)).
