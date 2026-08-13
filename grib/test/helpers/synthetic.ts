export function u16be(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

export function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

/** Sign-and-magnitude 16-bit (GRIB scale factors). */
export function i16sm(value: number): number[] {
  const magnitude = Math.abs(value);
  return [((value < 0 ? 0x80 : 0) | (magnitude >> 8)) & 0xff, magnitude & 0xff];
}

export function f32be(value: number): number[] {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setFloat32(0, value, false);
  return [...bytes];
}

/** MSB-first bit packer for section 7 payloads. */
export class BitWriter {
  private readonly bits: number[] = [];

  write(value: number, bits: number): this {
    for (let bit = bits - 1; bit >= 0; bit--) {
      this.bits.push((value >> bit) & 1);
    }
    return this;
  }

  /** Pads the current byte with zero bits (GRIB blocks are byte-aligned). */
  align(): this {
    while (this.bits.length % 8 !== 0) this.bits.push(0);
    return this;
  }

  bytes(): number[] {
    this.align();
    const out: number[] = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | this.bits[i + j]!;
      out.push(byte);
    }
    return out;
  }
}

/** A numbered section: 4-octet length + 1-octet number + body. */
export function section(number: number, body: number[]): number[] {
  return [...u32be(body.length + 5), number, ...body];
}

/** Section 1 with a fixed reference time (2026-08-07T12:00:00Z). */
export function section1(): number[] {
  return section(1, [
    ...u16be(54), // centre (ECCC, arbitrary)
    ...u16be(0), // subCentre
    28, // tables version
    0, // local tables
    1, // significance of reference time: start of forecast
    ...u16be(2026),
    8,
    7,
    12,
    0,
    0,
    0, // production status
    1, // type of data: forecast
  ]);
}

export interface LatLonSpec {
  ni: number;
  nj: number;
  la1: number;
  lo1: number;
  la2: number;
  lo2: number;
  di: number;
  dj: number;
  scanningMode: number;
  /** Template 3.1 southern pole; omitting builds template 3.0. */
  southPoleLatitude?: number;
  southPoleLongitude?: number;
  angleOfRotation?: number;
}

function microSigned(degrees: number): number[] {
  const micro = Math.round(Math.abs(degrees) * 1e6);
  const bytes = u32be(micro);
  if (degrees < 0) bytes[0] = bytes[0]! | 0x80;
  return bytes;
}

function microUnsigned(degrees: number): number[] {
  return u32be(Math.round((((degrees % 360) + 360) % 360) * 1e6));
}

/** Section 3, template 3.0 or 3.1, spherical earth 6 371 229 m (code 6). */
export function section3LatLon(spec: LatLonSpec): number[] {
  const rotated = spec.southPoleLatitude !== undefined;
  const body = [
    0, // source of grid definition
    ...u32be(spec.ni * spec.nj), // number of data points
    0, // octets for optional list
    0, // interpretation
    ...u16be(rotated ? 1 : 0), // template number
    6, // shape of the earth: sphere 6 371 229 m
    0,
    ...u32be(0), // radius scale factor/value (unused for code 6)
    0,
    ...u32be(0), // major axis
    0,
    ...u32be(0), // minor axis
    ...u32be(spec.ni),
    ...u32be(spec.nj),
    ...u32be(0), // basic angle: default
    ...u32be(0), // subdivisions: default
    ...microSigned(spec.la1),
    ...microUnsigned(spec.lo1),
    0x30, // resolution and component flags: increments given, earth-relative winds
    ...microSigned(spec.la2),
    ...microUnsigned(spec.lo2),
    ...u32be(Math.round(spec.di * 1e6)),
    ...u32be(Math.round(spec.dj * 1e6)),
    spec.scanningMode,
  ];
  if (rotated) {
    body.push(
      ...microSigned(spec.southPoleLatitude!),
      ...microUnsigned(spec.southPoleLongitude ?? 0),
      ...f32be(spec.angleOfRotation ?? 0),
    );
  }
  return section(3, body);
}

export interface LambertSpec {
  ni: number;
  nj: number;
  la1: number;
  lo1: number;
  laD: number;
  loV: number;
  dxM: number;
  dyM: number;
  latin1: number;
  latin2: number;
  scanningMode: number;
  projectionCentreFlag?: number;
}

/** Section 3, template 3.30, spherical earth 6 371 229 m (code 6). */
export function section3Lambert(spec: LambertSpec): number[] {
  return section(3, [
    0, // source of grid definition
    ...u32be(spec.ni * spec.nj),
    0,
    0,
    ...u16be(30),
    6, // shape of the earth: sphere 6 371 229 m
    0,
    ...u32be(0),
    0,
    ...u32be(0),
    0,
    ...u32be(0),
    ...u32be(spec.ni),
    ...u32be(spec.nj),
    ...microSigned(spec.la1),
    ...microUnsigned(spec.lo1),
    0x08, // resolution/component flags: uv relative to grid
    ...microSigned(spec.laD),
    ...microUnsigned(spec.loV),
    ...u32be(Math.round(spec.dxM * 1e3)),
    ...u32be(Math.round(spec.dyM * 1e3)),
    spec.projectionCentreFlag ?? 0,
    spec.scanningMode,
    ...microSigned(spec.latin1),
    ...microSigned(spec.latin2),
    ...microSigned(-90),
    ...microUnsigned(0),
  ]);
}

export interface ProductSpec {
  template?: number; // 0 or 1
  parameterCategory: number;
  parameterNumber: number;
  forecastTime?: number;
  indicatorOfUnitOfTimeRange?: number;
  typeOfFirstFixedSurface?: number;
  scaleFactorOfFirstFixedSurface?: number;
  scaledValueOfFirstFixedSurface?: number;
  perturbationNumber?: number;
  numberOfForecastsInEnsemble?: number;
}

/** Section 4, template 4.0 (default) or 4.1. */
export function section4(spec: ProductSpec): number[] {
  const template = spec.template ?? 0;
  const body = [
    ...u16be(0), // NV
    ...u16be(template),
    spec.parameterCategory,
    spec.parameterNumber,
    2, // type of generating process: forecast
    255, // background process
    255, // generating process identifier
    ...u16be(0), // hours after cutoff
    0, // minutes after cutoff
    spec.indicatorOfUnitOfTimeRange ?? 1, // hours by default
    ...u32be(spec.forecastTime ?? 0),
    spec.typeOfFirstFixedSurface ?? 103,
    spec.scaleFactorOfFirstFixedSurface ?? 0,
    ...u32be(spec.scaledValueOfFirstFixedSurface ?? 10),
    255, // second surface: missing
    255,
    ...u32be(0xffffffff),
  ];
  if (template === 1) {
    body.push(1, spec.perturbationNumber ?? 0, spec.numberOfForecastsInEnsemble ?? 21);
  }
  return section(4, body);
}

export interface SimpleSpec {
  numberOfValues: number;
  referenceValue: number;
  binaryScaleFactor: number;
  decimalScaleFactor: number;
  bitsPerValue: number;
}

/** Section 5, DRT 5.0. */
export function section5Simple(spec: SimpleSpec): number[] {
  return section(5, [
    ...u32be(spec.numberOfValues),
    ...u16be(0),
    ...f32be(spec.referenceValue),
    ...i16sm(spec.binaryScaleFactor),
    ...i16sm(spec.decimalScaleFactor),
    spec.bitsPerValue,
    0, // type of original field values: floating point
  ]);
}

export interface ComplexSpec extends SimpleSpec {
  missingValueManagement?: number;
  numberOfGroups: number;
  referenceForGroupWidths?: number;
  bitsForGroupWidths: number;
  referenceForGroupLengths: number;
  lengthIncrement?: number;
  trueLengthOfLastGroup: number;
  bitsForScaledGroupLengths: number;
  /** Present builds DRT 5.3; absent builds 5.2. */
  spatialDifferencingOrder?: number;
  extraOctets?: number;
}

/** Section 5, DRT 5.2 or (with an order) 5.3. */
export function section5Complex(spec: ComplexSpec): number[] {
  const drt53 = spec.spatialDifferencingOrder !== undefined;
  const body = [
    ...u32be(spec.numberOfValues),
    ...u16be(drt53 ? 3 : 2),
    ...f32be(spec.referenceValue),
    ...i16sm(spec.binaryScaleFactor),
    ...i16sm(spec.decimalScaleFactor),
    spec.bitsPerValue,
    0, // type of original field values
    1, // group splitting: general
    spec.missingValueManagement ?? 0,
    ...u32be(0), // primary missing substitute
    ...u32be(0), // secondary missing substitute
    ...u32be(spec.numberOfGroups),
    spec.referenceForGroupWidths ?? 0,
    spec.bitsForGroupWidths,
    ...u32be(spec.referenceForGroupLengths),
    spec.lengthIncrement ?? 1,
    ...u32be(spec.trueLengthOfLastGroup),
    spec.bitsForScaledGroupLengths,
  ];
  if (drt53) {
    body.push(spec.spatialDifferencingOrder!, spec.extraOctets ?? 1);
  }
  return section(5, body);
}

/** Section 6: no bitmap (255), or one bit per grid point (indicator 0). */
export function section6(bitmap?: Array<0 | 1>): number[] {
  if (bitmap === undefined) return section(6, [255]);
  const writer = new BitWriter();
  for (const bit of bitmap) writer.write(bit, 1);
  return section(6, [0, ...writer.bytes()]);
}

export function section7(payload: number[]): number[] {
  return section(7, payload);
}

/** Assembles sections 1..7 (already numbered) into one framed message. */
export function message(discipline: number, ...sections: number[][]): Uint8Array {
  const bodyLength = sections.reduce((total, s) => total + s.length, 0);
  const total = 16 + bodyLength + 4;
  const bytes = [
    0x47,
    0x52,
    0x49,
    0x42, // "GRIB"
    0,
    0, // reserved
    discipline,
    2, // edition
    ...u32be(0),
    ...u32be(total), // 8-octet total length (high half zero)
    ...sections.flat(),
    0x37,
    0x37,
    0x37,
    0x37, // "7777"
  ];
  return new Uint8Array(bytes);
}
