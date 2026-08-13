import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodeCodeblockTask, finishTile, placeCodeblock, planDecode } from "@azohra/meteo.j2k";
import { parseFields, sampleFieldValuesAsync, splitMessages } from "../dist/index.js";
import type { GribField } from "../dist/index.js";
import { createNodeJ2kDecoderPool } from "../dist/j2k-node.js";
import type { J2kDecoderPoolOptions } from "../dist/j2k-node.js";

const fixturesDir = fileURLToPath(new URL("../test/fixtures/", import.meta.url));
const manifest = JSON.parse(readFileSync(`${fixturesDir}manifest.json`, "utf8")) as {
  fixtures: Array<{ name: string; dataRepresentationTemplateNumber: number }>;
};
const names = manifest.fixtures
  .filter((f) => f.dataRepresentationTemplateNumber === 40)
  .map((f) => f.name);

const fields = new Map<string, GribField>(
  names.map((name) => [
    name,
    parseFields(splitMessages(new Uint8Array(readFileSync(`${fixturesDir}${name}.grib2`)))[0]!)[0]!,
  ]),
);

const SATURATION = Number(process.argv[2] ?? 48);
const ROUNDS = Number(process.argv[3] ?? 4);
const POOL_SIZE = 8;

function siteIndices(field: GribField): number[] {
  const gridPoints = new DataView(
    field.section3.buffer,
    field.section3.byteOffset,
    field.section3.byteLength,
  ).getUint32(6, false);
  const step = Math.max(1, Math.floor(gridPoints / 9));
  return Array.from({ length: 8 }, (_, i) => Math.min(gridPoints - 1, (i + 1) * step));
}

async function sampleOnce(
  pool: Awaited<ReturnType<typeof createNodeJ2kDecoderPool>>,
  field: GribField,
): Promise<void> {
  await sampleFieldValuesAsync(field, siteIndices(field), {
    decodeJ2kSampled: pool.decodeSampled,
  });
}

interface ConfigResult {
  label: string;
  corpusFps: number;
  hrdpsFps: number;
  gdpsFps: number;
  hrdpsLatencyMs: number;
  gdpsLatencyMs: number;
}

async function benchConfig(label: string, options: J2kDecoderPoolOptions): Promise<ConfigResult> {
  const pool = await createNodeJ2kDecoderPool({ size: POOL_SIZE, ...options });
  const hrdps = fields.get("hrdps-continental-tmp-2m")!;
  const gdps = fields.get("gdps-tmp-2m")!;

  await Promise.all([...fields.values()].map((field) => sampleOnce(pool, field)));

  const t0 = performance.now();
  const jobs: Promise<void>[] = [];
  for (let r = 0; r < ROUNDS; r++) {
    for (const field of fields.values()) jobs.push(sampleOnce(pool, field));
  }
  await Promise.all(jobs);
  const corpusFps = (ROUNDS * fields.size * 1000) / (performance.now() - t0);

  const saturate = async (field: GribField): Promise<number> => {
    const t = performance.now();
    await Promise.all(Array.from({ length: SATURATION }, () => sampleOnce(pool, field)));
    return (SATURATION * 1000) / (performance.now() - t);
  };
  const hrdpsFps = await saturate(hrdps);
  const gdpsFps = await saturate(gdps);

  const latency = async (field: GribField): Promise<number> => {
    let best = Infinity;
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      await sampleOnce(pool, field);
      best = Math.min(best, performance.now() - t);
    }
    return best;
  };
  const hrdpsLatencyMs = await latency(hrdps);
  const gdpsLatencyMs = await latency(gdps);

  await pool.close();
  return { label, corpusFps, hrdpsFps, gdpsFps, hrdpsLatencyMs, gdpsLatencyMs };
}

const configs: Array<[string, J2kDecoderPoolOptions]> = [
  ["a. wasm, field", { codec: "wasm" }],
  ["b. j2k, field", { codec: "j2k" }],
  ["c. j2k, codeblock", { codec: "j2k", strategy: "codeblock" }],
];

console.log(
  `pool ${POOL_SIZE} workers, sampled protocol, ${fields.size} fixtures, ` +
    `saturation ${SATURATION} fields, corpus rounds ${ROUNDS}\n`,
);

const results: ConfigResult[] = [];
for (const [label, options] of configs) {
  results.push(await benchConfig(label, options));
}

const HRDPS_FIELDS = 345;
const HRDPS_WIRE_S = 53;
const GDPS_FIELDS = 1045;
const GDPS_WIRE_S = 113;

console.log(
  "config".padEnd(20) +
    "corpus f/s".padStart(11) +
    "hrdps f/s".padStart(10) +
    "gdps f/s".padStart(10) +
    "hrdps lat".padStart(11) +
    "gdps lat".padStart(10),
);
for (const r of results) {
  console.log(
    r.label.padEnd(20) +
      r.corpusFps.toFixed(1).padStart(11) +
      r.hrdpsFps.toFixed(1).padStart(10) +
      r.gdpsFps.toFixed(1).padStart(10) +
      `${r.hrdpsLatencyMs.toFixed(0)} ms`.padStart(11) +
      `${r.gdpsLatencyMs.toFixed(0)} ms`.padStart(10),
  );
}

console.log(
  `\npool decode floors vs the wire (adoption gate: floor <= 70% of wire):` +
    `\n  hrdps-continental-4: ${HRDPS_FIELDS} fields, wire ~${HRDPS_WIRE_S} s` +
    `\n  gdps-12:             ${GDPS_FIELDS} fields, wire ~${GDPS_WIRE_S} s`,
);
for (const r of results) {
  const hrdpsFloor = HRDPS_FIELDS / r.hrdpsFps;
  const gdpsFloor = GDPS_FIELDS / r.gdpsFps;
  console.log(
    r.label.padEnd(20) +
      `hrdps ${hrdpsFloor.toFixed(1)} s (${((100 * hrdpsFloor) / HRDPS_WIRE_S).toFixed(0)}% of wire)`.padStart(
        28,
      ) +
      `gdps ${gdpsFloor.toFixed(1)} s (${((100 * gdpsFloor) / GDPS_WIRE_S).toFixed(0)}% of wire)`.padStart(
        28,
      ),
  );
}

console.log("\ncodeblock-strategy stage costs (main-thread, min of 5):");
for (const name of ["hrdps-continental-tmp-2m", "gdps-tmp-2m"]) {
  const codestream = fields.get(name)!.section7.subarray(5);
  const plan = planDecode(codestream);
  const tile = new Int32Array(plan.header.width * plan.header.height);
  for (const task of plan.tasks) {
    placeCodeblock(
      tile,
      plan.header.width,
      task,
      decodeCodeblockTask(
        codestream.subarray(task.byteOffset, task.byteOffset + task.byteLength),
        task,
      ),
    );
  }
  const timed = (work: () => void): number => {
    let best = Infinity;
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      work();
      best = Math.min(best, performance.now() - t);
    }
    return best;
  };
  const planMs = timed(() => void planDecode(codestream));
  const finishMs = timed(() => {
    const scratch = tile.slice();
    finishTile(scratch, plan.resolutions, plan.header.bitsPerSample, plan.header.isSigned);
  });
  console.log(
    `  ${name.padEnd(26)} planDecode ${planMs.toFixed(1)} ms   ` +
      `finishTile ${finishMs.toFixed(1)} ms (${plan.tasks.length} codeblocks)`,
  );
}
