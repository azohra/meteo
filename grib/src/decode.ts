import { BitReader, float32be, i16sm, u8, u16, u32 } from "./bytes.js";
import type { GribField } from "./message.js";

/** Default in-band missing value for decoded arrays. */
export const ECCODES_MISSING_VALUE = 9999;

/** What a JPEG 2000 codestream decodes to: the raw integer samples of the
 * single component, in codestream order; the caller applies GRIB scaling. */
export interface J2kSamples {
  values: Int32Array | Uint16Array | Int16Array;
  bitsPerSample: number;
  isSigned: boolean;
  componentCount: number;
}

/** An injected JPEG 2000 codestream decoder. */
export type DecodeJ2k = (codestream: Uint8Array) => J2kSamples;

/** A DecodeJ2k that may return a promise (e.g. a worker pool's decode). */
export type DecodeJ2kAsync = (codestream: Uint8Array) => J2kSamples | Promise<J2kSamples>;

/**
 * The GRIB scaling of a DRT 5.40 field, precomputed as exact-double
 * coefficients so a remote decoder applies exactly
 * `(sample * binaryScale + referenceValue) * decimalScale`.
 */
export interface J2kScaling {
  referenceValue: number;
  binaryScale: number;
  decimalScale: number;
  /** Section 5's coded-value count; any other decode length is corrupt. */
  expectedCount: number;
}

/**
 * An injected sampled JPEG 2000 decode: decodes the codestream and returns
 * the GRIB-scaled values at `indices` only, never materializing the full
 * grid on this side of the seam.
 */
export type DecodeJ2kSampled = (
  codestream: Uint8Array,
  scaling: J2kScaling,
  indices: Uint32Array,
) => Float64Array | Promise<Float64Array>;

interface DecodeOptionsFor<Decoder> {
  /** Required for DRT 5.40 fields; unused otherwise. */
  decodeJ2k?: Decoder;
  /** In-band substitute for missing points (default 9999). */
  missingValue?: number;
}

export type DecodeOptions = DecodeOptionsFor<DecodeJ2k>;

export type DecodeOptionsAsync = DecodeOptionsFor<DecodeJ2kAsync>;

export interface DecodedField {
  /** Full-grid values in storage order, missing points substituted. */
  values: Float64Array;
  missingCount: number;
  missingValue: number;
  /** Per-point missing mask (1 = missing), present only when any point is. */
  missingMask: Uint8Array | undefined;
}

/** Iterated multiply/divide power — deliberately not Math.pow; decoded
 * values depend on its exact rounding. */
export function codesPower(s: number, n: number): number {
  let divisor = 1.0;
  if (s === 0) return 1.0;
  if (s === 1) return n;
  while (s < 0) {
    divisor /= n;
    s++;
  }
  while (s > 0) {
    divisor *= n;
    s--;
  }
  return divisor;
}

interface PackingHeader {
  referenceValue: number;
  binaryScaleFactor: number;
  decimalScaleFactor: number;
  bitsPerValue: number;
}

function packingHeader(section5: Uint8Array): PackingHeader {
  return {
    referenceValue: float32be(section5, 11),
    binaryScaleFactor: i16sm(section5, 15),
    decimalScaleFactor: i16sm(section5, 17),
    bitsPerValue: u8(section5, 19),
  };
}

/** The packing header's scale factors as the exact-double coefficients
 * every decode loop applies:
 * `(X * binaryScale + referenceValue) * decimalScale`. */
function scalingOf(section5: Uint8Array): {
  referenceValue: number;
  binaryScale: number;
  decimalScale: number;
} {
  const { referenceValue, binaryScaleFactor, decimalScaleFactor } = packingHeader(section5);
  return {
    referenceValue,
    binaryScale: codesPower(binaryScaleFactor, 2),
    decimalScale: codesPower(-decimalScaleFactor, 10),
  };
}

function unpackSimple(section5: Uint8Array, section7: Uint8Array, count: number): Float64Array {
  const { bitsPerValue } = packingHeader(section5);
  const { referenceValue, binaryScale, decimalScale } = scalingOf(section5);
  const values = new Float64Array(count);
  if (bitsPerValue === 0) {
    values.fill(referenceValue);
    return values;
  }
  const reader = new BitReader(section7, 5 * 8);
  for (let i = 0; i < count; i++) {
    values[i] = (reader.read(bitsPerValue) * binaryScale + referenceValue) * decimalScale;
  }
  return values;
}

function unpackComplex(
  section5: Uint8Array,
  section7: Uint8Array,
  count: number,
  missingValue: number,
  codedMissing: Uint8Array,
): Float64Array {
  const { referenceValue, bitsPerValue } = packingHeader(section5);
  const drt = u16(section5, 9);
  const groupSplitting = u8(section5, 21);
  const missingManagement = u8(section5, 22);
  const numberOfGroups = u32(section5, 31);
  const referenceForGroupWidths = u8(section5, 35);
  const bitsForGroupWidths = u8(section5, 36);
  const referenceForGroupLengths = u32(section5, 37);
  const lengthIncrement = u8(section5, 41);
  const trueLengthOfLastGroup = u32(section5, 42);
  const bitsForScaledGroupLengths = u8(section5, 46);
  const order = drt === 3 ? u8(section5, 47) : 0;
  const extraOctets = drt === 3 ? u8(section5, 48) : 0;

  const values = new Float64Array(count);
  if (numberOfGroups === 0) {
    values.fill(referenceValue);
    return values;
  }
  if (groupSplitting !== 1) {
    throw new Error(
      `GRIB complex packing group-splitting method ${groupSplitting} is not supported (general splitting only)`,
    );
  }
  if (missingManagement > 2) {
    throw new Error(
      `GRIB complex packing missing-value management ${missingManagement} is not supported`,
    );
  }
  if (drt === 3 && order !== 1 && order !== 2) {
    throw new Error(`GRIB spatial differencing order ${order} is not supported (1 or 2)`);
  }

  const payload = section7.subarray(5);
  const extrasBits = drt === 3 ? (order + 1) * extraOctets * 8 : 0;
  const refsEndBits = extrasBits + numberOfGroups * bitsPerValue;
  const widthsStart = Math.ceil(refsEndBits / 8) * 8;
  const lengthsStart = widthsStart + Math.ceil((numberOfGroups * bitsForGroupWidths) / 8) * 8;
  const valuesStart =
    lengthsStart + Math.ceil((numberOfGroups * bitsForScaledGroupLengths) / 8) * 8;

  const refReader = new BitReader(payload, extrasBits);
  const widthReader = new BitReader(payload, widthsStart);
  const lengthReader = new BitReader(payload, lengthsStart);
  const valueReader = new BitReader(payload, valuesStart);

  const secVal = new Float64Array(count);
  const CODED_MISSING = Number.MAX_SAFE_INTEGER;

  let vcount = 0;
  for (let group = 0; group < numberOfGroups; group++) {
    const groupRef = refReader.read(bitsPerValue);
    const width = widthReader.read(bitsForGroupWidths) + referenceForGroupWidths;
    let length =
      lengthReader.read(bitsForScaledGroupLengths) * lengthIncrement + referenceForGroupLengths;
    if (group === numberOfGroups - 1) length = trueLengthOfLastGroup;
    if (vcount + length > count) {
      throw new Error(
        `GRIB complex packing groups cover ${vcount + length}+ points but section 5 declares ${count}`,
      );
    }

    if (missingManagement === 0) {
      for (let j = 0; j < length; j++) {
        secVal[vcount + j] = groupRef + valueReader.read(width);
      }
    } else if (missingManagement === 1) {
      if (width === 0) {
        const maxn = 2 ** bitsPerValue - 1;
        if (groupRef === maxn) {
          for (let j = 0; j < length; j++) secVal[vcount + j] = CODED_MISSING;
        } else {
          for (let j = 0; j < length; j++) secVal[vcount + j] = groupRef;
        }
      } else {
        const maxn = 2 ** width - 1;
        for (let j = 0; j < length; j++) {
          const raw = valueReader.read(width);
          secVal[vcount + j] = raw === maxn ? CODED_MISSING : groupRef + raw;
        }
      }
    } else {
      if (width === 0) {
        const maxn = 2 ** bitsPerValue - 1;
        if (groupRef === maxn || groupRef === maxn - 1) {
          for (let j = 0; j < length; j++) secVal[vcount + j] = CODED_MISSING;
        } else {
          for (let j = 0; j < length; j++) secVal[vcount + j] = groupRef;
        }
      } else {
        const maxn = 2 ** width - 1;
        for (let j = 0; j < length; j++) {
          const raw = valueReader.read(width);
          secVal[vcount + j] = raw === maxn || raw === maxn - 1 ? CODED_MISSING : groupRef + raw;
        }
      }
    }
    vcount += length;
  }
  if (vcount !== count) {
    throw new Error(
      `GRIB complex packing groups cover ${vcount} points but section 5 declares ${count}`,
    );
  }

  if (drt === 3) {
    const descriptorReader = new BitReader(payload, 0);
    const extras: number[] = [];
    for (let i = 0; i < order; i++) {
      extras.push(descriptorReader.read(extraOctets * 8));
    }
    const bias = descriptorReader.readSigned(extraOctets * 8);

    let j = 0;
    if (order === 1) {
      let last = extras[0]!;
      while (j < count) {
        if (secVal[j] === CODED_MISSING) j++;
        else {
          secVal[j++] = extras[0]!;
          break;
        }
      }
      for (; j < count; j++) {
        if (secVal[j] !== CODED_MISSING) {
          secVal[j] += last + bias;
          last = secVal[j]!;
        }
      }
    } else {
      let penultimate = extras[0]!;
      let last = extras[1]!;
      while (j < count) {
        if (secVal[j] === CODED_MISSING) j++;
        else {
          secVal[j++] = extras[0]!;
          break;
        }
      }
      while (j < count) {
        if (secVal[j] === CODED_MISSING) j++;
        else {
          secVal[j++] = extras[1]!;
          break;
        }
      }
      for (; j < count; j++) {
        if (secVal[j] !== CODED_MISSING) {
          secVal[j] += bias + last + last - penultimate;
          penultimate = last;
          last = secVal[j]!;
        }
      }
    }
  }

  const { binaryScale, decimalScale } = scalingOf(section5);
  for (let i = 0; i < count; i++) {
    if (secVal[i] === CODED_MISSING) {
      values[i] = missingValue;
      codedMissing[i] = 1;
    } else {
      values[i] = (secVal[i]! * binaryScale + referenceValue) * decimalScale;
    }
  }
  return values;
}

function jpeg2000Payload(
  section5: Uint8Array,
  section7: Uint8Array,
  count: number,
):
  | { constant: Float64Array; codestream?: undefined }
  | { constant?: undefined; codestream: Uint8Array } {
  const { referenceValue, bitsPerValue } = packingHeader(section5);
  if (bitsPerValue === 0) {
    const values = new Float64Array(count);
    values.fill(referenceValue);
    return { constant: values };
  }
  return { codestream: section7.subarray(5) };
}

function scaleJpeg2000(scaling: J2kScaling, decoded: J2kSamples): Float64Array {
  if (decoded.componentCount !== 1) {
    throw new Error(
      `GRIB JPEG 2000 codestream decoded to ${decoded.componentCount} components, expected 1`,
    );
  }
  if (decoded.values.length !== scaling.expectedCount) {
    throw new Error(
      `GRIB JPEG 2000 codestream decoded to ${decoded.values.length} samples but section 5 declares ${scaling.expectedCount}`,
    );
  }
  const values = new Float64Array(scaling.expectedCount);
  for (let i = 0; i < values.length; i++) {
    values[i] =
      (decoded.values[i]! * scaling.binaryScale + scaling.referenceValue) * scaling.decimalScale;
  }
  return values;
}

const NO_DECODER_MESSAGE =
  "GRIB field is JPEG 2000 packed (DRT 5.40) and no DecodeJ2k was injected; " +
  "in Node, wire createNodeJ2kDecoder() or createNodeJ2kDecoderPool() from @azohra/meteo.grib/j2k-node";

function requireDecoder<Decoder>(decodeJ2k: Decoder | undefined): Decoder {
  if (decodeJ2k === undefined) throw new Error(NO_DECODER_MESSAGE);
  return decodeJ2k;
}

function j2kScalingOf(section5: Uint8Array, expectedCount: number): J2kScaling {
  return { ...scalingOf(section5), expectedCount };
}

/** GRIB2 bitmap indicator (section 6, octet 6); 255 means no bitmap. */
function bitmapIndicatorOf(field: GribField): number {
  return field.section6 === undefined ? 255 : u8(field.section6, 5);
}

function requireFullCoverage(codedCount: number, gridPoints: number): void {
  if (codedCount !== gridPoints) {
    throw new Error(
      `GRIB field has no bitmap but codes ${codedCount} of ${gridPoints} grid points`,
    );
  }
}

function fieldLayout(field: GribField): { codedCount: number; drt: number; gridPoints: number } {
  const section5 = field.section5;
  if (u8(section5, 4) !== 5) {
    throw new Error(`expected GRIB section 5, got section ${u8(section5, 4)}`);
  }
  return {
    codedCount: u32(section5, 5),
    drt: u16(section5, 9),
    gridPoints: u32(field.section3, 6),
  };
}

function unsupportedTemplate(drt: number): Error {
  return new Error(
    `GRIB data representation template 5.${drt} is not supported (5.0, 5.2, 5.3, 5.40)`,
  );
}

/** A DRT 5.40 field waiting on a codestream decoder: hand `codestream` to
 * one, then resolve the coded values via scaleJpeg2000 with `scaling`. */
interface J2kJob {
  codestream: Uint8Array;
  scaling: J2kScaling;
}

type UnpackedField =
  | {
      gridPoints: number;
      coded: Float64Array;
      codedMissing: Uint8Array | undefined;
      j2k?: undefined;
    }
  | { gridPoints: number; j2k: J2kJob; coded?: undefined; codedMissing?: undefined };

/**
 * The one decode core: unpacks every template in place except a DRT 5.40
 * codestream, which comes back as a J2kJob so the sync and async entry
 * points differ only in how they run the injected decoder.
 */
function unpackField(field: GribField, missingValue: number): UnpackedField {
  const { codedCount, drt, gridPoints } = fieldLayout(field);
  const section5 = field.section5;
  switch (drt) {
    case 0:
      return {
        gridPoints,
        coded: unpackSimple(section5, field.section7, codedCount),
        codedMissing: undefined,
      };
    case 2:
    case 3: {
      const codedMissing = new Uint8Array(codedCount);
      const coded = unpackComplex(section5, field.section7, codedCount, missingValue, codedMissing);
      return { gridPoints, coded, codedMissing };
    }
    case 40: {
      const payload = jpeg2000Payload(section5, field.section7, codedCount);
      if (payload.constant !== undefined) {
        return { gridPoints, coded: payload.constant, codedMissing: undefined };
      }
      return {
        gridPoints,
        j2k: {
          codestream: payload.codestream,
          scaling: j2kScalingOf(section5, codedCount),
        },
      };
    }
    default:
      throw unsupportedTemplate(drt);
  }
}

/**
 * Decodes one field's values to the full grid, expanding any section 6
 * bitmap with `missingValue` substituted.
 */
export function decodeFieldValues(field: GribField, options: DecodeOptions = {}): DecodedField {
  const missingValue = options.missingValue ?? ECCODES_MISSING_VALUE;
  const unpacked = unpackField(field, missingValue);
  const coded =
    unpacked.j2k === undefined
      ? unpacked.coded
      : scaleJpeg2000(
          unpacked.j2k.scaling,
          requireDecoder(options.decodeJ2k)(unpacked.j2k.codestream),
        );
  return assembleField(field, unpacked.gridPoints, coded, unpacked.codedMissing, missingValue);
}

/**
 * decodeFieldValues with an async-friendly JPEG 2000 seam: identical
 * arithmetic and results, but DRT 5.40 codestreams may be decoded by a
 * promise-returning DecodeJ2kAsync.
 */
export async function decodeFieldValuesAsync(
  field: GribField,
  options: DecodeOptionsAsync = {},
): Promise<DecodedField> {
  const missingValue = options.missingValue ?? ECCODES_MISSING_VALUE;
  const unpacked = unpackField(field, missingValue);
  const coded =
    unpacked.j2k === undefined
      ? unpacked.coded
      : scaleJpeg2000(
          unpacked.j2k.scaling,
          await requireDecoder(options.decodeJ2k)(unpacked.j2k.codestream),
        );
  return assembleField(field, unpacked.gridPoints, coded, unpacked.codedMissing, missingValue);
}

/** What sampleFieldValuesAsync returns: the decoded values at the
 * requested full-grid indexes. */
export interface SampledFieldValues {
  /** One value per requested index, in request order. */
  values: Float64Array;
  /** 1 where the sampled point is missing; present only when any is. */
  missingMask: Uint8Array | undefined;
}

export interface SampleOptionsAsync extends DecodeOptionsAsync {
  /** The sampled fast path for DRT 5.40 fields without a bitmap: only the
   * requested points come back across the seam. Absent or inapplicable,
   * the field decodes in full and the points are gathered here — identical
   * values either way. */
  decodeJ2kSampled?: DecodeJ2kSampled;
}

/**
 * Decodes one field at the given full-grid indexes only; a bitmap-masked
 * or in-band-missing point surfaces through missingMask, never as a
 * number.
 */
export async function sampleFieldValuesAsync(
  field: GribField,
  indices: Uint32Array | readonly number[],
  options: SampleOptionsAsync = {},
): Promise<SampledFieldValues> {
  const { codedCount, drt, gridPoints } = fieldLayout(field);
  for (const index of indices) {
    if (!(index >= 0 && index < gridPoints)) {
      throw new Error(`sample index ${index} is outside the ${gridPoints}-point grid`);
    }
  }
  if (drt === 40 && bitmapIndicatorOf(field) === 255 && options.decodeJ2kSampled !== undefined) {
    requireFullCoverage(codedCount, gridPoints);
    const payload = jpeg2000Payload(field.section5, field.section7, codedCount);
    let values: Float64Array;
    if (payload.constant !== undefined) {
      values = new Float64Array(indices.length).fill(payload.constant[0] ?? 0);
    } else {
      values = await options.decodeJ2kSampled(
        payload.codestream,
        j2kScalingOf(field.section5, codedCount),
        indices instanceof Uint32Array ? indices : Uint32Array.from(indices),
      );
    }
    return { values, missingMask: undefined };
  }

  const decoded = await decodeFieldValuesAsync(field, options);
  const values = new Float64Array(indices.length);
  let missingMask: Uint8Array | undefined;
  for (let i = 0; i < indices.length; i++) {
    const index = (indices as ArrayLike<number>)[i]!;
    values[i] = decoded.values[index]!;
    if (decoded.missingMask !== undefined && decoded.missingMask[index] === 1) {
      missingMask ??= new Uint8Array(indices.length);
      missingMask[i] = 1;
    }
  }
  return { values, missingMask };
}

function assembleField(
  field: GribField,
  gridPoints: number,
  coded: Float64Array,
  codedMissing: Uint8Array | undefined,
  missingValue: number,
): DecodedField {
  if (bitmapIndicatorOf(field) === 255) {
    requireFullCoverage(coded.length, gridPoints);
    let missingCount = 0;
    if (codedMissing !== undefined) {
      for (let i = 0; i < codedMissing.length; i++) missingCount += codedMissing[i]!;
    }
    return {
      values: coded,
      missingCount,
      missingValue,
      missingMask: missingCount > 0 ? codedMissing : undefined,
    };
  }

  const bitmap = field.section6!;
  const values = new Float64Array(gridPoints);
  const mask = new Uint8Array(gridPoints);
  let missingCount = 0;
  let next = 0;
  for (let i = 0; i < gridPoints; i++) {
    const present = (bitmap[6 + (i >> 3)]! >> (7 - (i & 7))) & 1;
    if (present) {
      if (next >= coded.length) {
        throw new Error(
          `GRIB bitmap marks more points present than the ${coded.length} coded values`,
        );
      }
      if (codedMissing !== undefined && codedMissing[next] === 1) {
        missingCount += 1;
        mask[i] = 1;
      }
      values[i] = coded[next]!;
      next += 1;
    } else {
      values[i] = missingValue;
      mask[i] = 1;
      missingCount += 1;
    }
  }
  if (next !== coded.length) {
    throw new Error(
      `GRIB bitmap marks ${next} points present but ${coded.length} values are coded`,
    );
  }
  return { values, missingCount, missingValue, missingMask: mask };
}
