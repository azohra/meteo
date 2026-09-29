---
title: "The ecCodes gate"
description: "How @azohra/meteo.grib is accepted: bit-for-bit equality against ecCodes over a frozen twenty-message golden corpus, with exact-equality assertions and no tolerances."
---

The decoder is accepted only when its output agrees bit for bit with
ecCodes, ECMWF's reference implementation. The values must be identical,
with no tolerance.

## Why exact equality is possible

Decoded GRIB values are integers scaled by powers of two and ten, so
every value assertion is exact equality, and an inexact double is a
decoder bug. The gate forced two refinements.

- Scale factors use ecCodes' iterated `codes_power` instead of
  `Math.pow`. The two differ by an ulp at decimal scale 6.
- The recorded mean is recomputed with numpy's pairwise summation,
  because a naive left-to-right sum differs in the last ulp over
  millions of doubles.

## The twenty-message corpus

The golden corpus in
[`test/fixtures/`](https://github.com/azohra/meteo/tree/main/grib/test/fixtures)
is twenty real messages harvested from every live feed the forecast engine
reads: GFS, HRRR, NAM, HRDPS (continental and West 1 km), RDPS, GDPS,
REPS, GEPS, RAQDPS. Each message is paired with an expectation sidecar
derived from ecCodes (2.48.0). A sidecar holds:

- a sha256 of the decoded Float64Array (serialized as little-endian
  float64),
- exact statistics (count, missing count, min, max, mean),
- 200 evenly spread sampled values, plus known-missing indexes on
  bitmapped fields, and
- ecCodes' own nearest-gridpoint answer for every catalogued site.

A decoder that reproduces a sidecar is bit-for-bit compatible with
ecCodes on that message. The corpus was curated to cover the awkward
shapes. It includes a two-submessage NCEP paired-wind message, a sparse
bitmap (76 of 1,905,141 points masked), grid-relative ensemble wind for
rotation validation, and the GEPS orography field whose values are
decametres although its metadata says metres.

## Why the corpus is frozen

The fixtures README,
[`grib/test/fixtures/README.md`](https://github.com/azohra/meteo/blob/main/grib/test/fixtures/README.md),
records the provenance URLs, the harvest process, and why the corpus
cannot be regenerated. ECCC's Datamart keeps roughly one day of files, so
every ECCC source URL expired within ~24 h of harvest, and no harvester
ships in this repository. The site coordinates in the sidecars are a
frozen copy of the catalogue as it stood at harvest (2026-08-11). They are
part of the golden data and do not track the live catalogue. The committed
bytes are the ground truth, and the URLs record provenance only.

`rdps-cape-sfc-jasper` is kept beside the corpus and is not part of it.
It is a JasPer-encoded RDPS field that a live smoke surfaced after the
corpus froze. It answers to a different oracle (OpenJPEG.js, verified
out-of-tree before that codec's retirement). The golden suite's
enumeration therefore stays the twenty ecCodes messages, and the suites
that gate this fixture name it directly.
[The j2k subset page](/docs/j2k/subset/) explains its role on the JPEG
2000 side.

## Where the gate runs

The golden suite lives in the package's `test/` directory alongside the
module suites. The JPEG 2000 codec configurations sit behind the same
gate. Every codec and strategy combination must reproduce the golden
answers, in both full and sampled decodes
([`test/j2k-configs.test.ts`](https://github.com/azohra/meteo/blob/main/grib/test/j2k-configs.test.ts)).
