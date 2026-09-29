---
title: "GRIB2 in pure TypeScript"
description: "Decode GRIB2 files in TypeScript: regular, rotated, and Lambert grids, simple and complex packing, JPEG 2000, multi-field messages, and NOMADS .idx byte ranges, checked bit-for-bit against ecCodes."
---

**`@azohra/meteo.grib`** decodes GRIB2, the binary format weather services
publish model output in, in pure TypeScript. The forecast engine needs two
things no maintained JavaScript decoder provides. One is grid template 3.1,
the rotated latitude-longitude grid of every ECCC HRDPS, RDPS, REPS, and
RAQDPS field. The other is multi-field messages, which NCEP uses to pair U
and V wind.

The core runs in the browser. It does no I/O and imports nothing from
`node:` ([what the core never does](/docs/grib/coverage/#what-the-core-never-does)).
Node callers get a JPEG 2000 decoder and a worker pool from the separate
`@azohra/meteo.grib/j2k-node` subpath, described in
[JPEG 2000 and the pool](/docs/grib/jpeg2000/).

The package needs Node 22 or later and is ESM-only. It does not pull in the
[forecast engine](/docs/forecast/) or any forecast documents.
`@cornerstonejs/codec-openjpeg`, the selectable WASM codec, installs with it.

```sh
pnpm add @azohra/meteo.grib
```

## Decode a real field

The repository keeps real provider messages in
[`test/fixtures/`](https://github.com/azohra/meteo/tree/main/grib/test/fixtures).
This example decodes a committed HRDPS 2 m temperature field and reads the
value at one launch. The field is on a rotated grid and packed with JPEG
2000, the combination the package was written for.

<!-- meteo-doc-fence: run -->
```js
// decode-fixture.mjs — run inside grib/ after `mise run build`
import { readFileSync } from "node:fs";
import {
  decodeFieldValues,
  nearestGridpoint,
  parseFields,
  parseGrid,
  splitMessages,
} from "./dist/index.js";
import { createNodeJ2kDecoder } from "./dist/j2k-node.js";

const bytes = readFileSync("test/fixtures/hrdps-continental-tmp-2m.grib2");
const [field] = parseFields(splitMessages(bytes)[0]);
const grid = parseGrid(field.section3); // rotated lat-lon (GDT 3.1)
const decodeJ2k = await createNodeJ2kDecoder(); // every ECCC field is JPEG 2000
const { values } = decodeFieldValues(field, { decodeJ2k });
const site = nearestGridpoint(grid, 49.3634, -117.2361); // a launch near Nelson, BC
console.log(`${grid.kind} ${grid.ni}x${grid.nj} = ${values.length} points`);
console.log(site);
console.log(`2 m temperature: ${(values[site.index] - 273.15).toFixed(2)} C`);
```

```text
rotated 2540x1290 = 3276600 points
{
  index: 879425,
  latitude: 49.3642714812993,
  longitude: -117.23441055371016,
  distanceKm: 0.1560769875776412
}
2 m temperature: 23.05 C
```

The forecast engine imports the same API from `@azohra/meteo.grib` and
`@azohra/meteo.grib/j2k-node`.

## Decode your own file

The same steps work on any GRIB2 file once the package is installed from
npm. List what a file holds before you decode it. One message can carry
several fields (NCEP sends U and V wind as submessages of one message). The
template numbers tell you each field's grid geometry and whether it needs a
JPEG 2000 decoder, which packing 5.40 does. Every ECCC field uses 5.40.

```js
import { readFileSync } from "node:fs";
import {
  decodeFieldValues,
  parseFields,
  parseProduct,
  splitMessages,
} from "@azohra/meteo.grib";
import { createNodeJ2kDecoder } from "@azohra/meteo.grib/j2k-node";

const bytes = readFileSync("./your-file.grib2");

// Enumerate the fields: template numbers read straight from the raw
// section bytes, before committing to a decode.
const messages = splitMessages(bytes);
for (const [m, message] of messages.entries()) {
  for (const field of parseFields(message)) {
    const product = parseProduct(field.section4);
    const gdt = (field.section3[12] << 8) | field.section3[13]; // grid definition template 3.N
    const drt = (field.section5[9] << 8) | field.section5[10]; // data representation template 5.N
    console.log(
      `message ${m}: parameter ${field.discipline}.${product.parameterCategory}.${product.parameterNumber}, ` +
        `grid 3.${gdt}, packing 5.${drt}`,
    );
  }
}

// Decode the first field. The decoder is consulted only for JPEG 2000
// (packing 5.40) fields; simple and complex packing need no codec.
const decodeJ2k = await createNodeJ2kDecoder();
const [field] = parseFields(messages[0]);
const { values } = decodeFieldValues(field, { decodeJ2k });
console.log(`${values.length} values, first: ${values[0]}`);
```

`parseGrid` accepts grid templates 3.0, 3.1, and 3.30. `decodeFieldValues`
accepts packings 5.0, 5.2, 5.3, and 5.40. Any other template throws an error
that names it, so a file is never decoded approximately.
[What it decodes](/docs/grib/coverage/) lists everything the package
supports.

## Documentation

| Page | Covers |
|---|---|
| [What it decodes](/docs/grib/coverage/) | Grid templates, packing, multi-field messages, bitmaps, wind rotation, the `.idx` byte-range helpers |
| [The ecCodes gate](/docs/grib/correctness/) | How every decode path is checked bit-for-bit against ecCodes over a twenty-message corpus |
| [JPEG 2000 and the pool](/docs/grib/jpeg2000/) | Codec options, decoding only the points you sample, parallel decoding by codeblock, and sizing the worker pool |

## Source layout

```
src/bytes.ts       big-endian octet and MSB-first bitstream primitives (package-private)
src/message.ts     the section walk: messages, multi-field submessages, identification
src/product.ts     section 4 product definitions
src/grid.ts        section 3 grids — regular, rotated, Lambert — with analytic inverses
src/nearest.ts     O(1) nearest-gridpoint lookup, great-circle distance reported
src/decode.ts      sections 5–7: simple and complex unpacking, bitmaps, scaling, the J2K seam
src/wind.ts        grid-relative → earth-relative wind rotation, Lambert cone constant
src/sphere.ts      rotated-pole coordinate transforms
src/idx.ts         NOMADS .idx parsing and ranged-fetch helpers
src/index.ts       the browser-safe barrel
src/j2k-node.ts    Node-only JPEG 2000 wiring: in-process decoder and worker pool
src/j2k-worker.ts  the codecs and the pool's worker entry — shipped in dist
test/              module suites, the ecCodes golden gate, and the @azohra/meteo.j2k gates;
                   fixtures/ is the frozen corpus, fixtures-idx/ the NOMADS .idx excerpts
tools/             decode, pool, and codec benches
```

## Credits

ecCodes (Apache-2.0, ECMWF) is the reference implementation. The golden
corpus records its output, and the decode arithmetic follows its semantics
exactly. Wesley Ebisuzaki's `unpk_complex.c` from wgrib2 (public domain)
guided the complex-packing decoder, and grib2class (MIT, archmoj) served as
a pure-JavaScript cross-check. JPEG 2000 decoding uses this workspace's
[`@azohra/meteo.j2k`](/docs/j2k/) by default. `@cornerstonejs/codec-openjpeg`
(MIT, the cornerstone.js team), which wraps OpenJPEG, is the alternative you
can select. The golden suite includes a port of numpy's pairwise summation
(BSD-3-Clause). Thank you to all of them.
