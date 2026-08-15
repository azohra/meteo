---
title: "The subset: measured, guarded, deliberate"
description: "The exact codestream shape @azohra/meteo.j2k decodes, measured from the feeds; everything outside it fails loudly with a named UnsupportedJ2kError."
---

Every JPEG 2000 codestream the feeds ship, the golden corpus' twelve
OpenJPEG-encoded fields (GDPS, GEPS, HRDPS, RDPS, REPS, RAQDPS) plus the
JasPer-encoded shape a live RDPS CAPE field surfaced the day this
decoder went to production, falls inside this shape, and this decoder
covers exactly it:

- J2K Part 1 raw codestream (no JP2 container: GRIB embeds bare
  SOC..EOC)
- one tile covering the whole grid, one tile-part
- one grayscale component, no subsampling: 12/16/20/24-bit unsigned
  observed; any depth to 28 bits, signed or unsigned, accepted (the
  ceiling is the int32 coefficient carrier: Tier-1 carries magnitudes
  doubled, and 28 bits is the most that keeps every subband's magnitude
  inside it)
- reversible 5/3 wavelet, no quantization (QCD style 0; a tile-part QCC
  restating style-0 quantization for the one component is honoured: the
  JasPer fields ship one whose exponents really differ from the QCD's)
- one quality layer, DEFAULT precincts (the implicit 2^15 grid, which
  is one whole-tile precinct for every gridded field and honestly
  several for JasPer's one-row bitmapped fields: 813275×1 is 25 precincts
  at r=5), default codeblock style, 64×64 codeblocks, 5 decomposition
  levels (any level count in [0, 32] accepted: the loops are generic),
  no ROI

## Loud failure is the design

Everything outside the subset fails with a named `UnsupportedJ2kError`
saying what feature and why: multiple tiles/tile-parts/components/
layers, the 9/7 irrational wavelet, explicit precinct partitions,
RGN/COC/POC, main-header QCC, PPM/PPT packed headers, every non-default
codeblock style bit by name, SOP/EPH markers, quantization.

Absence of generality is the design: a tripped guard means a feed
changed shape, and that deserves a loud failure, not a silent slow path.
The guards live in
[`src/codestream.ts`](https://github.com/azohra/meteo/blob/main/j2k/src/codestream.ts);
the error vocabulary (`UnsupportedJ2kError`, `J2kFormatError`) in
[`src/errors.ts`](https://github.com/azohra/meteo/blob/main/j2k/src/errors.ts).

One guard is deliberately loose: the three resolution-major progression
orders are accepted interchangeably, because with one layer and one
component they emit the same resolution-then-precinct packet sequence;
the position-major orders (PCRL/CPRL) are accepted only while every
resolution has a single precinct, where all five orders coincide: with
one precinct per resolution there is only one position to walk, so
position-major and resolution-major emit the same packet sequence.

## The JasPer story

The guards earned their keep on adoption day. Most ECCC fields are
OpenJPEG-encoded, but the live RDPS smoke surfaced a CAPE field whose
COM marker says "Creator: JasPer", caught by exactly such a loud
failure, then extended into the subset deliberately and
oracle-verified. It differs in three load-bearing ways from every fixture
in the golden corpus:

- **Bitmapped one-row geometry**: the coded values are flattened to an
  813275×1 image (section 6 bitmap; the grid is 1140×1045).
- **Multiple precincts**: 813275 exceeds the default 2^15 precinct, so
  the upper resolutions honestly have several precincts (25 at r=5) and
  the one-packet-per-resolution degeneracy breaks: this fixture is why
  `packets.ts` walks the precinct grid.
- **Tile-part QCC**: quantization is restated in the tile-part header
  with different subband exponents than the main QCD (mis-honoring it
  mis-decodes every codeblock) and 24-bit samples, deeper than the
  20-bit RAQDPS corpus fixture.

The fixture (`rdps-cape-sfc-jasper`) is committed beside the golden
corpus with its own oracle answers; the full provenance is in
[`grib/test/fixtures/README.md`](https://github.com/azohra/meteo/blob/main/grib/test/fixtures/README.md).
How it is gated is covered in
[Two-ring correctness](/docs/j2k/correctness/).
