# `@azohra/meteo.j2k`

A JPEG 2000 (ITU-T T.800) decoder in pure TypeScript. It decodes exactly
the codestream subset that ECCC's GRIB2 feeds use. The code is written to be
read: ten small modules, with each marker, MQ context, and lifting step
naming its clause of T.800. It is the production codec behind
`@azohra/meteo.grib/j2k-node`.

Two features depend on owning the internals. `decodeJ2kRegion` decodes only
the codeblocks that a few requested gridpoints touch. Its values at those
points are bit-identical to a full decode, and it is about 16× faster per
core on the largest ECCC field. For full decodes, the worker pool spreads a
field's independent EBCOT codeblocks across threads.
[Performance](https://meteo.azohra.com/docs/j2k/performance/) has the dated
benchmarks and method. The package has no runtime dependencies and no Node
APIs in `src/`.

```sh
pnpm add @azohra/meteo.j2k
```

## Decode a real field

The workspace's golden corpus holds real ECCC messages. In a GRIB2 field
packed with data representation template 5.40, the JPEG 2000 codestream is
the payload of section 7. This example decodes one and prints a few samples.

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

When you need only a few gridpoints, `decodeJ2kRegion(codestream, indices)`
returns the same integers `decodeJ2k` would return at those raster indexes,
and entropy-decodes only the codeblocks the points touch.

The decoder supports the subset the feeds use and nothing more. Anything
outside it throws `UnsupportedJ2kError`. [Two-ring correctness](https://meteo.azohra.com/docs/j2k/correctness/)
explains how each supported configuration is tested, including the exactness
of region decode.

## Documentation

The reference in [`docs/`](docs/) covers the supported subset, the
correctness gate, and measured performance. It is published at
<https://meteo.azohra.com/docs/j2k/>.

MIT © Justin Watts
