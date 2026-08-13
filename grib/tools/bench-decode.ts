import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodeFieldValues, parseFields, splitMessages } from "../dist/index.js";
import { createNodeJ2kDecoder } from "../dist/j2k-node.js";

const fixturesDir = fileURLToPath(new URL("../test/fixtures/", import.meta.url));
const manifest = JSON.parse(readFileSync(`${fixturesDir}manifest.json`, "utf8")) as {
  fixtures: Array<{ name: string; dataRepresentationTemplateNumber: number }>;
};
const j2kFixtures = manifest.fixtures.filter((f) => f.dataRepresentationTemplateNumber === 40);
const repeats = Number(process.argv[2] ?? 3);

const decodeJ2k = await createNodeJ2kDecoder();

for (const fixture of j2kFixtures) {
  const bytes = new Uint8Array(readFileSync(`${fixturesDir}${fixture.name}.grib2`));
  const fields = parseFields(splitMessages(bytes)[0]!);
  const field = fields[0]!;
  const codestream = field.section7.subarray(5);
  const bits = (codestream[42]! & 0x7f) + 1;
  const d = decodeFieldValues(field, { decodeJ2k });
  const times: number[] = [];
  const j2kTimes: number[] = [];
  for (let r = 0; r < repeats; r++) {
    let t0 = performance.now();
    decodeJ2k(codestream);
    j2kTimes.push(performance.now() - t0);
    t0 = performance.now();
    decodeFieldValues(field, { decodeJ2k });
    times.push(performance.now() - t0);
  }
  const med = (a: number[]) => a.sort((x, y) => x - y)[a.length >> 1]!;
  console.log(
    `${fixture.name.padEnd(28)} ${String(d.values.length).padStart(8)} pts ${String(bits).padStart(2)}-bit  ` +
      `j2k ${med(j2kTimes).toFixed(1).padStart(8)} ms  full ${med(times).toFixed(1).padStart(8)} ms`,
  );
}
