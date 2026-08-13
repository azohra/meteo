import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { J2kFormatError, UnsupportedJ2kError, parseCodestream } from "../src/index.js";
import { fixtureCodestream, fixturesDir } from "./helpers/fixtures.js";

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
    "\n[j2k] grib/test/fixtures is absent or has no grid_jpeg fixtures — " +
      "the codestream parse suite DID NOT RUN.\n",
  );
}

interface ExpectSidecar {
  gridMeta: { bitsPerValue: number; numberOfValues: number };
}

describe.skipIf(j2kFixtures.length === 0)("parseCodestream against the golden corpus", () => {
  it("covers the whole JPEG 2000 corpus, and grows with it", () => {
    expect(j2kFixtures.length).toBeGreaterThanOrEqual(12);
  });

  for (const fixture of j2kFixtures) {
    it(`agrees with ecCodes' metadata and the measured feed shape for ${fixture.name}`, () => {
      const expected = JSON.parse(
        readFileSync(`${fixturesDir}${fixture.name}.expect.json`, "utf8"),
      ) as ExpectSidecar;
      const header = parseCodestream(fixtureCodestream(fixture.name));
      expect(header.bitsPerSample).toBe(expected.gridMeta.bitsPerValue);
      expect(header.width * header.height).toBe(expected.gridMeta.numberOfValues);
      expect(header.isSigned).toBe(false);
      expect(header.decompositionLevels).toBe(5);
      expect(header.codeblockWidth).toBe(64);
      expect(header.codeblockHeight).toBe(64);
      expect(header.progressionOrder).toBe(0);
      expect(header.guardBits).toBe(2);
      expect(header.exponents).toHaveLength(16);
    });
  }
});

function markerOffset(cs: Uint8Array, marker: number): number {
  let p = 2;
  for (;;) {
    const m = cs[p]! * 0x100 + cs[p + 1]!;
    if (m === marker) return p;
    if (m === 0xff90 || p >= cs.length) throw new Error(`marker ${marker.toString(16)} not found`);
    p += 2 + cs[p + 2]! * 0x100 + cs[p + 3]!;
  }
}

function mutated(cs: Uint8Array, offset: number, value: number): Uint8Array {
  const copy = cs.slice();
  copy[offset] = value;
  return copy;
}

describe.skipIf(j2kFixtures.length === 0)("subset guards", () => {
  const cs = fixtureCodestream("geps-orog-m00");
  const siz = markerOffset(cs, 0xff51);
  const cod = markerOffset(cs, 0xff52);
  const qcd = markerOffset(cs, 0xff5c);
  const sot = markerOffset(cs, 0xff90);

  const rejects = (
    bytes: Uint8Array,
    kind: typeof UnsupportedJ2kError | typeof J2kFormatError,
    fragment: string,
  ): void => {
    let thrown: unknown;
    try {
      parseCodestream(bytes);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(kind);
    expect((thrown as Error).message).toContain(fragment);
  };

  it("refuses multiple components", () => {
    rejects(mutated(cs, siz + 39, 2), UnsupportedJ2kError, "components");
  });

  it("refuses multiple tiles when XTsiz halves to two tiles across", () => {
    const copy = cs.slice();
    copy[siz + 24] = 0x01;
    copy[siz + 25] = 0x68;
    rejects(copy, UnsupportedJ2kError, "tiles");
  });

  it("refuses deep samples beyond the int32 carrier", () => {
    rejects(mutated(cs, siz + 40, 28), UnsupportedJ2kError, "29-bit");
  });

  it("refuses component subsampling", () => {
    rejects(mutated(cs, siz + 41, 2), UnsupportedJ2kError, "subsampled");
  });

  it("refuses explicit precinct partitions", () => {
    rejects(mutated(cs, cod + 4, 0x01), UnsupportedJ2kError, "precinct");
  });

  it("refuses SOP/EPH marker use", () => {
    rejects(mutated(cs, cod + 4, 0x02), UnsupportedJ2kError, "SOP");
    rejects(mutated(cs, cod + 4, 0x04), UnsupportedJ2kError, "EPH");
  });

  it("refuses progression orders outside the code table", () => {
    rejects(mutated(cs, cod + 5, 5), J2kFormatError, "progression order");
  });

  it("refuses multiple quality layers", () => {
    rejects(mutated(cs, cod + 7, 2), UnsupportedJ2kError, "2 layers");
  });

  it("refuses a multiple component transformation", () => {
    rejects(mutated(cs, cod + 8, 1), UnsupportedJ2kError, "component transform");
  });

  it("refuses every non-default codeblock coding style, by name", () => {
    rejects(mutated(cs, cod + 12, 0x01), UnsupportedJ2kError, "bypass");
    rejects(mutated(cs, cod + 12, 0x08), UnsupportedJ2kError, "causal");
    rejects(mutated(cs, cod + 12, 0x20), UnsupportedJ2kError, "segmentation");
  });

  it("refuses the 9/7 irrational wavelet", () => {
    rejects(mutated(cs, cod + 13, 0), UnsupportedJ2kError, "9/7");
  });

  it("refuses quantization styles other than none", () => {
    rejects(mutated(cs, qcd + 4, 0x42), UnsupportedJ2kError, "quantization");
  });

  it("refuses ROI, per-component overrides, and packed headers", () => {
    const splice = (marker: number, body: number[]): Uint8Array => {
      const segment = [marker >> 8, marker & 0xff, 0, body.length + 2, ...body];
      const out = new Uint8Array(cs.length + segment.length);
      out.set(cs.subarray(0, cod), 0);
      out.set(segment, cod);
      out.set(cs.subarray(cod), cod + segment.length);
      return out;
    };
    rejects(splice(0xff5e, [0, 0, 0]), UnsupportedJ2kError, "RGN");
    rejects(splice(0xff53, [0, 0, 0]), UnsupportedJ2kError, "COC");
    rejects(splice(0xff5d, [0, 0]), UnsupportedJ2kError, "QCC");
    rejects(splice(0xff60, [0]), UnsupportedJ2kError, "PPM");
  });

  it("refuses multiple tile-parts", () => {
    rejects(mutated(cs, sot + 11, 2), UnsupportedJ2kError, "tile-part");
  });

  it("refuses a tile index other than zero", () => {
    rejects(mutated(cs, sot + 5, 1), J2kFormatError, "tile 1");
  });

  it("refuses bytes that are not a codestream", () => {
    rejects(new Uint8Array([0, 1, 2, 3]), J2kFormatError, "SOC");
    rejects(cs.subarray(0, 40), J2kFormatError, "");
  });
});
