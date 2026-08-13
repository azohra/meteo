import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeCodeblockTask,
  decodeJ2k,
  finishTile,
  placeCodeblock,
  planDecode,
} from "../src/index.js";
import { fixtureCodestream, fixturesDir } from "./helpers/fixtures.js";

const manifest: { fixtures: Array<{ name: string; packingType: string }> } = existsSync(
  `${fixturesDir}manifest.json`,
)
  ? (JSON.parse(readFileSync(`${fixturesDir}manifest.json`, "utf8")) as {
      fixtures: Array<{ name: string; packingType: string }>;
    })
  : { fixtures: [] };

const j2kFixtures = manifest.fixtures.filter((f) => f.packingType === "grid_jpeg");

if (j2kFixtures.length === 0) {
  console.error(
    "\n[j2k] grib/test/fixtures is absent or has no grid_jpeg fixtures — " +
      "the parallel-plan suite DID NOT RUN.\n",
  );
}

describe.skipIf(j2kFixtures.length === 0)("the parallel plan, executed, equals decodeJ2k", () => {
  for (const fixture of j2kFixtures) {
    it(`reassembles ${fixture.name} bit-for-bit from codeblock tasks run out of plan order on SharedArrayBuffer views`, () => {
      const codestream = fixtureCodestream(fixture.name);
      const serial = decodeJ2k(codestream);

      const plan = planDecode(codestream);
      expect(plan.header.width).toBe(serial.width);
      expect(plan.header.height).toBe(serial.height);

      const sharedBytes = new Uint8Array(new SharedArrayBuffer(codestream.byteLength));
      sharedBytes.set(codestream);
      const tile = new Int32Array(new SharedArrayBuffer(serial.width * serial.height * 4));

      const tasks = [...plan.tasks].reverse();
      for (const task of tasks) {
        const coefficients = decodeCodeblockTask(
          sharedBytes.subarray(task.byteOffset, task.byteOffset + task.byteLength),
          task,
        );
        placeCodeblock(tile, plan.header.width, task, coefficients);
      }
      finishTile(tile, plan.resolutions, plan.header.bitsPerSample, plan.header.isSigned);

      expect(tile.length).toBe(serial.values.length);
      let mismatches = 0;
      for (let i = 0; i < tile.length; i++) {
        if (tile[i] !== serial.values[i]) mismatches++;
      }
      expect(mismatches, `${fixture.name}: mismatched samples`).toBe(0);
    });
  }
});
