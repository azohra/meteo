import { allOnes, float32be, i8sm, i32sm, u8, u16, u32 } from "./bytes.js";

/** Scanning-mode and storage facts shared by all supported templates. */
export interface GridBase {
  gridDefinitionTemplateNumber: number;
  numberOfDataPoints: number;
  ni: number;
  nj: number;
  scanningMode: number;
  iScansNegatively: boolean;
  jScansPositively: boolean;
  jPointsAreConsecutive: boolean;
  alternativeRowScanning: boolean;
  resolutionAndComponentFlags: number;
  /** Winds are grid-relative rather than earth-relative. */
  uvRelativeToGrid: boolean;
  earthRadiusM: number;
  /** FNV-1a 64 of the raw section 3 bytes — stable per grid definition. */
  gridKey: string;
}

/** Template 3.0 — latitude/longitude. */
export interface LatLonGrid extends GridBase {
  kind: "latlon";
  latitudeOfFirstGridPoint: number;
  longitudeOfFirstGridPoint: number;
  latitudeOfLastGridPoint: number;
  longitudeOfLastGridPoint: number;
  iDirectionIncrement: number;
  jDirectionIncrement: number;
}

/** Template 3.1 — rotated latitude/longitude. First/last points and
 * increments are in the rotated frame. */
export interface RotatedLatLonGrid extends Omit<LatLonGrid, "kind"> {
  kind: "rotated";
  southPoleLatitude: number;
  southPoleLongitude: number;
  /** Always 0 on observed feeds; the nearest-point rotation refuses
   * anything else. */
  angleOfRotation: number;
}

/** Template 3.30 — Lambert conformal (secant or tangent, spherical). */
export interface LambertGrid extends GridBase {
  kind: "lambert";
  latitudeOfFirstGridPoint: number;
  longitudeOfFirstGridPoint: number;
  /** Latitude where Dx and Dy are true. */
  laD: number;
  /** Orientation longitude (grid-north meridian). */
  loV: number;
  dxM: number;
  dyM: number;
  projectionCentreFlag: number;
  latin1: number;
  latin2: number;
  southPoleLatitude: number;
  southPoleLongitude: number;
}

export type Grid = LatLonGrid | RotatedLatLonGrid | LambertGrid;

/** FNV-1a 64-bit hash of the raw section 3 bytes, hex-encoded. */
export function gridKey(section3: Uint8Array): string {
  const prime = 0x100000001b3n;
  let hash = 0xcbf29ce484222325n;
  const mask = 0xffffffffffffffffn;
  for (const byte of section3) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

const MICRODEGREES = 1e-6;

function earthRadiusM(section3: Uint8Array): number {
  const shape = u8(section3, 14);
  switch (shape) {
    case 0:
      return 6367470;
    case 1: {
      const scaleFactor = i8sm(section3, 15);
      const scaledValue = u32(section3, 16);
      if (scaledValue === 0) {
        throw new Error("GRIB shapeOfTheEarth=1 with a zero radius");
      }
      return scaledValue * 10 ** -scaleFactor;
    }
    case 6:
      return 6371229;
    case 8:
      return 6371200;
    default:
      throw new Error(
        `GRIB shapeOfTheEarth=${shape} is not supported (spherical codes 0, 1, 6, 8 only — ` +
          "oblate earths would need ellipsoidal nearest-point math this decoder does not pretend to have)",
      );
  }
}

function scanningFlags(scanningMode: number) {
  return {
    scanningMode,
    iScansNegatively: (scanningMode & 0x80) !== 0,
    jScansPositively: (scanningMode & 0x40) !== 0,
    jPointsAreConsecutive: (scanningMode & 0x20) !== 0,
    alternativeRowScanning: (scanningMode & 0x10) !== 0,
  };
}

function requireDefaultAngleUnit(section3: Uint8Array): void {
  const basicAngle = u32(section3, 38);
  const subdivisions = u32(section3, 42);
  const missing = allOnes(32);
  const defaulted = (value: number) => value === 0 || value === missing;
  if (!defaulted(basicAngle) || !defaulted(subdivisions)) {
    throw new Error(
      `GRIB basic angle ${basicAngle}/${subdivisions} is not the 10^-6 degree default; ` +
        "no observed feed uses another unit, so this decoder refuses to guess",
    );
  }
}

function requireIncrement(value: number, name: string): number {
  if (value === allOnes(32) || value === 0) {
    throw new Error(`GRIB grid carries no ${name}; O(1) lookup needs explicit increments`);
  }
  return value;
}

/** Parses a raw section 3 (bytes include the 5-octet section header). */
export function parseGrid(section3: Uint8Array): Grid {
  if (u8(section3, 4) !== 3) {
    throw new Error(`expected GRIB section 3, got section ${u8(section3, 4)}`);
  }
  if (u8(section3, 5) !== 0) {
    throw new Error("GRIB grid definition source is not template-defined (octet 6 != 0)");
  }
  if (u8(section3, 10) !== 0) {
    throw new Error("quasi-regular GRIB grids (octet 11 != 0) are not supported");
  }
  const template = u16(section3, 12);
  const numberOfDataPoints = u32(section3, 6);
  const key = gridKey(section3);

  if (template === 0 || template === 1) {
    requireDefaultAngleUnit(section3);
    const base = {
      gridDefinitionTemplateNumber: template,
      numberOfDataPoints,
      ni: u32(section3, 30),
      nj: u32(section3, 34),
      ...scanningFlags(u8(section3, 71)),
      resolutionAndComponentFlags: u8(section3, 54),
      uvRelativeToGrid: (u8(section3, 54) & 0x08) !== 0,
      earthRadiusM: earthRadiusM(section3),
      gridKey: key,
      latitudeOfFirstGridPoint: i32sm(section3, 46) * MICRODEGREES,
      longitudeOfFirstGridPoint: u32(section3, 50) * MICRODEGREES,
      latitudeOfLastGridPoint: i32sm(section3, 55) * MICRODEGREES,
      longitudeOfLastGridPoint: u32(section3, 59) * MICRODEGREES,
      iDirectionIncrement: requireIncrement(u32(section3, 63), "i increment") * MICRODEGREES,
      jDirectionIncrement: requireIncrement(u32(section3, 67), "j increment") * MICRODEGREES,
    };
    if (template === 0) return { kind: "latlon", ...base };
    return {
      kind: "rotated",
      ...base,
      southPoleLatitude: i32sm(section3, 72) * MICRODEGREES,
      southPoleLongitude: u32(section3, 76) * MICRODEGREES,
      angleOfRotation: float32be(section3, 80),
    };
  }

  if (template === 30) {
    return {
      kind: "lambert",
      gridDefinitionTemplateNumber: template,
      numberOfDataPoints,
      ni: u32(section3, 30),
      nj: u32(section3, 34),
      ...scanningFlags(u8(section3, 64)),
      resolutionAndComponentFlags: u8(section3, 46),
      uvRelativeToGrid: (u8(section3, 46) & 0x08) !== 0,
      earthRadiusM: earthRadiusM(section3),
      gridKey: key,
      latitudeOfFirstGridPoint: i32sm(section3, 38) * MICRODEGREES,
      longitudeOfFirstGridPoint: u32(section3, 42) * MICRODEGREES,
      laD: i32sm(section3, 47) * MICRODEGREES,
      loV: u32(section3, 51) * MICRODEGREES,
      dxM: u32(section3, 55) * 1e-3,
      dyM: u32(section3, 59) * 1e-3,
      projectionCentreFlag: u8(section3, 63),
      latin1: i32sm(section3, 65) * MICRODEGREES,
      latin2: i32sm(section3, 69) * MICRODEGREES,
      southPoleLatitude: i32sm(section3, 73) * MICRODEGREES,
      southPoleLongitude: u32(section3, 77) * MICRODEGREES,
    };
  }

  throw new Error(`GRIB grid definition template 3.${template} is not supported (3.0, 3.1, 3.30)`);
}
