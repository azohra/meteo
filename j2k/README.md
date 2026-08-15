# `@azohra/meteo.j2k`

A JPEG 2000 (ITU-T T.800) decoder in pure TypeScript, scoped to exactly
the codestream subset ECCC's GRIB2 feeds ship, justified by
explainability: every marker, MQ context, and lifting step lives in ten
small modules with its clause of T.800 named. It is the production
codec behind `@azohra/meteo.grib/j2k-node`, and owning the
internals pays twice: `decodeJ2kRegion` decodes *only* the codeblocks a
few requested gridpoints touch (bit-identical to the full decode at
those points, ~16× faster per core on the largest ECCC field), and the
worker pool fans one field's independent EBCOT codeblocks across threads
for full decodes. The receipts are in
[docs/performance.md](docs/performance.md).
Zero runtime dependencies, no Node APIs in `src/`.

```sh
pnpm add @azohra/meteo.j2k
```

## Decode a real field

The workspace's golden corpus carries real ECCC messages; the codestream
is the GRIB section 7 payload (DRT 5.40). This decodes one and reads a
sample:

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

When only a few gridpoints matter, `decodeJ2kRegion(codestream, indices)`
returns the same integers `decodeJ2k` would put at those raster indexes
(bit for bit, by contract) while entropy-decoding a sliver of the
codeblocks (49 of 911 for 4 scattered points on the largest field).

The decoder covers the measured subset the feeds ship and nothing more
(everything outside it fails loudly with a named `UnsupportedJ2kError`),
and is accepted through two rings: bit-exact against the WASM OpenJPEG
oracle, and end-to-end through `@azohra/meteo.grib` against ecCodes' recorded
answers. Region decode is held to the same standard: bit-identical to the
full decode over the whole corpus, so the oracle tie carries through.

## Documentation

The reference lives in [`docs/`](docs/) (the subset, the two-ring
correctness gate, and the measured performance each have a page) and is
served at <https://meteo.azohra.com/docs/j2k/>.

MIT © Justin Watts
