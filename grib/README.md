# `@azohra/meteo.grib`

A GRIB2 decoder in pure TypeScript, written because the forecast engine needs
grid template 3.1 (rotated latitude-longitude — every ECCC HRDPS, RDPS,
REPS, and RAQDPS field) and multi-field messages (NCEP's paired U/V
submessages), and no maintained JavaScript decoder provides either.
The browser-safe core carries no I/O; JPEG 2000 and the worker pool
live in the Node-only `@azohra/meteo.grib/j2k-node` subpath.

```sh
pnpm add @azohra/meteo.grib
```

## Decode a real field

This decodes a committed HRDPS 2 m temperature field — rotated grid,
JPEG 2000 packing, the combination that motivated the package — and
samples one launch:

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

Every decode path is accepted bit-for-bit against ecCodes over the
frozen twenty-message corpus in [`test/fixtures/`](test/fixtures/README.md).

## Documentation

The reference lives in [`docs/`](docs/) — coverage, the ecCodes gate,
and the JPEG 2000 codecs and worker pool each have a page — and is
served at <https://meteo.azohra.com/docs/grib/>.

MIT © Justin Watts
