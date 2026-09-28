---
title: "A T.800 decoder in TypeScript"
description: "A pure-TypeScript JPEG 2000 (ITU-T T.800) decoder for exactly the codestreams ECCC's GRIB2 feeds ship, with region decoding for sampled points and every step traceable to its clause of the spec."
---

**`@azohra/meteo.j2k`** is a JPEG 2000 (ITU-T T.800) decoder in pure
TypeScript. It decodes exactly the subset of the codestream format that
ECCC's GRIB2 feeds use, and rejects everything else.

The forecast engine's busiest loop used to run through a WASM build of
OpenJPEG without SIMD, and 20-bit fields went through OpenJPEG.js, a
library from the asm.js era. Neither was explainable or patchable in this
repository. This decoder is. It has ten small modules, and each marker, MQ
context, and lifting step names the clause of T.800 it implements.

Owning the decoder also made two optimizations possible. JPEG 2000 codes
each EBCOT codeblock independently, so a field's hundreds of codeblocks can
decode in parallel across workers
([`src/parallel.ts`](https://github.com/azohra/meteo/blob/main/j2k/src/parallel.ts)
builds that plan). The same independence lets `decodeJ2kRegion`
([`src/region.ts`](https://github.com/azohra/meteo/blob/main/j2k/src/region.ts))
decode only the codeblocks that a few requested gridpoints touch. The values
at those points are bit-identical to a full decode, and on the largest ECCC
field it is about 16× faster per core. A forecast engine that samples a list
of sites needs exactly that.

This is the production decoder. `@azohra/meteo.grib/j2k-node` uses it by
default at every bit depth, its sampled decode is this package's region
decode, and its worker pool spreads a full decode's codeblocks across
threads. The WASM build of OpenJPEG remains available for whole-image
decodes. OpenJPEG.js has been removed.

The package needs Node 22 or later and is ESM-only. It has no dependencies
and does not depend on the [forecast engine](/docs/forecast/) or the GRIB
package.

```sh
pnpm add @azohra/meteo.j2k
```

Once installed, import it with
`import { decodeJ2k } from "@azohra/meteo.j2k"`. The examples below run
inside the repository, so they import the built output by path.

## Decode a real field

The workspace's golden corpus holds real ECCC messages. In a GRIB2 field
packed with data representation template 5.40, the JPEG 2000 codestream is
the payload of section 7. This example decodes one and prints a few samples.

<!-- meteo-doc-fence: run -->
```js
// decode-fixture.mjs — run inside j2k/ after `mise run build`
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

When you need only a few gridpoints, as a forecast engine sampling sites
does, pass their full-grid raster indexes to `decodeJ2kRegion`. It
entropy-decodes only the codeblocks those points touch, then runs the
inverse wavelet lifts over a bounded window. The values are bit-identical to
what `decodeJ2k` returns at those indexes. It accepts the same subset as
`decodeJ2k` and throws the same errors outside it.

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

On the largest ECCC field, a 4-point region decode touches 49 of 911
codeblocks. [Performance](/docs/j2k/performance/) has the measurements, and
[Two-ring correctness](/docs/j2k/correctness/#region-decode-is-exact-by-contract)
describes the test that holds region decode to exact equality.

## Use it with `@azohra/meteo.grib`

`decodeJ2k` returns raw integer samples in the same shape as
`@azohra/meteo.grib`'s `J2kSamples` type. You can pass it directly as the
`decodeJ2k` option of `decodeFieldValues`:

```js
const { values } = decodeFieldValues(field, { decodeJ2k });
```

On Node, `@azohra/meteo.grib` already does this for you:
`createNodeJ2kDecoder()` and the worker pool use this decoder by default.
See [JPEG 2000 and the pool](/docs/grib/jpeg2000/).

## Documentation

| Page | Covers |
|---|---|
| [The subset](/docs/j2k/subset/) | The codestream features ECCC uses, the errors for anything else, and the JasPer variant |
| [Two-ring correctness](/docs/j2k/correctness/) | Agreement with other codecs, end-to-end agreement with ecCodes, and exactness of region decode |
| [Performance](/docs/j2k/performance/) | Region-decode and single-thread timings, the Tier-1 profile, and why decoding by codeblock parallelizes |

## References

The decoder was written against these references. No code is vendored.

- ITU-T T.800, the specification: Annex B (packets, cited in `packets.ts`),
  Annex C (MQ coder, `mq.ts`), Annex D (coefficient bit modelling,
  `t1.ts`), Annex F (the reversible 5/3 inverse, `dwt.ts`).
- OpenJPEG (BSD-2, © Université catholique de Louvain), the reference for
  behaviour: pass gating and midpoint arithmetic (t1.c),
  lifting order and edge cases (dwt.c), tag trees (tgt.c), header
  reading order (t2.c). It is also the test oracle, through the two codec
  packages `@azohra/meteo.grib/j2k-node` wraps.
- pdf.js's jpx.js and ArithmeticDecoder (Apache-2.0, Mozilla), the
  pure-JavaScript cross-reference for MQ register conventions and Tier-1
  neighbourhood bookkeeping. grib2class, which descends from this code, has
  proven it on MSC data.

## Source layout

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

The package has no runtime dependencies and uses no Node APIs in `src/`, so
it runs in browsers unchanged.
