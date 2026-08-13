import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodeJ2k } from "@azohra/meteo.j2k";

const fixturesDir = fileURLToPath(new URL("../../grib/test/fixtures/", import.meta.url));
const manifest = JSON.parse(readFileSync(`${fixturesDir}manifest.json`, "utf8")) as {
  fixtures: Array<{ name: string; packingType: string }>;
};
const names = manifest.fixtures.filter((f) => f.packingType === "grid_jpeg").map((f) => f.name);
const repeats = Number(process.argv[2] ?? 5);

const SECTION0_LENGTH = 16;
const SECTION_HEADER_LENGTH = 5;

function firstJ2kCodestream(message: Uint8Array): Uint8Array {
  let offset = SECTION0_LENGTH;
  while (offset + SECTION_HEADER_LENGTH <= message.length) {
    const length =
      message[offset]! * 0x1000000 +
      ((message[offset + 1]! << 16) | (message[offset + 2]! << 8) | message[offset + 3]!);
    if (message[offset + 4] === 7) {
      return message.subarray(offset + SECTION_HEADER_LENGTH, offset + length);
    }
    offset += length;
  }
  throw new Error("no section 7 in the message");
}

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

console.log("fixture".padEnd(26) + "samples".padStart(9) + "bits".padStart(6) + "ms".padStart(9));
let total = 0;
for (const name of names) {
  const codestream = firstJ2kCodestream(
    new Uint8Array(readFileSync(`${fixturesDir}${name}.grib2`)),
  );
  const probe = decodeJ2k(codestream);
  const ms = timed(() => void decodeJ2k(codestream));
  total += ms;
  console.log(
    name.padEnd(26) +
      String(probe.values.length).padStart(9) +
      String(probe.bitsPerSample).padStart(6) +
      ms.toFixed(1).padStart(9),
  );
}
console.log("total".padEnd(26) + "".padStart(15) + total.toFixed(1).padStart(9));
