# `@azohra/meteo.grib`

A GRIB2 decoder in pure TypeScript. It exists because the forecast engine
needs grid template 3.1 (rotated latitude-longitude, used by every ECCC
HRDPS, RDPS, REPS, and RAQDPS field) and multi-field messages (NCEP's paired
U/V submessages), and no maintained JavaScript decoder handles either. The
core does no I/O and runs in the browser. JPEG 2000 decoding and the worker
pool live in the Node-only `@azohra/meteo.grib/j2k-node` subpath.

```sh
pnpm add @azohra/meteo.grib
```

## Decode a real field

This decodes a committed HRDPS 2 m temperature field and reads the value at
one launch. The field is on a rotated grid and packed with JPEG 2000, the
combination the package was written for.

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

Every decode path must match ecCodes bit-for-bit over the frozen
twenty-message corpus in [`test/fixtures/`](test/fixtures/README.md).
[The ecCodes gate](https://meteo.azohra.com/docs/grib/correctness/)
explains how.

## Documentation

The reference in [`docs/`](docs/) covers what the package decodes, the
ecCodes gate, and the JPEG 2000 codecs and worker pool. It is published at
<https://meteo.azohra.com/docs/grib/>.

MIT © Justin Watts
