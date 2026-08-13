/**
 * Region decode (src/region.ts): proves, over every distinct codestream
 * flavor in the oracle corpus, that decoding only the codeblocks the
 * requested points touch reproduces the full decoder's values at those
 * points bit for bit — the exactness contract decodeJ2kRegion documents.
 * Timing lives behind J2K_REGION_BENCH so the suite stays fast.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeJ2k, decodeJ2kRegion, decodeRegionFromPlan, planDecode } from "../src/index.js";
import { fixtureCodestream, fixturesDir } from "./helpers/fixtures.js";

const manifest: { fixtures: Array<{ name: string; packingType: string }> } = existsSync(
  `${fixturesDir}manifest.json`,
)
  ? (JSON.parse(readFileSync(`${fixturesDir}manifest.json`, "utf8")) as {
      fixtures: Array<{ name: string; packingType: string }>;
    })
  : { fixtures: [] };

const fixtureNames = manifest.fixtures
  .filter((f) => f.packingType === "grid_jpeg")
  .map((f) => f.name);
// The JasPer-shaped oracle (24-bit, one-row, multi-precinct) is not in the
// manifest; include it whenever its file is present.
if (existsSync(`${fixturesDir}rdps-cape-sfc-jasper.grib2`)) {
  fixtureNames.push("rdps-cape-sfc-jasper");
}

if (fixtureNames.length === 0) {
  console.error(
    "\n[j2k] grib/test/fixtures is absent or has no grid_jpeg fixtures — " +
      "the region-decode suite DID NOT RUN.\n",
  );
}

/** Deterministic PRNG so failures reproduce. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function scatter(width: number, height: number, count: number, seed: number): number[] {
  const rand = mulberry32(seed);
  const indices = new Set<number>();
  while (indices.size < count) {
    indices.add(Math.floor(rand() * height) * width + Math.floor(rand() * width));
  }
  return [...indices];
}

function expectExact(name: string, full: Int32Array, region: Int32Array, indices: number[]): void {
  expect(region.length).toBe(indices.length);
  let mismatches = 0;
  let first = "";
  for (let i = 0; i < indices.length; i++) {
    if (region[i] !== full[indices[i]!]) {
      if (mismatches === 0) {
        first = `first at index ${indices[i]}: region ${region[i]} != full ${full[indices[i]!]}`;
      }
      mismatches++;
    }
  }
  expect(mismatches, `${name}: mismatched samples (${first})`).toBe(0);
}

describe.skipIf(fixtureNames.length === 0)("region decode equals full decode, bit for bit", () => {
  for (const name of fixtureNames) {
    it(`${name}: corners, center, 4-site and 16-point scatters`, () => {
      const codestream = fixtureCodestream(name);
      const full = decodeJ2k(codestream);
      const { width, height } = full;
      const last = width * height - 1;
      const pointSets: Array<[string, number[]]> = [
        [
          "corners+center",
          [
            0,
            width - 1,
            (height - 1) * width,
            last,
            Math.floor(height / 2) * width + Math.floor(width / 2),
          ],
        ],
        ["4 sites", scatter(width, height, 4, 0xc0ffee)],
        ["16 points", scatter(width, height, 16, 0xbada55)],
      ];
      for (const [label, indices] of pointSets) {
        const region = decodeJ2kRegion(codestream, indices);
        expectExact(`${name} ${label}`, full.values, region.values, indices);
        expect(region.width).toBe(width);
        expect(region.height).toBe(height);
        expect(region.bitsPerSample).toBe(full.bitsPerSample);
        expect(region.isSigned).toBe(full.isSigned);
        expect(region.codeblocksDecoded).toBeGreaterThan(0);
        expect(region.codeblocksDecoded).toBeLessThanOrEqual(region.codeblocksTotal);
      }
    });

    it(`${name}: adjacent clusters share windows and stay exact`, () => {
      // Contiguous blocks and near-neighbors exercise the window-merge
      // path (nearby points collapse into one lift node); border-hugging
      // clusters exercise merged windows against the boundary clamp.
      const codestream = fixtureCodestream(name);
      const full = decodeJ2k(codestream);
      const { width, height } = full;
      const cx = Math.floor(width / 2);
      const cy = Math.floor(height / 2);
      const indices = new Set<number>();
      // A 3x3 block in the interior, and one hugging each corner.
      for (const [bx, by] of [
        [cx, cy],
        [0, 0],
        [width - 3, 0],
        [0, height - 3],
        [width - 3, height - 3],
      ] as const) {
        for (let dy = 0; dy < Math.min(3, height); dy++) {
          for (let dx = 0; dx < Math.min(3, width); dx++) {
            indices.add((Math.max(0, by) + dy) * width + Math.max(0, bx) + dx);
          }
        }
      }
      // A near-pair straddling the merge distance.
      if (cx + 7 < width) {
        indices.add(cy * width + cx + 7);
      }
      const points = [...indices];
      const region = decodeJ2kRegion(codestream, points);
      expectExact(`${name} clusters`, full.values, region.values, points);
    });
  }

  it("geps-orog-m00: every border point and a 5000-point interior scatter", () => {
    const codestream = fixtureCodestream("geps-orog-m00");
    const full = decodeJ2k(codestream);
    const { width, height } = full;
    const border = new Set<number>();
    for (let x = 0; x < width; x++) {
      border.add(x);
      border.add((height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
      border.add(y * width);
      border.add(y * width + width - 1);
    }
    const indices = [...border, ...scatter(width, height, 5000, 0x5eed)];
    const plan = planDecode(codestream);
    const region = decodeRegionFromPlan(codestream, plan, indices);
    expectExact("geps-orog-m00 sweep", full.values, region.values, indices);
  });

  it("hrdps-continental: a 4-site sample touches a small fraction of the codeblocks", () => {
    const codestream = fixtureCodestream("hrdps-continental-tmp-2m");
    const full = decodeJ2k(codestream);
    const indices = scatter(full.width, full.height, 4, 0xc0ffee);
    const region = decodeJ2kRegion(codestream, indices);
    expectExact("hrdps 4 sites", full.values, region.values, indices);
    // 4 scattered points against 911 codeblocks: the whole thesis is that
    // this stays a sliver. Generous ceiling; the measured value is far lower.
    expect(region.codeblocksDecoded / region.codeblocksTotal).toBeLessThan(0.15);
  });

  it("duplicate and repeated indexes answer per-request, in request order", () => {
    const codestream = fixtureCodestream(fixtureNames[0]!);
    const full = decodeJ2k(codestream);
    const middle = Math.floor(full.height / 2) * full.width + Math.floor(full.width / 2);
    const indices = [middle, 0, middle, middle, 0];
    const region = decodeJ2kRegion(codestream, indices);
    expectExact("duplicates", full.values, region.values, indices);
  });

  it("an empty index list decodes nothing", () => {
    const codestream = fixtureCodestream(fixtureNames[0]!);
    const region = decodeJ2kRegion(codestream, []);
    expect(region.values.length).toBe(0);
    expect(region.codeblocksDecoded).toBe(0);
    expect(region.codeblocksTotal).toBeGreaterThan(0);
  });

  it("rejects out-of-image and non-integer indexes loudly", () => {
    const codestream = fixtureCodestream(fixtureNames[0]!);
    const { width, height } = decodeJ2k(codestream);
    expect(() => decodeJ2kRegion(codestream, [width * height])).toThrow(RangeError);
    expect(() => decodeJ2kRegion(codestream, [-1])).toThrow(RangeError);
    expect(() => decodeJ2kRegion(codestream, [1.5])).toThrow(RangeError);
  });

  it.runIf(process.env.J2K_REGION_BENCH)("bench: full vs region, single thread", () => {
    const repeats = 5;
    const timed = (work: () => void): number => {
      work();
      let best = Infinity;
      for (let i = 0; i < repeats; i++) {
        const t0 = performance.now();
        work();
        best = Math.min(best, performance.now() - t0);
      }
      return best;
    };
    for (const name of fixtureNames) {
      const codestream = fixtureCodestream(name);
      const probe = decodeJ2k(codestream);
      const indices = scatter(probe.width, probe.height, 4, 0xc0ffee);
      const stats = decodeJ2kRegion(codestream, indices);
      const fullMs = timed(() => void decodeJ2k(codestream));
      const planMs = timed(() => void planDecode(codestream));
      const regionMs = timed(() => void decodeJ2kRegion(codestream, indices));
      console.log(
        `${name.padEnd(26)} full ${fullMs.toFixed(1).padStart(7)} ms | ` +
          `region(4pt) ${regionMs.toFixed(2).padStart(8)} ms | ` +
          `plan ${planMs.toFixed(2).padStart(7)} ms | ` +
          `${fullMs / regionMs < 100 ? " " : ""}${(fullMs / regionMs).toFixed(1)}x | ` +
          `codeblocks ${stats.codeblocksDecoded}/${stats.codeblocksTotal}`,
      );
    }
  });
});
