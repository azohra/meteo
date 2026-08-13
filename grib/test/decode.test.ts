import { describe, expect, it } from "vitest";
import { codesPower, decodeFieldValues, parseFields } from "../src/index.js";
import type { GribField } from "../src/index.js";
import {
  BitWriter,
  message,
  section1,
  section3LatLon,
  section4,
  section5Complex,
  section5Simple,
  section6,
  section7,
} from "./helpers/synthetic.js";

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

function oneField(...sections: number[][]): GribField {
  return parseFields(
    message(
      0,
      section1(),
      section3LatLon(GRID),
      section4({ parameterCategory: 0, parameterNumber: 0 }),
      ...sections,
    ),
  )[0]!;
}

describe("codesPower", () => {
  it("is the iterated multiply/divide whose ulp-level drift from Math.pow the golden hashes embed", () => {
    expect(codesPower(-2, 10)).toBe(1.0 / 10 / 10);
    expect(codesPower(-12, 10)).not.toBe(Math.pow(10, -12));
    expect(codesPower(3, 10)).toBe(1000);
    expect(codesPower(0, 10)).toBe(1);
    expect(codesPower(-4, 2)).toBe(0.0625);
  });
});

describe("DRT 5.0 simple packing", () => {
  it("decodes a 4x3 grid of known values exactly", () => {
    const writer = new BitWriter();
    for (let x = 0; x < 12; x++) writer.write(x, 4);
    const field = oneField(
      section5Simple({
        numberOfValues: 12,
        referenceValue: 0,
        binaryScaleFactor: 0,
        decimalScaleFactor: 0,
        bitsPerValue: 4,
      }),
      section6(),
      section7(writer.bytes()),
    );
    const decoded = decodeFieldValues(field);
    expect([...decoded.values]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(decoded.missingCount).toBe(0);
    expect(decoded.missingMask).toBeUndefined();
  });

  it("refuses coded values that cover fewer points than the grid without a bitmap", () => {
    const writer = new BitWriter();
    for (const x of [0, 5, 15]) writer.write(x, 4);
    const field = oneField(
      section5Simple({
        numberOfValues: 3,
        referenceValue: 1.5,
        binaryScaleFactor: 1,
        decimalScaleFactor: 1,
        bitsPerValue: 4,
      }),
      section6(),
      section7(writer.bytes()),
    );
    expect(() => decodeFieldValues(field)).toThrow(/codes 3 of 12/);
  });

  it("scales against the reference value exactly", () => {
    const writer = new BitWriter();
    for (const x of [0, 5, 15, 1, 2, 3, 4, 6, 7, 8, 9, 10]) writer.write(x, 4);
    const field = oneField(
      section5Simple({
        numberOfValues: 12,
        referenceValue: 1.5,
        binaryScaleFactor: 1,
        decimalScaleFactor: 1,
        bitsPerValue: 4,
      }),
      section6(),
      section7(writer.bytes()),
    );
    const decimalS = codesPower(-1, 10);
    const decoded = decodeFieldValues(field);
    // eslint-disable-next-line oxc/erasing-op
    expect(decoded.values[0]).toBe((0 * 2 + 1.5) * decimalS);
    expect(decoded.values[1]).toBe((5 * 2 + 1.5) * decimalS);
    expect(decoded.values[2]).toBe((15 * 2 + 1.5) * decimalS);
  });

  it("decodes a constant field (bits=0) to the bare reference value, as ecCodes does", () => {
    const field = oneField(
      section5Simple({
        numberOfValues: 12,
        referenceValue: 288.15,
        binaryScaleFactor: 2,
        decimalScaleFactor: 1,
        bitsPerValue: 0,
      }),
      section6(),
      section7([]),
    );
    const decoded = decodeFieldValues(field);
    expect([...decoded.values]).toEqual(Array(12).fill(Float32Array.of(288.15)[0]!));
  });
});

describe("section 6 bitmap expansion", () => {
  it("expands to the full grid with the missing value substituted", () => {
    const bitmap: Array<0 | 1> = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0];
    const writer = new BitWriter();
    for (const x of [1, 2, 3, 4, 5, 6]) writer.write(x, 8);
    const field = oneField(
      section5Simple({
        numberOfValues: 6,
        referenceValue: 0,
        binaryScaleFactor: 0,
        decimalScaleFactor: 0,
        bitsPerValue: 8,
      }),
      section6(bitmap),
      section7(writer.bytes()),
    );
    const decoded = decodeFieldValues(field);
    expect([...decoded.values]).toEqual([1, 9999, 2, 9999, 3, 9999, 4, 9999, 5, 9999, 6, 9999]);
    expect(decoded.missingCount).toBe(6);
    expect([...decoded.missingMask!]).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
  });

  it("honours a caller-chosen missing value", () => {
    const field = oneField(
      section5Simple({
        numberOfValues: 6,
        referenceValue: 0,
        binaryScaleFactor: 0,
        decimalScaleFactor: 0,
        bitsPerValue: 8,
      }),
      section6([1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]),
      section7(
        new BitWriter()
          .write(1, 8)
          .write(2, 8)
          .write(3, 8)
          .write(4, 8)
          .write(5, 8)
          .write(6, 8)
          .bytes(),
      ),
    );
    const decoded = decodeFieldValues(field, { missingValue: Number.NaN });
    expect(Number.isNaN(decoded.values[1]!)).toBe(true);
    expect(decoded.values[0]).toBe(1);
  });
});

describe("DRT 5.2 complex packing", () => {
  it("decodes two groups with references and widths", () => {
    // Values [5,6,7,8,  20,20,22,21,  9,9,9,9]: groups (len 4, ref 5, w 2),
    // (len 4, ref 20, w 2), (len 4, ref 9, w 0).
    const payload = new BitWriter();
    payload.write(5, 6).write(20, 6).write(9, 6).align(); // group references, 6 bits each
    payload.write(2, 3).write(2, 3).write(0, 3).align(); // group widths
    payload.write(0, 4).write(0, 4).write(0, 4).align(); // scaled lengths (ref 4, inc 1); last overridden
    payload.write(0, 2).write(1, 2).write(2, 2).write(3, 2); // group 1 deltas
    payload.write(0, 2).write(0, 2).write(2, 2).write(1, 2); // group 2 deltas
    const field = oneField(
      section5Complex({
        numberOfValues: 12,
        referenceValue: 0,
        binaryScaleFactor: 0,
        decimalScaleFactor: 0,
        bitsPerValue: 6,
        numberOfGroups: 3,
        bitsForGroupWidths: 3,
        referenceForGroupLengths: 4,
        trueLengthOfLastGroup: 4,
        bitsForScaledGroupLengths: 4,
      }),
      section6(),
      section7(payload.bytes()),
    );
    expect([...decodeFieldValues(field).values]).toEqual([5, 6, 7, 8, 20, 20, 22, 21, 9, 9, 9, 9]);
  });

  it("surfaces primary missing values (management 1) as the missing value", () => {
    // One group, ref 5, width 2: raw 3 (all ones) is the missing marker.
    const payload = new BitWriter();
    payload.write(5, 6).align(); // reference
    payload.write(2, 3).align(); // width
    payload.write(0, 4).align(); // scaled length (overridden by last-length)
    for (const raw of [0, 1, 3, 2, 0, 3, 1, 0, 2, 1, 0, 0]) payload.write(raw, 2);
    const field = oneField(
      section5Complex({
        numberOfValues: 12,
        referenceValue: 0,
        binaryScaleFactor: 0,
        decimalScaleFactor: 0,
        bitsPerValue: 6,
        missingValueManagement: 1,
        numberOfGroups: 1,
        bitsForGroupWidths: 3,
        referenceForGroupLengths: 12,
        trueLengthOfLastGroup: 12,
        bitsForScaledGroupLengths: 4,
      }),
      section6(),
      section7(payload.bytes()),
    );
    const decoded = decodeFieldValues(field);
    expect([...decoded.values]).toEqual([5, 6, 9999, 7, 5, 9999, 6, 5, 7, 6, 5, 5]);
    expect(decoded.missingCount).toBe(2);
    expect([...decoded.missingMask!]).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
  });

  it("decodes a zero-group constant field to the bare reference value", () => {
    const field = oneField(
      section5Complex({
        numberOfValues: 12,
        referenceValue: 273.5,
        binaryScaleFactor: 0,
        decimalScaleFactor: 2,
        bitsPerValue: 0,
        numberOfGroups: 0,
        bitsForGroupWidths: 0,
        referenceForGroupLengths: 0,
        trueLengthOfLastGroup: 0,
        bitsForScaledGroupLengths: 0,
      }),
      section6(),
      section7([]),
    );
    expect([...decodeFieldValues(field).values]).toEqual(Array(12).fill(273.5));
  });
});

describe("DRT 5.3 complex packing with spatial differencing", () => {
  it("reconstructs a first-order differenced field", () => {
    // Original X: [10,12,15,19,24,30,37,45,54,64,75,87]; first differences
    // minus the bias 2 are stored: [_,0,1,2,3,4,5,6,7,8,9,10].
    const payload = new BitWriter();
    payload.write(10, 8); // extra descriptor: first value (unsigned)
    payload.write(0x02, 8); // bias +2, sign-and-magnitude
    payload.write(0, 5).align(); // group reference
    payload.write(4, 3).align(); // group width
    payload.write(0, 4).align(); // scaled length (overridden)
    for (const stored of [0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) payload.write(stored, 4);
    const field = oneField(
      section5Complex({
        numberOfValues: 12,
        referenceValue: 0,
        binaryScaleFactor: 0,
        decimalScaleFactor: 0,
        bitsPerValue: 5,
        numberOfGroups: 1,
        bitsForGroupWidths: 3,
        referenceForGroupLengths: 12,
        trueLengthOfLastGroup: 12,
        bitsForScaledGroupLengths: 4,
        spatialDifferencingOrder: 1,
        extraOctets: 1,
      }),
      section6(),
      section7(payload.bytes()),
    );
    expect([...decodeFieldValues(field).values]).toEqual([
      10, 12, 15, 19, 24, 30, 37, 45, 54, 64, 75, 87,
    ]);
  });

  it("reconstructs a second-order differenced field split into two groups", () => {
    // Original X: [3,4,7,13,20,30,41,55,70,88,107,129]; second differences
    // [2,3,1,3,1,3,1,3,1,3] minus the bias 1 are stored at positions 2-11.
    const payload = new BitWriter();
    payload.write(3, 8).write(4, 8); // first two values (unsigned)
    payload.write(0x01, 8); // bias +1
    payload.write(0, 5).write(0, 5).align(); // group references
    payload.write(2, 3).write(2, 3).align(); // group widths
    payload.write(0, 4).write(0, 4).align(); // scaled lengths
    for (const stored of [0, 0, 1, 2, 0, 2]) payload.write(stored, 2); // group 1
    for (const stored of [0, 2, 0, 2, 0, 2]) payload.write(stored, 2); // group 2
    const field = oneField(
      section5Complex({
        numberOfValues: 12,
        referenceValue: 0,
        binaryScaleFactor: 0,
        decimalScaleFactor: 0,
        bitsPerValue: 5,
        numberOfGroups: 2,
        bitsForGroupWidths: 3,
        referenceForGroupLengths: 6,
        trueLengthOfLastGroup: 6,
        bitsForScaledGroupLengths: 4,
        spatialDifferencingOrder: 2,
        extraOctets: 1,
      }),
      section6(),
      section7(payload.bytes()),
    );
    expect([...decodeFieldValues(field).values]).toEqual([
      3, 4, 7, 13, 20, 30, 41, 55, 70, 88, 107, 129,
    ]);
  });

  it("applies a negative sign-and-magnitude bias", () => {
    // X: [30,28,26,24,22,20,18,16,14,12,10,8]; d1 = -2 everywhere, so the
    // stored values are all 0 with bias -2 (0x82 in sign-and-magnitude).
    const payload = new BitWriter();
    payload.write(30, 8);
    payload.write(0x82, 8); // bias -2
    payload.write(0, 5).align();
    payload.write(0, 3).align(); // width 0: constant group
    payload.write(0, 4).align();
    const field = oneField(
      section5Complex({
        numberOfValues: 12,
        referenceValue: 0,
        binaryScaleFactor: 0,
        decimalScaleFactor: 0,
        bitsPerValue: 5,
        numberOfGroups: 1,
        bitsForGroupWidths: 3,
        referenceForGroupLengths: 12,
        trueLengthOfLastGroup: 12,
        bitsForScaledGroupLengths: 4,
        spatialDifferencingOrder: 1,
        extraOctets: 1,
      }),
      section6(),
      section7(payload.bytes()),
    );
    expect([...decodeFieldValues(field).values]).toEqual([
      30, 28, 26, 24, 22, 20, 18, 16, 14, 12, 10, 8,
    ]);
  });
});

describe("unsupported templates", () => {
  it("names an unknown data representation template", () => {
    const bad = section5Simple({
      numberOfValues: 12,
      referenceValue: 0,
      binaryScaleFactor: 0,
      decimalScaleFactor: 0,
      bitsPerValue: 0,
    });
    bad[10] = 41; // DRT 5.41 (PNG packing)
    const field = oneField(bad, section6(), section7([]));
    expect(() => decodeFieldValues(field)).toThrow(/5\.41/);
  });

  it("refuses JPEG 2000 without an injected decoder, naming the wiring", () => {
    const jpeg = section5Simple({
      numberOfValues: 12,
      referenceValue: 0,
      binaryScaleFactor: 0,
      decimalScaleFactor: 0,
      bitsPerValue: 12,
    });
    jpeg[10] = 40;
    const field = oneField(jpeg, section6(), section7([]));
    expect(() => decodeFieldValues(field)).toThrow(/j2k-node/);
  });
});
