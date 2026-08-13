import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  decodeFieldValues,
  nearestGridpoint,
  parseFields,
  parseGrid,
  splitMessages,
} from "../src/index.js";
import { createNodeJ2kDecoder } from "../src/j2k-node.js";

interface ManifestEntry {
  name: string;
  gridDefinitionTemplateNumber: number;
  dataRepresentationTemplateNumber: number;
  bitmapPresent: boolean;
  fieldCount: number;
}
interface FieldExpectation {
  gridMeta: Record<string, unknown>;
  values: {
    sha256: string;
    count: number;
    missingCount: number;
    min: number | null;
    max: number | null;
    mean: number | null;
    samples: Array<[number, number]>;
  };
  sites: Array<
    | { slug: string; index: number; latitude: number; longitude: number; distanceKm: number }
    | { slug: string; error: string }
  >;
}

const fixturesDir = fileURLToPath(new URL("./fixtures/", import.meta.url));
const manifestPath = join(fixturesDir, "manifest.json");

const manifest: { fixtures: ManifestEntry[] } = existsSync(manifestPath)
  ? (JSON.parse(readFileSync(manifestPath, "utf8")) as { fixtures: ManifestEntry[] })
  : { fixtures: [] };

if (manifest.fixtures.length === 0) {
  console.error(
    "\n[golden] grib/test/fixtures is absent or empty — the ecCodes parity suite DID NOT RUN. " +
      "Harvest fixtures with python/tools/harvest_grib_fixtures.py.\n",
  );
}

// sites.json is a frozen harvest-time copy: the sidecars' per-site answers
// were computed at these exact coordinates and most fixtures cannot be
// re-harvested — never re-point it at a live catalog or edit it.
const sites = (
  JSON.parse(readFileSync(join(fixturesDir, "sites.json"), "utf8")) as {
    sites: Array<{ slug: string; latitude: number; longitude: number }>;
  }
).sites;

function sha256OfFloat64Le(values: Float64Array): string {
  const bytes = new Uint8Array(values.length * 8);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i++) view.setFloat64(i * 8, values[i]!, true);
  return createHash("sha256").update(bytes).digest("hex");
}

/** numpy-compatible pairwise summation — the recorded means are numpy's,
 * and a naive left-to-right sum differs in the last ulp. */
function numpyPairwiseSum(a: Float64Array, offset: number, n: number): number {
  if (n < 8) {
    let res = -0.0;
    for (let i = 0; i < n; i++) res += a[offset + i]!;
    return res;
  }
  if (n <= 128) {
    const r = [
      a[offset]!,
      a[offset + 1]!,
      a[offset + 2]!,
      a[offset + 3]!,
      a[offset + 4]!,
      a[offset + 5]!,
      a[offset + 6]!,
      a[offset + 7]!,
    ];
    let i = 8;
    for (; i < n - (n % 8); i += 8) {
      for (let j = 0; j < 8; j++) r[j]! += a[offset + i + j]!;
    }
    let res = r[0]! + r[1]! + (r[2]! + r[3]!) + (r[4]! + r[5]! + (r[6]! + r[7]!));
    for (; i < n; i++) res += a[offset + i]!;
    return res;
  }
  let n2 = Math.floor(n / 2);
  n2 -= n2 % 8;
  return numpyPairwiseSum(a, offset, n2) + numpyPairwiseSum(a, offset + n2, n - n2);
}

const describeGolden = manifest.fixtures.length > 0 ? describe : describe.skip;
const decodeJ2k = manifest.fixtures.length > 0 ? await createNodeJ2kDecoder() : undefined;

describeGolden("golden ecCodes parity", () => {
  for (const entry of manifest.fixtures) {
    const expectation = JSON.parse(
      readFileSync(join(fixturesDir, `${entry.name}.expect.json`), "utf8"),
    ) as FieldExpectation & { multiField: boolean; fields?: FieldExpectation[] };
    const fieldExpectations: FieldExpectation[] = expectation.multiField
      ? expectation.fields!
      : [expectation];

    describe(`${entry.name} (GDT 3.${entry.gridDefinitionTemplateNumber}, DRT 5.${entry.dataRepresentationTemplateNumber}${entry.bitmapPresent ? ", bitmap" : ""})`, () => {
      it(`decodes ${entry.fieldCount} field(s) bit-for-bit`, () => {
        const bytes = new Uint8Array(readFileSync(join(fixturesDir, `${entry.name}.grib2`)));
        const messages = splitMessages(bytes);
        expect(messages).toHaveLength(1);
        const fields = parseFields(messages[0]!);
        expect(fields).toHaveLength(fieldExpectations.length);

        fields.forEach((field, index) => {
          const expected = fieldExpectations[index]!.values;
          const decoded = decodeFieldValues(field, { decodeJ2k });
          expect(decoded.values.length, "full-grid value count").toBe(expected.count);
          expect(decoded.missingCount, "missing count").toBe(expected.missingCount);
          expect(sha256OfFloat64Le(decoded.values), `field ${index} sha256`).toBe(expected.sha256);

          const sampleMismatches = expected.samples
            .filter(([at, value]) => decoded.values[at] !== value)
            .map(([at, value]) => `[${at}] decoded ${decoded.values[at]} != ecCodes ${value}`);
          expect(sampleMismatches, `field ${index} sampled values`).toEqual([]);

          const present =
            decoded.missingCount === 0
              ? decoded.values
              : decoded.values.filter((_, at) => decoded.missingMask![at] === 0);
          if (expected.min === null) {
            expect(present.length).toBe(0);
          } else {
            let min = present[0]!;
            let max = present[0]!;
            for (const value of present) {
              if (value < min) min = value;
              if (value > max) max = value;
            }
            expect(min, `field ${index} min`).toBe(expected.min);
            expect(max, `field ${index} max`).toBe(expected.max);
            const mean = (0 + numpyPairwiseSum(present, 0, present.length)) / present.length;
            expect(mean, `field ${index} mean`).toBe(expected.mean);
          }
        });
      });

      it("resolves every catalogued site to ecCodes' gridpoint", () => {
        const bytes = new Uint8Array(readFileSync(join(fixturesDir, `${entry.name}.grib2`)));
        const fields = parseFields(splitMessages(bytes)[0]!);
        fields.forEach((field, index) => {
          const grid = parseGrid(field.section3);
          for (const siteExpectation of fieldExpectations[index]!.sites) {
            if ("error" in siteExpectation) continue;
            const site = sites.find((entry2) => entry2.slug === siteExpectation.slug);
            expect(site, `catalogued site ${siteExpectation.slug}`).toBeDefined();
            const nearest = nearestGridpoint(grid, site!.latitude, site!.longitude);
            expect(
              nearest.index,
              `${siteExpectation.slug}: index ${nearest.index} (${nearest.latitude}, ${nearest.longitude}) ` +
                `vs ecCodes ${siteExpectation.index} (${siteExpectation.latitude}, ${siteExpectation.longitude})`,
            ).toBe(siteExpectation.index);
            const delta = Math.abs(nearest.distanceKm - siteExpectation.distanceKm);
            expect(
              delta,
              `${siteExpectation.slug}: distance ${nearest.distanceKm} km vs ecCodes ` +
                `${siteExpectation.distanceKm} km (Δ ${delta} km > 0.1 km)`,
            ).toBeLessThanOrEqual(0.1);
          }
        });
      });
    });
  }
});
