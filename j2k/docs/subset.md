---
title: "The subset"
description: "The exact codestream shape @azohra/meteo.j2k decodes, measured from the feeds. Anything outside it fails with a named UnsupportedJ2kError."
---

The decoder covers exactly the codestream shape listed below. The feeds
ship two codestream lineages, and every one falls inside that shape. The
first is the twelve OpenJPEG-encoded ECCC fields of the
[twenty-message golden corpus](/docs/grib/correctness/) (GDPS, GEPS,
HRDPS, RDPS, REPS, RAQDPS; the corpus's NOAA messages carry no JPEG 2000).
The second is the JasPer-encoded shape that a live RDPS CAPE field
surfaced on the day this decoder went to production.

- J2K Part 1 raw codestream. There is no JP2 container, because GRIB
  embeds bare SOC..EOC.
- One tile covering the whole grid, with one tile-part.
- One grayscale component with no subsampling. The feeds show
  12/16/20/24-bit unsigned samples. The decoder accepts any depth up to 28
  bits, signed or unsigned. The ceiling comes from the int32 coefficient
  carrier. Tier-1 carries magnitudes doubled, and 28 bits is the most that
  keeps every subband's magnitude inside it.
- Reversible 5/3 wavelet with no quantization (QCD style 0). The decoder
  honours a tile-part QCC that restates style-0 quantization for the one
  component. The JasPer fields ship one whose exponents differ from the
  QCD's.
- One quality layer and DEFAULT precincts. That is the implicit 2^15 grid,
  which gives one whole-tile precinct for every gridded field and several
  for JasPer's one-row bitmapped fields (813275×1 is 25 precincts at r=5).
- Default codeblock style and 64×64 codeblocks.
- 5 decomposition levels. Any level count in [0, 32] is accepted, because
  the loops are generic.
- No ROI.

## Loud failure is the design

Everything outside the subset fails with a named `UnsupportedJ2kError`
that says which feature it met and why it is unsupported. That covers
multiple tiles, tile-parts, components, or layers, the 9/7 irrational
wavelet, explicit precinct partitions, RGN/COC/POC, main-header QCC,
PPM/PPT packed headers, every non-default codeblock style bit by name,
SOP/EPH markers, and quantization.

The scope is narrow on purpose. A tripped guard means a feed changed
shape, and the decoder should fail loudly rather than fall into a silent
slow path. The guards live in
[`src/codestream.ts`](https://github.com/azohra/meteo/blob/main/j2k/src/codestream.ts),
and the error vocabulary (`UnsupportedJ2kError`, `J2kFormatError`) lives in
[`src/errors.ts`](https://github.com/azohra/meteo/blob/main/j2k/src/errors.ts).

The progression-order guard is looser than the rest. It accepts the three
resolution-major orders interchangeably, because with one layer and one
component they emit the same resolution-then-precinct packet sequence. It
accepts the position-major orders (PCRL/CPRL) only while every resolution
has a single precinct. With one position to walk, all five orders emit the
same packet sequence.

## The JasPer story

A loud failure caught the JasPer shape on adoption day. Most ECCC fields
are OpenJPEG-encoded, but the live RDPS smoke surfaced a CAPE field whose
COM marker says "Creator: JasPer". A guard rejected it, and the subset was
then extended to cover it and oracle-verified. It differs in three
load-bearing ways from every fixture in the golden corpus.

- Its geometry is bitmapped and one row high. The coded values are
  flattened to an 813275×1 image (section 6 bitmap; the grid is
  1140×1045).
- It has multiple precincts. 813275 exceeds the default 2^15 precinct, so
  the upper resolutions have several precincts (25 at r=5) and the
  one-packet-per-resolution degeneracy breaks. This fixture is why
  `packets.ts` walks the precinct grid.
- It restates quantization in a tile-part QCC, with different subband
  exponents than the main QCD. Mis-honoring it mis-decodes every
  codeblock. Its samples are also 24-bit, deeper than the 20-bit RAQDPS
  corpus fixture.

The fixture (`rdps-cape-sfc-jasper`) is committed beside the golden
corpus with its own oracle answers. The full provenance is in
[`grib/test/fixtures/README.md`](https://github.com/azohra/meteo/blob/main/grib/test/fixtures/README.md),
and [Two-ring correctness](/docs/j2k/correctness/) covers how it is gated.
