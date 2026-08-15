import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  decodeFieldValues,
  decodeFieldValuesAsync,
  parseFields,
  sampleFieldValuesAsync,
  splitMessages,
} from "../src/index.js";
import { createNodeJ2kDecoder, createNodeJ2kDecoderPool } from "../src/j2k-node.js";
import type { J2kDecoderPool } from "../src/j2k-node.js";

interface ManifestEntry {
  name: string;
  dataRepresentationTemplateNumber: number;
}

const fixturesDir = fileURLToPath(new URL("./fixtures/", import.meta.url));
const manifestPath = join(fixturesDir, "manifest.json");
const manifest: { fixtures: ManifestEntry[] } = existsSync(manifestPath)
  ? (JSON.parse(readFileSync(manifestPath, "utf8")) as { fixtures: ManifestEntry[] })
  : { fixtures: [] };

const j2kEntries = manifest.fixtures.filter((f) => f.dataRepresentationTemplateNumber === 40);
if (j2kEntries.length === 0) {
  console.error("\n[j2k-pool] no JPEG 2000 fixtures found — the pool parity suite DID NOT RUN.\n");
}

function sha256OfFloat64Le(values: Float64Array): string {
  const bytes = new Uint8Array(values.length * 8);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i++) view.setFloat64(i * 8, values[i]!, true);
  return createHash("sha256").update(bytes).digest("hex");
}

function firstField(name: string) {
  const bytes = new Uint8Array(readFileSync(join(fixturesDir, `${name}.grib2`)));
  const fields = parseFields(splitMessages(bytes)[0]!);
  return fields[0]!;
}

function expectedSha(name: string): string {
  const expectation = JSON.parse(
    readFileSync(join(fixturesDir, `${name}.expect.json`), "utf8"),
  ) as {
    multiField: boolean;
    values?: { sha256: string };
    fields?: Array<{ values: { sha256: string } }>;
  };
  return expectation.multiField
    ? expectation.fields![0]!.values.sha256
    : expectation.values!.sha256;
}

const describePool = j2kEntries.length > 0 ? describe : describe.skip;

describePool("J2K worker pool", () => {
  let pool: J2kDecoderPool;

  beforeAll(async () => {
    pool = await createNodeJ2kDecoderPool({ size: 4 });
  });
  afterAll(async () => {
    await pool.close();
  });

  it("decodes every JPEG 2000 golden fixture bit-for-bit, all in flight at once (more jobs than workers)", async () => {
    const decoded = await Promise.all(
      j2kEntries.map((entry) =>
        decodeFieldValuesAsync(firstField(entry.name), { decodeJ2k: pool.decode }),
      ),
    );
    decoded.forEach((result, index) => {
      const entry = j2kEntries[index]!;
      expect(sha256OfFloat64Le(result.values), `${entry.name} sha256`).toBe(
        expectedSha(entry.name),
      );
    });
  });

  it("matches the sync decoder exactly (raqdps 20-bit deep path included)", async () => {
    const decodeJ2k = await createNodeJ2kDecoder();
    for (const name of ["hrdps-west-tmp-2m", "raqdps-pm25-sfc"]) {
      const field = firstField(name);
      const sync = decodeFieldValues(field, { decodeJ2k });
      const pooled = await decodeFieldValuesAsync(field, { decodeJ2k: pool.decode });
      expect(pooled.values, `${name} pooled vs sync`).toEqual(sync.values);
      expect(pooled.missingCount).toBe(sync.missingCount);
    }
  });

  it("decodes non-JPEG-2000 templates without a decoder, same as sync", async () => {
    const complex = manifest.fixtures.find((f) => f.dataRepresentationTemplateNumber !== 40);
    expect(complex).toBeDefined();
    const field = firstField(complex!.name);
    const sync = decodeFieldValues(field);
    const viaAsync = await decodeFieldValuesAsync(field);
    expect(viaAsync.values).toEqual(sync.values);
  });

  it("leaves the caller's codestream view intact (transfer copies)", async () => {
    const field = firstField(j2kEntries[0]!.name);
    const codestream = field.section7.subarray(5);
    const head = Array.from(codestream.subarray(0, 8));
    await pool.decode(codestream);
    expect(codestream.byteLength).toBeGreaterThan(0);
    expect(Array.from(codestream.subarray(0, 8))).toEqual(head);
  });

  it("rejects a broken codestream loudly and keeps decoding afterwards", async () => {
    await expect(pool.decode(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/SOC marker/);
    const entry = j2kEntries[0]!;
    const after = await decodeFieldValuesAsync(firstField(entry.name), {
      decodeJ2k: pool.decode,
    });
    expect(sha256OfFloat64Le(after.values)).toBe(expectedSha(entry.name));
  });

  it("refuses work after close, and close is idempotent", async () => {
    const small = await createNodeJ2kDecoderPool({ size: 1 });
    await small.close();
    await expect(small.decode(new Uint8Array([0xff, 0x4f]))).rejects.toThrow(/closed/);
    await small.close();
  });

  it("samples every JPEG 2000 fixture bit-for-bit via the worker fast path — no decodeJ2k is wired, so a fallback would throw", async () => {
    const decodeJ2k = await createNodeJ2kDecoder();
    for (const entry of j2kEntries) {
      const field = firstField(entry.name);
      const full = decodeFieldValues(field, { decodeJ2k });
      const count = full.values.length;
      const picks = new Set([0, 1, count >> 2, count >> 1, (3 * count) >> 2, count - 1]);
      for (let i = 0; i < count; i += Math.max(1, Math.floor(count / 97))) picks.add(i);
      const indices = Uint32Array.from(picks);
      const sampled = await sampleFieldValuesAsync(field, indices, {
        decodeJ2kSampled: pool.decodeSampled,
      });
      expect(sampled.missingMask, `${entry.name} mask`).toBeUndefined();
      for (let i = 0; i < indices.length; i++) {
        expect(sampled.values[i], `${entry.name}[${indices[i]}]`).toBe(full.values[indices[i]!]);
      }
    }
  });

  it("the full-decode fallback gathers identically (every fixture, bitmaps included)", async () => {
    const decodeJ2k = await createNodeJ2kDecoder();
    for (const entry of manifest.fixtures) {
      const field = firstField(entry.name);
      const full = decodeFieldValues(field, { decodeJ2k });
      const count = full.values.length;
      const indices: number[] = [];
      for (let i = 0; i < count; i += Math.max(1, Math.floor(count / 53))) indices.push(i);
      const sampled = await sampleFieldValuesAsync(field, indices, { decodeJ2k });
      for (let i = 0; i < indices.length; i++) {
        expect(sampled.values[i], `${entry.name}[${indices[i]}]`).toBe(full.values[indices[i]!]);
        const expectMasked = full.missingMask !== undefined && full.missingMask[indices[i]!] === 1;
        expect(sampled.missingMask?.[i] === 1, `${entry.name} mask[${indices[i]}]`).toBe(
          expectMasked,
        );
      }
    }
  });

  it("a bitmap-masked point surfaces through the sampled mask", async () => {
    const field = firstField("nam-nest-tmp-bitmap");
    const full = decodeFieldValues(field);
    expect(full.missingMask).toBeDefined();
    const maskedIndex = full.missingMask!.indexOf(1);
    const codedIndex = full.missingMask!.indexOf(0);
    expect(maskedIndex).toBeGreaterThanOrEqual(0);
    const sampled = await sampleFieldValuesAsync(field, [maskedIndex, codedIndex], {});
    expect(sampled.missingMask).toEqual(new Uint8Array([1, 0]));
    expect(sampled.values[0]).toBe(full.missingValue);
    expect(sampled.values[1]).toBe(full.values[codedIndex]);
  });

  it("rejects out-of-grid sample indexes loudly", async () => {
    const field = firstField(j2kEntries[0]!.name);
    await expect(
      sampleFieldValuesAsync(field, [4_000_000_000], { decodeJ2kSampled: pool.decodeSampled }),
    ).rejects.toThrow(/outside the .*-point grid/);
  });

  it("leaves the caller's codestream and index views intact (transfer copies)", async () => {
    const field = firstField(j2kEntries[0]!.name);
    const codestream = field.section7.subarray(5);
    const head = Array.from(codestream.subarray(0, 8));
    const indices = Uint32Array.from([0, 5, 9]);
    await sampleFieldValuesAsync(field, indices, { decodeJ2kSampled: pool.decodeSampled });
    expect(codestream.byteLength).toBeGreaterThan(0);
    expect(Array.from(codestream.subarray(0, 8))).toEqual(head);
    expect(Array.from(indices)).toEqual([0, 5, 9]);
  });
});

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const distEntry = join(packageRoot, "dist", "j2k-node.js");
const itWithDist = existsSync(distEntry) ? it : it.skip;

// Workers inherit the host's execArgv, and Node rejects --input-type for
// file-entry workers, so a host started via `node --input-type=module -e`
// (the doc-fence runner's shape) must still be able to spawn the pool.
itWithDist("boots from a host started via node --input-type=module -e", () => {
  const script = [
    'const { createNodeJ2kDecoderPool } = await import("./dist/j2k-node.js");',
    "const pool = await createNodeJ2kDecoderPool({ size: 1 });",
    "await pool.close();",
    'console.log("pool booted");',
  ].join("\n");
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: packageRoot,
    encoding: "utf-8",
    timeout: 60_000,
  });
  expect(child.stderr, "child stderr").not.toMatch(/ERR_INPUT_TYPE_NOT_ALLOWED/);
  expect(child.status, child.stderr).toBe(0);
  expect(child.stdout.trim()).toBe("pool booted");
});
