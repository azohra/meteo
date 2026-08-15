---
title: "GRIB2 in pure TypeScript"
description: "The @azohra/meteo.grib package: GRIB2 section parsing, rotated and Lambert grids with O(1) nearest-gridpoint lookup, complex packing, JPEG 2000 through an injected decoder seam, and NOMADS .idx helpers, gated bit-for-bit against ecCodes."
---

**`@azohra/meteo.grib`** is a GRIB2 decoder in pure TypeScript, written because
the forecast engine needs grid template 3.1 (rotated latitude-longitude:
every ECCC HRDPS, RDPS, REPS, and RAQDPS field) and multi-field messages
(NCEP's paired U/V submessages), and no maintained JavaScript decoder
provides either.

The core is browser-safe by construction
([what the core never does](/docs/grib/coverage/#what-the-core-never-does));
Node callers get JPEG 2000 from the separate `@azohra/meteo.grib/j2k-node`
subpath; see [JPEG 2000 and the pool](/docs/grib/jpeg2000/).

The package installs on its own, with no
[forecast engine](/docs/forecast/) or forecast documents required —
Node 22+, ESM-only, and `@cornerstonejs/codec-openjpeg` (the selectable
WASM codec) installs with it:

```sh
pnpm add @azohra/meteo.grib
```

## Decode a real field

[`test/fixtures/`](https://github.com/azohra/meteo/tree/main/grib/test/fixtures)
holds real provider messages. This decodes a committed HRDPS 2 m
temperature field (a rotated-grid, JPEG 2000-packed message, the
combination that motivated the package) and samples one launch:

<!-- meteo-doc-fence: run -->
```js
// decode-fixture.mjs — run inside grib/ after `pnpm build`
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

Consumers inside the workspace (the forecast engine) import the same surface
as `@azohra/meteo.grib` and `@azohra/meteo.grib/j2k-node`.

## Decode your own file

Installed from npm, the same walk works on any GRIB2 file. Discover what
a file contains before decoding: one message can carry several fields
(NCEP pairs U/V wind as submessages), and the template numbers say which
grid geometry each field uses and whether it needs a JPEG 2000 decoder
(packing 5.40 — every ECCC field):

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

`parseGrid` accepts grid templates 3.0, 3.1, and 3.30 and
`decodeFieldValues` packings 5.0, 5.2, 5.3, and 5.40; anything outside
that envelope throws, naming the template, rather than decoding
approximately. [What it decodes](/docs/grib/coverage/) is the full
envelope.

## The documentation

| Page | Covers |
|---|---|
| [What it decodes](/docs/grib/coverage/) | Grid templates, packing, multi-field messages, bitmaps, wind rotation, the `.idx` byte-range helpers |
| [The ecCodes gate](/docs/grib/correctness/) | The bit-for-bit acceptance philosophy and the twenty-message golden corpus |
| [JPEG 2000 and the pool](/docs/grib/jpeg2000/) | Codec options, the region-decode sampled path, the codeblock-parallel strategy, worker-pool sizing |

## Layout

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

## Built on

ecCodes (Apache-2.0, ECMWF) is the oracle: the golden corpus is its
answers, and the decode arithmetic follows its exact semantics. wgrib2's
`unpk_complex.c` (public domain, Wesley Ebisuzaki) guided complex
packing; grib2class (MIT, archmoj) served as a pure-JS cross-check.
JPEG 2000 comes from the workspace's own [`@azohra/meteo.j2k`](/docs/j2k/) by
default, with `@cornerstonejs/codec-openjpeg` (MIT, the cornerstone.js
team, carrying OpenJPEG itself) as the selectable fallback. numpy's
pairwise summation (BSD-3-Clause) is ported in the golden suite.
Thanks, all.
