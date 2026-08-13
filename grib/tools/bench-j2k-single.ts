import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodeJ2k } from "@azohra/meteo.j2k";
import { parseFields, splitMessages } from "../dist/index.js";
import { createNodeJ2kDecoder } from "../dist/j2k-node.js";

const fixturesDir = fileURLToPath(new URL("../test/fixtures/", import.meta.url));
const manifest = JSON.parse(readFileSync(`${fixturesDir}manifest.json`, "utf8")) as {
  fixtures: Array<{ name: string; packingType: string }>;
};
const names = manifest.fixtures.filter((f) => f.packingType === "grid_jpeg").map((f) => f.name);
const repeats = Number(process.argv[2] ?? 5);

const oracle = await createNodeJ2kDecoder({ codec: "wasm" });

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

console.log(
  "fixture".padEnd(26) +
    "samples".padStart(9) +
    "bits".padStart(6) +
    "j2k ms".padStart(9) +
    "oracle ms".padStart(11) +
    "  ratio",
);
let mineTotal = 0;
let oracleTotal = 0;
for (const name of names) {
  const bytes = new Uint8Array(readFileSync(`${fixturesDir}${name}.grib2`));
  const field = parseFields(splitMessages(bytes)[0]!)[0]!;
  const codestream = field.section7.subarray(5);
  const probe = decodeJ2k(codestream);
  const mine = timed(() => void decodeJ2k(codestream));
  const theirs = timed(() => void oracle(codestream));
  mineTotal += mine;
  oracleTotal += theirs;
  console.log(
    name.padEnd(26) +
      String(probe.values.length).padStart(9) +
      String(probe.bitsPerSample).padStart(6) +
      mine.toFixed(1).padStart(9) +
      theirs.toFixed(1).padStart(11) +
      `  ${(mine / theirs).toFixed(2)}x` +
      (probe.bitsPerSample > 16 ? "  (oracle = @azohra/meteo.j2k)" : ""),
  );
}
console.log(
  "total".padEnd(26) +
    "".padStart(15) +
    mineTotal.toFixed(1).padStart(9) +
    oracleTotal.toFixed(1).padStart(11) +
    `  ${(mineTotal / oracleTotal).toFixed(2)}x`,
);
