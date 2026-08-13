import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodeJ2k } from "@azohra/meteo.j2k";
import { beforeAll, describe, expect, it } from "vitest";
import { decodeFieldValues, parseFields, splitMessages } from "../src/index.js";
import type { DecodeJ2k, GribField } from "../src/index.js";
import { createNodeJ2kDecoder } from "../src/j2k-node.js";

const fixturesDir = fileURLToPath(new URL("./fixtures/", import.meta.url));

interface ManifestEntry {
  name: string;
  packingType: string;
}

const manifest: { fixtures: ManifestEntry[] } = existsSync(`${fixturesDir}manifest.json`)
  ? (JSON.parse(readFileSync(`${fixturesDir}manifest.json`, "utf8")) as {
      fixtures: ManifestEntry[];
    })
  : { fixtures: [] };

const j2kFixtures = manifest.fixtures.filter((f) => f.packingType === "grid_jpeg");

if (j2kFixtures.length === 0) {
  console.error(
    "\n[j2k-golden] grib/test/fixtures is absent or has no grid_jpeg fixtures — " +
      "the bit-exactness suite DID NOT RUN.\n",
  );
}

function fixtureField(name: string): GribField {
  const bytes = new Uint8Array(readFileSync(`${fixturesDir}${name}.grib2`));
  return parseFields(splitMessages(bytes)[0]!)[0]!;
}

function sha256OfFloat64Le(values: Float64Array): string {
  const bytes = new Uint8Array(values.length * 8);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i++) view.setFloat64(i * 8, values[i]!, true);
  return createHash("sha256").update(bytes).digest("hex");
}

function fixtureBits(name: string): number {
  const codestream = fixtureField(name).section7.subarray(5);
  return (codestream[42]! & 0x7f) + 1;
}
// >16-bit codestreams route back to @azohra/meteo.j2k even under codec "wasm",
// so the oracle is only independent at <=16 bits.
const wasmOracleFixtures = j2kFixtures.filter((f) => fixtureBits(f.name) <= 16);

describe.skipIf(j2kFixtures.length === 0)(
  "bit-exactness against the WASM oracle, pinned so the default codec is never its own oracle",
  () => {
    let oracle: DecodeJ2k;
    beforeAll(async () => {
      oracle = await createNodeJ2kDecoder({ codec: "wasm" });
    });

    for (const fixture of wasmOracleFixtures) {
      it(`decodes ${fixture.name} identically to the oracle, every sample`, () => {
        const codestream = fixtureField(fixture.name).section7.subarray(5);
        const reference = oracle(codestream);
        const decoded = decodeJ2k(codestream);

        expect(decoded.componentCount).toBe(1);
        expect(decoded.bitsPerSample).toBe(reference.bitsPerSample);
        expect(decoded.isSigned).toBe(reference.isSigned);
        expect(decoded.values.length).toBe(reference.values.length);

        let mismatches = 0;
        let firstAt = -1;
        const mine = decoded.values;
        const theirs = reference.values;
        for (let i = 0; i < theirs.length; i++) {
          if (mine[i] !== theirs[i]) {
            if (firstAt === -1) firstAt = i;
            mismatches++;
          }
        }
        expect(
          mismatches,
          `${mismatches} of ${theirs.length} samples differ (first at ${firstAt}: ` +
            `got ${mine[firstAt]}, oracle ${theirs[firstAt]})`,
        ).toBe(0);
      });
    }
  },
);

describe.skipIf(j2kFixtures.length === 0)("end-to-end through the scale math", () => {
  for (const fixture of j2kFixtures) {
    it(`reproduces the ecCodes sha256 for ${fixture.name}`, () => {
      const expected = JSON.parse(
        readFileSync(`${fixturesDir}${fixture.name}.expect.json`, "utf8"),
      ) as { values: { sha256: string; count: number } };
      // The typed assignment is compile-time proof that decodeJ2k
      // satisfies DecodeJ2k unadapted.
      const decodeJ2kSeam: DecodeJ2k = decodeJ2k;
      const decoded = decodeFieldValues(fixtureField(fixture.name), {
        decodeJ2k: decodeJ2kSeam,
      });
      expect(decoded.values.length).toBe(expected.values.count);
      expect(sha256OfFloat64Le(decoded.values)).toBe(expected.values.sha256);
    });
  }

  it("carries the JasPer fixture through GRIB scaling and the bitmap", () => {
    const expected = JSON.parse(
      readFileSync(`${fixturesDir}rdps-cape-sfc-jasper.expect.json`, "utf8"),
    ) as { decodedField: { gridPoints: number; missingCount: number; sha256OfFloat64Le: string } };
    const decoded = decodeFieldValues(fixtureField("rdps-cape-sfc-jasper"), { decodeJ2k });
    expect(decoded.values.length).toBe(expected.decodedField.gridPoints);
    expect(decoded.missingCount).toBe(expected.decodedField.missingCount);
    expect(sha256OfFloat64Le(decoded.values)).toBe(expected.decodedField.sha256OfFloat64Le);
  });
});
