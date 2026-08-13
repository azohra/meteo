import { describe, expect, it } from "vitest";

import { PythonRandom, randomFromMaterial } from "../src/scenario/rng.js";
import { pyDumps } from "../src/scenario/json.js";

const MATERIAL = '[42,"symmetric",0,"column"]';

describe("PythonRandom parity with CPython", () => {
  it("builds the exact compact-JSON seed material", () => {
    expect(pyDumps([42, "symmetric", 0, "column"])).toBe(MATERIAL);
  });

  it("random() reproduces genrand_res53", () => {
    const stream = randomFromMaterial(MATERIAL);
    expect([stream.random(), stream.random(), stream.random()]).toEqual([
      0.576922920610918, 0.2094002293863828, 0.14798532162845468,
    ]);
  });

  it("gauss() reproduces the sin/cos pair algorithm", () => {
    const stream = randomFromMaterial(MATERIAL);
    expect(stream.gauss(0.0, 1.0)).toBe(-0.6069911307274143);
  });

  it("uniform() reproduces a + (b - a) * random()", () => {
    const stream = randomFromMaterial(MATERIAL);
    expect(stream.uniform(-1.0, 1.0)).toBe(0.15384584122183598);
  });

  it("shuffle() reproduces the getrandbits Fisher-Yates order", () => {
    const nine = Array.from({ length: 9 }, (_, index) => index);
    randomFromMaterial(MATERIAL).shuffle(nine);
    expect(nine).toEqual([2, 7, 8, 4, 6, 5, 1, 0, 3]);

    const twentyOne = Array.from({ length: 21 }, (_, index) => index);
    randomFromMaterial(MATERIAL).shuffle(twentyOne);
    expect(twentyOne).toEqual([
      5, 1, 14, 11, 15, 2, 3, 7, 10, 8, 20, 12, 9, 16, 13, 17, 19, 4, 0, 6, 18,
    ]);
  });

  it("getrandbits() reproduces the tempered-word shift", () => {
    const stream = randomFromMaterial(MATERIAL);
    expect(Array.from({ length: 8 }, () => stream.getrandbits(4))).toEqual([
      9, 10, 3, 0, 2, 10, 3, 2,
    ]);
  });

  it("seeds like CPython for zero and for multi-word integers", () => {
    // random.Random(0): a zero integer still contributes one key word.
    const zero = new PythonRandom(Uint32Array.from([0]));
    expect([zero.random(), zero.random()]).toEqual([0.8444218515250481, 0.7579544029403025]);

    // random.Random(2**64 + 5): little-endian words [5, 0, 1].
    const big = new PythonRandom(Uint32Array.from([5, 0, 1]));
    expect(big.random()).toBe(0.5105783769365112);
  });
});
