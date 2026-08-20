---
title: "A T.800 decoder in TypeScript"
description: "The @azohra/meteo.j2k package: a pure-TypeScript JPEG 2000 (ITU-T T.800) decoder scoped to exactly the codestream subset ECCC's GRIB2 feeds ship, with every marker, MQ context, and lifting step readable against its clause of the spec."
---

**`@azohra/meteo.j2k`** is a JPEG 2000 (ITU-T T.800) decoder in pure
TypeScript, scoped to exactly the codestream subset ECCC's GRIB2 feeds
ship. It was written because the forecast engine's hottest loop used to run
through a non-SIMD WASM build of OpenJPEG and, for 20-bit fields,
through OpenJPEG.js, an asm.js-era artifact. Neither was explainable or
patchable in this repository.

This decoder is justified by explainability alone: every marker, MQ
context, and lifting step lives in ten small modules with its clause of
T.800 named. Independence in the format then does two jobs no
whole-image codec can take on. EBCOT codeblocks are coded independently, so one
field's hundreds of codeblocks can decode in parallel across workers
([`src/parallel.ts`](https://github.com/azohra/meteo/blob/main/j2k/src/parallel.ts)
is that seam). And the same independence runs the other way:
`decodeJ2kRegion`
([`src/region.ts`](https://github.com/azohra/meteo/blob/main/j2k/src/region.ts))
decodes *only* the codeblocks a handful of requested gridpoints touch
(bit-identical to the full decode at those points, ~16× faster per core on
the largest ECCC field), which is exactly the shape a site-sampling
forecast engine asks for.

This decoder is the production path: it is
`@azohra/meteo.grib/j2k-node`'s default codec at every bit depth (the WASM
build stays selectable for whole-image decodes; OpenJPEG.js is retired
outright), that package's sampled decode is this decoder's region decode,
and its worker pool fans full decodes' codeblock tasks across threads.

The package depends on neither the
[forecast engine](/docs/forecast/) nor the GRIB packages — Node 22+,
ESM-only, and nothing installs with it:

```sh
pnpm add @azohra/meteo.j2k
```

Installed, the import is `import { decodeJ2k } from "@azohra/meteo.j2k"`;
the examples below run inside the repository, so they import the built
output by path instead.

## Decode a real field

The workspace's golden corpus carries real ECCC messages; the codestream
is the GRIB section 7 payload (DRT 5.40). This decodes one and reads a
sample:

<!-- meteo-doc-fence: run -->
```js
// decode-fixture.mjs — run inside j2k/ after `pnpm build` (and a grib build)
import { readFileSync } from "node:fs";
import { parseFields, splitMessages } from "../grib/dist/index.js";
import { decodeJ2k } from "./dist/index.js";

const bytes = readFileSync("../grib/test/fixtures/geps-orog-m00.grib2");
const [field] = parseFields(splitMessages(bytes)[0]);
const codestream = field.section7.subarray(5); // DRT 5.40: raw J2K after the section header

const { values, width, height, bitsPerSample, isSigned } = decodeJ2k(codestream);
console.log(`${width}x${height} = ${values.length} samples, ${bitsPerSample}-bit ${isSigned ? "signed" : "unsigned"}`);
console.log(`first samples: ${Array.from(values.slice(0, 4)).join(", ")}`);
```

```text
720x361 = 259920 samples, 12-bit unsigned
first samples: 1166, 1166, 1166, 1166
```

## Decode four points, not three million

When only a few gridpoints matter (a forecast engine sampling sites),
`decodeJ2kRegion` takes full-grid raster indexes and entropy-decodes only
the codeblocks those points touch, then runs window-bounded inverse
lifts. The values are bit-identical to `decodeJ2k`'s at those indexes
(region decode is a cheaper route to the same
integers), and the envelope is the package's usual subset, guarded
by the same loud errors:

<!-- meteo-doc-fence: run -->
```js
import { decodeJ2kRegion } from "./dist/index.js";

const region = decodeJ2kRegion(codestream, [93000, 186500]);
console.log(region.values); // === decodeJ2k(codestream).values at those indexes
console.log(`${region.codeblocksDecoded}/${region.codeblocksTotal} codeblocks decoded`);
```

```text
Int32Array(2) [ 56, 54 ]
24/85 codeblocks decoded
```

On the largest ECCC field a 4-point region decode touches 49 of 911
codeblocks; the measured table is in
[Performance](/docs/j2k/performance/), and the exactness gate in
[Two-ring correctness](/docs/j2k/correctness/#region-decode-is-exact-by-contract).

## The `J2kSamples` seam

`decodeJ2k` returns raw integer samples shaped exactly like
`@azohra/meteo.grib`'s `J2kSamples`, so it drops straight into
`decodeFieldValues`' `DecodeJ2k` injection seam, no adapter:

```js
const { values } = decodeFieldValues(field, { decodeJ2k });
```

In `@azohra/meteo.grib`'s Node path this wiring already exists:
`createNodeJ2kDecoder()` and the worker pool default to this decoder;
see [JPEG 2000 and the pool](/docs/grib/jpeg2000/).

## The documentation

| Page | Covers |
|---|---|
| [The subset](/docs/j2k/subset/) | The measured codestream shape, the loud-failure guards, the JasPer extension |
| [Two-ring correctness](/docs/j2k/correctness/) | The cross-codec oracle ring, the end-to-end ecCodes ring, region decode's exactness contract |
| [Performance](/docs/j2k/performance/) | The measured region-decode and single-thread tables, the Tier-1 profile, the codeblock-parallel thesis |

## References

Written against named references; nothing is vendored:

- **ITU-T T.800**: the spec; Annex B (packets, cited in `packets.ts`),
  Annex C (MQ coder, `mq.ts`), Annex D (coefficient bit modelling,
  `t1.ts`), Annex F (the reversible 5/3 inverse, `dwt.ts`).
- **OpenJPEG** (BSD-2, © Université catholique de Louvain), the
  behavioural reference: pass gating and midpoint arithmetic (t1.c),
  lifting order and edge cases (dwt.c), tag trees (tgt.c), header
  reading order (t2.c). Also the oracle, through the two codec packages
  `@azohra/meteo.grib/j2k-node` wraps.
- **pdf.js's jpx.js and ArithmeticDecoder** (Apache-2.0, Mozilla), the
  pure-JavaScript cross-reference for MQ register conventions and Tier-1
  neighbourhood bookkeeping, proven on MSC data via grib2class's lineage.

## Layout

```
src/codestream.ts  marker walk and subset guards (SIZ/COD/QCD/SOT/SOD/EOC)
src/packets.ts     Tier-2: geometry, tag-tree queries, packet headers
src/tagtree.ts     the B.10.2 tag trees
src/mq.ts          the Annex C MQ arithmetic decoder
src/t1.ts          EBCOT Tier-1: the three passes, 19 contexts, sign coding
src/dwt.ts         inverse reversible 5/3 lifting over the level ladder
src/image.ts       assembly: T1 → DWT → DC shift/clamp → samples
src/parallel.ts    the per-codeblock decode plan a worker pool fans out
src/region.ts      region decode: exact samples at requested points only
src/errors.ts      UnsupportedJ2kError and J2kFormatError, the loud-failure vocabulary
test/              header parse + guards, parallel-plan equality, the JasPer shape,
                   the region-decode exactness sweep over the whole corpus
                   (grib-free; the two-ring golden gate is grib/test/j2k-golden.test.ts)
tools/bench.ts     single-thread decodeJ2k timing over the corpus
```

Zero runtime dependencies, and no Node APIs in `src/`: the package runs
in browsers as-is.
