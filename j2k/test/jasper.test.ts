import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeCodeblockTask,
  decodeJ2k,
  finishTile,
  parseCodestream,
  placeCodeblock,
  planDecode,
} from "../src/index.js";
import { fixtureCodestream, fixturesDir } from "./helpers/fixtures.js";

interface Expectation {
  codestream: {
    width: number;
    height: number;
    bitsPerSample: number;
    isSigned: boolean;
    guardBits: number;
    exponents: number[];
    codeblockTasks: number;
  };
  rawSamples: { count: number; sha256OfInt32Le: string };
}

const expected = JSON.parse(
  readFileSync(`${fixturesDir}rdps-cape-sfc-jasper.expect.json`, "utf8"),
) as Expectation;

const codestream = fixtureCodestream("rdps-cape-sfc-jasper");

function sha256OfInt32Le(values: Int32Array): string {
  const raw = new Uint8Array(values.length * 4);
  const view = new DataView(raw.buffer);
  for (let i = 0; i < values.length; i++) view.setInt32(i * 4, values[i]!, true);
  return createHash("sha256").update(raw).digest("hex");
}

describe("the JasPer shape (tile-part QCC, multiple precincts, 24-bit, one-row)", () => {
  it("honors the tile-part QCC's exponents over the main QCD's, which differ", () => {
    const header = parseCodestream(codestream);
    expect(header.width).toBe(expected.codestream.width);
    expect(header.height).toBe(expected.codestream.height);
    expect(header.bitsPerSample).toBe(expected.codestream.bitsPerSample);
    expect(header.isSigned).toBe(expected.codestream.isSigned);
    expect(header.guardBits).toBe(expected.codestream.guardBits);
    expect(header.exponents).toEqual(expected.codestream.exponents);
  });

  it("plans the multi-precinct packet walk", () => {
    const plan = planDecode(codestream);
    expect(plan.tasks.length).toBe(expected.codestream.codeblockTasks);
  });

  it("decodes to the recorded oracle answer, sample for sample", () => {
    const decoded = decodeJ2k(codestream);
    expect(decoded.values.length).toBe(expected.rawSamples.count);
    expect(sha256OfInt32Le(decoded.values)).toBe(expected.rawSamples.sha256OfInt32Le);
  });

  it("refuses a QCC naming a component other than 0", () => {
    const u16 = (at: number) => codestream[at]! * 0x100 + codestream[at + 1]!;
    let p = 2;
    while (u16(p) !== 0xff90) p += 2 + u16(p + 2);
    p += 12;
    while (u16(p) !== 0xff5d) p += 2 + u16(p + 2);
    const copy = codestream.slice();
    copy[p + 4] = 1;
    expect(() => parseCodestream(copy)).toThrow(/QCC names component 1/);
  });

  it("reassembles identically from parallel codeblock tasks", () => {
    const plan = planDecode(codestream);
    const shared = new Uint8Array(new SharedArrayBuffer(codestream.byteLength));
    shared.set(codestream);
    const tile = new Int32Array(new SharedArrayBuffer(plan.header.width * plan.header.height * 4));
    for (const task of [...plan.tasks].reverse()) {
      placeCodeblock(
        tile,
        plan.header.width,
        task,
        decodeCodeblockTask(
          shared.subarray(task.byteOffset, task.byteOffset + task.byteLength),
          task,
        ),
      );
    }
    finishTile(tile, plan.resolutions, plan.header.bitsPerSample, plan.header.isSigned);
    expect(sha256OfInt32Le(new Int32Array(tile))).toBe(expected.rawSamples.sha256OfInt32Le);
  });
});
