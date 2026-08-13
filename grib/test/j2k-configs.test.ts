import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  decodeFieldValues,
  decodeFieldValuesAsync,
  parseFields,
  sampleFieldValuesAsync,
  splitMessages,
} from "../src/index.js";
import { createNodeJ2kDecoder, createNodeJ2kDecoderPool } from "../src/j2k-node.js";
import type { J2kDecoderPoolOptions } from "../src/j2k-node.js";

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
  console.error(
    "\n[j2k-configs] no JPEG 2000 fixtures found — the configuration matrix DID NOT RUN.\n",
  );
}

function sha256OfFloat64Le(values: Float64Array): string {
  const bytes = new Uint8Array(values.length * 8);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i++) view.setFloat64(i * 8, values[i]!, true);
  return createHash("sha256").update(bytes).digest("hex");
}

function firstField(name: string) {
  const bytes = new Uint8Array(readFileSync(join(fixturesDir, `${name}.grib2`)));
  return parseFields(splitMessages(bytes)[0]!)[0]!;
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

function sampleIndices(count: number): Uint32Array {
  const picks = new Set([0, 1, count >> 2, count >> 1, (3 * count) >> 2, count - 1]);
  for (let i = 0; i < count; i += Math.max(1, Math.floor(count / 97))) picks.add(i);
  return Uint32Array.from(picks);
}

const describeMatrix = j2kEntries.length > 0 ? describe : describe.skip;

const configurations: Array<{ label: string; options: J2kDecoderPoolOptions }> = [
  { label: 'codec "wasm" (the fallback), field fan-out', options: { codec: "wasm", size: 4 } },
  { label: 'codec "j2k", codeblock fan-out', options: { strategy: "codeblock", size: 4 } },
];

describeMatrix("every selectable pool configuration decodes the corpus bit-for-bit", () => {
  for (const { label, options } of configurations) {
    it(`${label}: full decode reproduces every ecCodes sha256`, async () => {
      const pool = await createNodeJ2kDecoderPool(options);
      try {
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
      } finally {
        await pool.close();
      }
    });

    it(`${label}: sampled decode equals the full decode at every index`, async () => {
      const pool = await createNodeJ2kDecoderPool(options);
      const decodeJ2k = await createNodeJ2kDecoder();
      try {
        for (const entry of j2kEntries) {
          const field = firstField(entry.name);
          const full = decodeFieldValues(field, { decodeJ2k });
          const indices = sampleIndices(full.values.length);
          const sampled = await sampleFieldValuesAsync(field, indices, {
            decodeJ2kSampled: pool.decodeSampled,
          });
          expect(sampled.missingMask, `${entry.name} mask`).toBeUndefined();
          for (let i = 0; i < indices.length; i++) {
            expect(sampled.values[i], `${entry.name}[${indices[i]}]`).toBe(
              full.values[indices[i]!],
            );
          }
        }
      } finally {
        await pool.close();
      }
    });
  }

  it("the sync decoder's wasm fallback reproduces every ecCodes sha256", async () => {
    const decodeJ2k = await createNodeJ2kDecoder({ codec: "wasm" });
    for (const entry of j2kEntries) {
      const decoded = decodeFieldValues(firstField(entry.name), { decodeJ2k });
      expect(sha256OfFloat64Le(decoded.values), `${entry.name} sha256`).toBe(
        expectedSha(entry.name),
      );
    }
  });

  it('refuses codec "wasm" with codeblock fan-out, loudly', async () => {
    await expect(
      createNodeJ2kDecoderPool({ codec: "wasm", strategy: "codeblock" }),
    ).rejects.toThrow(/codeblock.*requires codec "j2k"/);
  });

  it("codeblock fan-out leaves the caller's views intact and rejects garbage loudly", async () => {
    const pool = await createNodeJ2kDecoderPool({ strategy: "codeblock", size: 2 });
    try {
      const field = firstField(j2kEntries[0]!.name);
      const codestream = field.section7.subarray(5);
      const head = Array.from(codestream.subarray(0, 8));
      await pool.decode(codestream);
      expect(codestream.byteLength).toBeGreaterThan(0);
      expect(Array.from(codestream.subarray(0, 8))).toEqual(head);
      await expect(pool.decode(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/SOC marker/);
      const after = await decodeFieldValuesAsync(field, { decodeJ2k: pool.decode });
      expect(sha256OfFloat64Le(after.values)).toBe(expectedSha(j2kEntries[0]!.name));
    } finally {
      await pool.close();
    }
  });
});
