/**
 * The production-shape throughput gate: the forecast engine's hot path is
 * a *sampled* decode — a handful of site gridpoints out of a multi-
 * megapoint JPEG 2000 field — and with the default codec that path is
 * region decode: only the codeblocks the points touch entropy-decode.
 *
 * The gate holds two things, per worker (pool of 1, so both paths run on
 * the same single core through the same production call path —
 * sampleFieldValuesAsync / decodeFieldValuesAsync over the worker pool):
 *
 * 1. Speed: a 4-point sampled decode of the largest ECCC field must be at
 *    least MIN_SPEEDUP times faster than the full decode. Measured ~15x on
 *    Apple Silicon; the floor is deliberately far below that so slower CI
 *    machines gate the mechanism, not the hardware.
 * 2. Exactness: the sampled values must equal the full decode's values at
 *    those points bit for bit — the permanent tie into the ecCodes oracle
 *    chain (full decode is gated against ecCodes; sampled must equal full).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  decodeFieldValuesAsync,
  parseFields,
  sampleFieldValuesAsync,
  splitMessages,
} from "../src/index.js";
import { createNodeJ2kDecoderPool } from "../src/j2k-node.js";

const FIXTURE = "hrdps-continental-tmp-2m";
const MIN_SPEEDUP = 6;
const SITES = 4;

const fixturesDir = fileURLToPath(new URL("./fixtures/", import.meta.url));
const fixturePath = join(fixturesDir, `${FIXTURE}.grib2`);
if (!existsSync(fixturePath)) {
  console.error(
    `\n[production-codec-throughput] ${FIXTURE}.grib2 is absent — the production-shape gate DID NOT RUN.\n`,
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

function scatter(width: number, height: number, count: number, seed: number): Uint32Array {
  const rand = mulberry32(seed);
  const indices = new Set<number>();
  while (indices.size < count) {
    indices.add(Math.floor(rand() * height) * width + Math.floor(rand() * width));
  }
  return Uint32Array.from(indices);
}

async function best(times: number, work: () => Promise<unknown>): Promise<number> {
  let bestMs = Infinity;
  for (let i = 0; i < times; i++) {
    const t0 = performance.now();
    await work();
    bestMs = Math.min(bestMs, performance.now() - t0);
  }
  return bestMs;
}

describe.skipIf(!existsSync(fixturePath))(
  "the production shape: sampled decode is region decode",
  () => {
    it(
      `default codec, pool of 1: a ${SITES}-point sampled decode is >= ${MIN_SPEEDUP}x faster ` +
        "than the full decode on the same core, and bit-exact against it",
      async () => {
        const bytes = new Uint8Array(readFileSync(fixturePath));
        const field = parseFields(splitMessages(bytes)[0]!)[0]!;
        const pool = await createNodeJ2kDecoderPool({ size: 1 });
        try {
          // 2540x1290 rotated grid; deterministic scattered "sites".
          const grid = { ni: 2540, nj: 1290 };
          const indices = scatter(grid.ni, grid.nj, SITES, 0xc0ffee);

          const full = await decodeFieldValuesAsync(field, { decodeJ2k: pool.decode });
          const sampled = await sampleFieldValuesAsync(field, indices, {
            decodeJ2kSampled: pool.decodeSampled,
          });

          // The permanent oracle tie: sampled === full at every point. The
          // full decode is itself gated bit-for-bit against ecCodes
          // (j2k-golden.test.ts), so equality here chains the region path
          // into the same oracle. One mismatch is a decoder bug, never
          // tolerance.
          expect(sampled.missingMask).toBeUndefined();
          for (let i = 0; i < indices.length; i++) {
            expect(sampled.values[i], `sampled[${indices[i]}]`).toBe(full.values[indices[i]!]);
          }

          // The speed gate: same worker, same core, production call path.
          const fullMs = await best(2, () =>
            decodeFieldValuesAsync(field, { decodeJ2k: pool.decode }),
          );
          const sampledMs = await best(5, () =>
            sampleFieldValuesAsync(field, indices, { decodeJ2kSampled: pool.decodeSampled }),
          );
          const speedup = fullMs / sampledMs;
          console.log(
            `[production-codec-throughput] ${FIXTURE}: full ${fullMs.toFixed(1)} ms, ` +
              `sampled(${SITES} pts) ${sampledMs.toFixed(2)} ms — ${speedup.toFixed(1)}x ` +
              `(gate: >= ${MIN_SPEEDUP}x)`,
          );
          expect(
            speedup,
            `sampled decode (${sampledMs.toFixed(1)} ms) must be >= ${MIN_SPEEDUP}x faster than ` +
              `full decode (${fullMs.toFixed(1)} ms) — the region path is the production shape`,
          ).toBeGreaterThanOrEqual(MIN_SPEEDUP);
        } finally {
          await pool.close();
        }
      },
      120_000,
    );
  },
);
