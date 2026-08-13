import { describe, expect, it } from "vitest";
import { parseFields, parseProduct, splitMessages } from "../src/index.js";
import {
  message,
  section1,
  section3LatLon,
  section4,
  section5Simple,
  section6,
  section7,
  BitWriter,
} from "./helpers/synthetic.js";

/** A framing-valid, content-free message. */
function fakeMessage(payload: number[]): Uint8Array {
  const body = [0, 0, 2, 2, ...payload, 0x37, 0x37, 0x37, 0x37];
  const length = 16 + body.length;
  return new Uint8Array([
    0x47,
    0x52,
    0x49,
    0x42,
    0,
    0,
    2,
    2,
    0,
    0,
    0,
    0,
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...body,
  ]);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe("splitMessages", () => {
  it("returns each stacked member", () => {
    const first = fakeMessage([1, 2, 3]);
    const second = fakeMessage([9]);
    expect(splitMessages(concat(first, second))).toEqual([first, second]);
  });

  it("fails loudly on misaligned bytes", () => {
    const junk = concat(new Uint8Array([0x4a, 0x55, 0x4e, 0x4b]), fakeMessage([1]));
    expect(() => splitMessages(junk)).toThrow(/misaligned/);
  });

  it("fails loudly on a truncated message", () => {
    const truncated = fakeMessage([1]).subarray(0, fakeMessage([1]).length - 2);
    expect(() => splitMessages(truncated)).toThrow(/truncated/);
  });
});

const GRID = {
  ni: 4,
  nj: 3,
  la1: 49,
  lo1: 242,
  la2: 49.2,
  lo2: 242.3,
  di: 0.1,
  dj: 0.1,
  scanningMode: 0x40,
};

function simplePayload(values: number[], bits: number): number[] {
  const writer = new BitWriter();
  for (const value of values) writer.write(value, bits);
  return writer.bytes();
}

describe("parseFields", () => {
  it("walks a single-field message", () => {
    const built = message(
      0,
      section1(),
      section3LatLon(GRID),
      section4({ parameterCategory: 0, parameterNumber: 0, forecastTime: 6 }),
      section5Simple({
        numberOfValues: 12,
        referenceValue: 0,
        binaryScaleFactor: 0,
        decimalScaleFactor: 0,
        bitsPerValue: 4,
      }),
      section6(),
      section7(simplePayload([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 4)),
    );
    const [field, ...rest] = parseFields(built);
    expect(rest).toHaveLength(0);
    expect(field!.discipline).toBe(0);
    expect(field!.identification.year).toBe(2026);
    expect(field!.identification.centre).toBe(54);
    expect(field!.section6).toBeUndefined(); // indicator 255: no bitmap
  });

  it("exposes each repetition of sections 4-7 as its own field with inherited sections", () => {
    const built = message(
      0,
      section1(),
      section3LatLon(GRID),
      section4({ parameterCategory: 2, parameterNumber: 2 }), // UGRD
      section5Simple({
        numberOfValues: 12,
        referenceValue: 1,
        binaryScaleFactor: 0,
        decimalScaleFactor: 0,
        bitsPerValue: 0,
      }),
      section6(),
      section7([]),
      section4({ parameterCategory: 2, parameterNumber: 3 }), // VGRD
      section5Simple({
        numberOfValues: 12,
        referenceValue: 2,
        binaryScaleFactor: 0,
        decimalScaleFactor: 0,
        bitsPerValue: 0,
      }),
      section6(),
      section7([]),
    );
    const fields = parseFields(built);
    expect(fields).toHaveLength(2);
    expect(fields[0]!.section3).toBe(fields[1]!.section3); // inherited, not copied
    expect(parseProduct(fields[0]!.section4).parameterNumber).toBe(2);
    expect(parseProduct(fields[1]!.section4).parameterNumber).toBe(3);
  });

  it("carries a defined bitmap into a later field that declares indicator 254", () => {
    const bitmap: Array<0 | 1> = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0];
    const built = message(
      0,
      section1(),
      section3LatLon(GRID),
      section4({ parameterCategory: 2, parameterNumber: 2 }),
      section5Simple({
        numberOfValues: 6,
        referenceValue: 0,
        binaryScaleFactor: 0,
        decimalScaleFactor: 0,
        bitsPerValue: 8,
      }),
      section6(bitmap),
      section7(simplePayload([1, 2, 3, 4, 5, 6], 8)),
      section4({ parameterCategory: 2, parameterNumber: 3 }),
      section5Simple({
        numberOfValues: 6,
        referenceValue: 0,
        binaryScaleFactor: 0,
        decimalScaleFactor: 0,
        bitsPerValue: 8,
      }),
      [0, 0, 0, 6, 6, 254], // raw section 6: length 6, number 6, indicator 254
      section7(simplePayload([7, 8, 9, 10, 11, 12], 8)),
    );
    const fields = parseFields(built);
    expect(fields[1]!.section6).toBe(fields[0]!.section6);
  });

  it("rejects indicator 254 with no bitmap defined before it", () => {
    const built = message(
      0,
      section1(),
      section3LatLon(GRID),
      section4({ parameterCategory: 0, parameterNumber: 0 }),
      section5Simple({
        numberOfValues: 12,
        referenceValue: 0,
        binaryScaleFactor: 0,
        decimalScaleFactor: 0,
        bitsPerValue: 0,
      }),
      [0, 0, 0, 6, 6, 254],
      section7([]),
    );
    expect(() => parseFields(built)).toThrow(/254/);
  });

  it("rejects a GRIB1 message rather than misreading it", () => {
    const grib1 = fakeMessage([]);
    grib1[7] = 1;
    expect(() => parseFields(grib1)).toThrow(/edition 1/);
  });
});
