import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { availableParallelism } from "node:os";
import {
  decodeFieldValues,
  decodeFieldValuesAsync,
  parseFields,
  splitMessages,
} from "../dist/index.js";
import { createNodeJ2kDecoder, createNodeJ2kDecoderPool } from "../dist/j2k-node.js";

const fixturesDir = fileURLToPath(new URL("../test/fixtures/", import.meta.url));
const manifest = JSON.parse(readFileSync(`${fixturesDir}manifest.json`, "utf8")) as {
  fixtures: Array<{ name: string; dataRepresentationTemplateNumber: number }>;
};
const names = manifest.fixtures
  .filter((f) => f.dataRepresentationTemplateNumber === 40)
  .map((f) => f.name);
const fields = names.map(
  (name) =>
    parseFields(splitMessages(new Uint8Array(readFileSync(`${fixturesDir}${name}.grib2`)))[0]!)[0]!,
);

const mb = (bytes: number) => (bytes / 1048576).toFixed(0);
const rss0 = process.memoryUsage().rss;
console.log(`cores: ${availableParallelism()}, rss before pool: ${mb(rss0)} MB`);

const size = Number(process.argv[2] ?? 0) || undefined;
const pool = await createNodeJ2kDecoderPool(size ? { size } : {});
const rssBoot = process.memoryUsage().rss;
console.log(`pool size ${pool.size}, rss after boot: ${mb(rssBoot)} MB (+${mb(rssBoot - rss0)})`);

const decodeJ2k = await createNodeJ2kDecoder();
decodeFieldValues(fields[0]!, { decodeJ2k });
await Promise.all(fields.map((f) => decodeFieldValuesAsync(f, { decodeJ2k: pool.decode })));

{
  const t0 = performance.now();
  const ROUNDS = 3;
  for (let r = 0; r < ROUNDS; r++) {
    for (const field of fields) decodeFieldValues(field, { decodeJ2k });
  }
  const dt = performance.now() - t0;
  const perField = dt / (ROUNDS * fields.length);
  console.log(
    `sequential: ${fields.length}x${ROUNDS} fields in ${dt.toFixed(0)} ms ` +
      `(${perField.toFixed(1)} ms/field avg, ${((ROUNDS * fields.length * 1000) / dt).toFixed(2)} fields/s)`,
  );
}

{
  const ROUNDS = 6;
  const t0 = performance.now();
  const jobs: Promise<unknown>[] = [];
  for (let r = 0; r < ROUNDS; r++) {
    for (const field of fields)
      jobs.push(decodeFieldValuesAsync(field, { decodeJ2k: pool.decode }));
  }
  await Promise.all(jobs);
  const dt = performance.now() - t0;
  console.log(
    `pooled(${pool.size}): ${fields.length}x${ROUNDS} fields in ${dt.toFixed(0)} ms ` +
      `(${((ROUNDS * fields.length * 1000) / dt).toFixed(2)} fields/s)`,
  );
}

{
  const hrdps = fields[names.indexOf("hrdps-continental-tmp-2m")]!;
  const N = pool.size * 6;
  const t0 = performance.now();
  let sink = 0;
  for (let done = 0; done < N; done += pool.size) {
    const round = Math.min(pool.size, N - done);
    const decoded = await Promise.all(
      Array.from({ length: round }, () =>
        decodeFieldValuesAsync(hrdps, { decodeJ2k: pool.decode }),
      ),
    );
    for (const result of decoded) sink += result.values[123456]!;
  }
  const dt = performance.now() - t0;
  if (!Number.isFinite(sink)) throw new Error("unreachable");
  const fps = (N * 1000) / dt;
  console.log(
    `pooled(${pool.size}) hrdps-continental: ${N} fields in ${dt.toFixed(0)} ms ` +
      `(${fps.toFixed(2)} fields/s, ${(dt / N).toFixed(1)} ms/field effective)`,
  );
  console.log(`projected 4100-field HRDPS build decode: ${(4100 / fps / 60).toFixed(1)} min`);
  const rssLoad = process.memoryUsage().rss;
  console.log(
    `rss after workload: ${mb(rssLoad)} MB (+${mb(rssLoad - rssBoot)} over boot; ` +
      `~${mb((rssLoad - rss0) / pool.size)} MB/worker incl. main-thread share)`,
  );
}

await pool.close();
