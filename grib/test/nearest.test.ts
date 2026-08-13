import { describe, expect, it } from "vitest";
import { fromRotated, nearestGridpoint, parseGrid } from "../src/index.js";
import type { Grid } from "../src/index.js";
import { section3Lambert, section3LatLon } from "./helpers/synthetic.js";

function grid(spec: Parameters<typeof section3LatLon>[0]): Grid {
  return parseGrid(new Uint8Array(section3LatLon(spec)));
}

/** A GFS-shaped global grid: 0.25°, north-to-south, 0..360. */
const GFS = grid({
  ni: 1440,
  nj: 721,
  la1: 90,
  lo1: 0,
  la2: -90,
  lo2: 359.75,
  di: 0.25,
  dj: 0.25,
  scanningMode: 0x00, // i east, j north-to-south
});

describe("regular lat-lon", () => {
  it("finds the gridpoint ecCodes finds, negative-west longitude included", () => {
    const nearest = nearestGridpoint(GFS, 49.291977, -117.183569);
    expect(nearest.index).toBe(163 * 1440 + 971);
    expect(nearest.latitude).toBe(49.25);
    expect(nearest.longitude).toBe(242.75);
    expect(nearest.distanceKm).toBeGreaterThan(0);
  });

  it("wraps the seam: a point just west of Greenwich maps to column 0", () => {
    const nearest = nearestGridpoint(GFS, 0, -0.05);
    expect(nearest.longitude).toBe(0);
    expect(nearest.index % 1440).toBe(0);
  });

  it("clamps out-of-domain points and reports the true distance instead of throwing", () => {
    const small = grid({
      ni: 3,
      nj: 3,
      la1: 49,
      lo1: 242,
      la2: 49.2,
      lo2: 242.2,
      di: 0.1,
      dj: 0.1,
      scanningMode: 0x40,
    });
    const nearest = nearestGridpoint(small, -30, 10);
    expect(nearest.distanceKm).toBeGreaterThan(5000);
    expect(nearest.index).toBeGreaterThanOrEqual(0);
    expect(nearest.index).toBeLessThan(9);
  });

  it("respects j scan direction", () => {
    const south = grid({
      ni: 4,
      nj: 3,
      la1: 49,
      lo1: 242,
      la2: 49.2,
      lo2: 242.3,
      di: 0.1,
      dj: 0.1,
      scanningMode: 0x40, // j scans positively: row 0 is the SOUTH edge
    });
    expect(nearestGridpoint(south, 49.0, -117.9).index).toBe(1); // (c=1, r=0)
    expect(nearestGridpoint(south, 49.2, -117.9).index).toBe(2 * 4 + 1);
  });
});

describe("rotated lat-lon", () => {
  it("matches the unrotated grid under the identity pole", () => {
    const plain = grid({
      ni: 4,
      nj: 3,
      la1: 49,
      lo1: 242,
      la2: 49.2,
      lo2: 242.3,
      di: 0.1,
      dj: 0.1,
      scanningMode: 0x40,
    });
    const identity = grid({
      ni: 4,
      nj: 3,
      la1: 49,
      lo1: 242,
      la2: 49.2,
      lo2: 242.3,
      di: 0.1,
      dj: 0.1,
      scanningMode: 0x40,
      southPoleLatitude: -90,
      southPoleLongitude: 0,
    });
    const fromPlain = nearestGridpoint(plain, 49.13, -117.94);
    const fromRotated = nearestGridpoint(identity, 49.13, -117.94);
    expect(fromRotated.index).toBe(fromPlain.index);
    expect(fromRotated.latitude).toBeCloseTo(fromPlain.latitude, 9);
    expect(fromRotated.distanceKm).toBeCloseTo(fromPlain.distanceKm, 9);
  });

  it("REFUSES a non-zero angle of rotation rather than geolocating wrong", () => {
    const angled = grid({
      ni: 4,
      nj: 3,
      la1: 49,
      lo1: 242,
      la2: 49.2,
      lo2: 242.3,
      di: 0.1,
      dj: 0.1,
      scanningMode: 0x40,
      southPoleLatitude: -30,
      southPoleLongitude: 250,
      angleOfRotation: 15,
    });
    expect(() => nearestGridpoint(angled, 49, -117)).toThrow(/angleOfRotation/);
  });

  it("returns a gridpoint whose rotated coordinates lie on the grid (REPS pole)", () => {
    const reps = grid({
      ni: 10,
      nj: 10,
      la1: 5,
      lo1: 350,
      la2: 5.9,
      lo2: 350.9,
      di: 0.1,
      dj: 0.1,
      scanningMode: 0x40,
      southPoleLatitude: -25.64728,
      southPoleLongitude: 269.555534,
    });
    // The centre of the tiny rotated patch, queried in geographic terms:
    // whatever comes back must be within one cell diagonal (~15 km at 0.1°).
    const centre = fromRotated(5.45, 350.45, -25.64728, 269.555534);
    const probe = nearestGridpoint(reps, centre.latitude, centre.longitude);
    expect(probe.distanceKm).toBeLessThan(8);
  });
});

describe("Lambert conformal", () => {
  // The HRRR CONUS projection.
  const HRRR = parseGrid(
    new Uint8Array(
      section3Lambert({
        ni: 1799,
        nj: 1059,
        la1: 21.138123,
        lo1: 237.280472,
        laD: 38.5,
        loV: 262.5,
        dxM: 3000,
        dyM: 3000,
        latin1: 38.5,
        latin2: 38.5,
        scanningMode: 0x40,
      }),
    ),
  );

  it("returns the first gridpoint, at zero distance, for its own coordinates", () => {
    const nearest = nearestGridpoint(HRRR, 21.138123, 237.280472);
    expect(nearest.index).toBe(0);
    expect(nearest.distanceKm).toBeLessThan(0.001);
  });

  it("steps one column east for a point one Dx along the x axis", () => {
    const neighbour = nearestGridpoint(HRRR, 21.14, 237.31);
    expect(neighbour.index).toBe(1);
  });

  it("accepts negative-west longitudes", () => {
    const west = nearestGridpoint(HRRR, 21.138123, 237.280472 - 360);
    expect(west.index).toBe(0);
  });
});
