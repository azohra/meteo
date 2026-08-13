import { describe, expect, it } from "vitest";
import {
  earthWind,
  lambertConeConstant,
  lambertEarthWind,
  lambertGridRotationDeg,
} from "../src/index.js";

const REPS_SOUTH_POLE = [-25.64728, 269.555534] as const;
const DUNDEE = [49.291977, -117.183569] as const;

describe("earthWind (rotated lat-lon)", () => {
  it("leaves the wind alone when the rotated south pole is the true south pole (identity)", () => {
    const [east, north] = earthWind(3, 4, 49.3, -117.2, -90, 0);
    expect(east).toBeCloseTo(3, 12);
    expect(north).toBeCloseTo(4, 12);
  });

  it("turns the wind a quarter circle under an equatorial pole", () => {
    // South pole of rotation on the equator at 0°E puts the rotated north
    // pole at (0°, 180°). At the geographic point (0°, 90°E) grid-north
    // points toward (0°, 180°) — due true east — and grid-east points at
    // the rotated south pole — due true south.
    const [east1, north1] = earthWind(1, 0, 0, 90, 0, 0);
    expect(east1).toBeCloseTo(0, 12);
    expect(north1).toBeCloseTo(-1, 12);

    const [east2, north2] = earthWind(0, 1, 0, 90, 0, 0);
    expect(east2).toBeCloseTo(1, 12);
    expect(north2).toBeCloseTo(0, 12);
  });

  it("conserves wind speed on the REPS grid", () => {
    const [east, north] = earthWind(3, -4, ...DUNDEE, ...REPS_SOUTH_POLE);
    expect(Math.hypot(east, north)).toBeCloseTo(5, 12);
  });

  it("points grid-north along the bearing to the rotated pole", () => {
    // Independent geometry: grid-north lies on the rotated meridian, so a
    // pure grid-north wind must point along the great-circle initial
    // bearing from the site to the rotated north pole.
    const poleLatitude = -REPS_SOUTH_POLE[0];
    const poleLongitude = REPS_SOUTH_POLE[1] - 180;
    const [lat1, lon1] = DUNDEE.map((d) => (d * Math.PI) / 180) as [number, number];
    const lat2 = (poleLatitude * Math.PI) / 180;
    const lon2 = (poleLongitude * Math.PI) / 180;
    const bearing =
      ((Math.atan2(
        Math.sin(lon2 - lon1) * Math.cos(lat2),
        Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1),
      ) *
        180) /
        Math.PI +
        360) %
      360;

    const [east, north] = earthWind(0, 1, ...DUNDEE, ...REPS_SOUTH_POLE);
    const pointsToward = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
    expect(pointsToward).toBeCloseTo(bearing, 9);
  });
});

const HRRR = { orientation: 262.5, cone: Math.sin((38.5 * Math.PI) / 180) };
const NAM_PARENT = { orientation: 265.0, cone: Math.sin((25.0 * Math.PI) / 180) };

describe("lambertGridRotationDeg", () => {
  it("is zero on each product's own orientation meridian", () => {
    expect(lambertGridRotationDeg(262.5, HRRR.orientation, HRRR.cone)).toBe(0);
    expect(lambertGridRotationDeg(265.0, NAM_PARENT.orientation, NAM_PARENT.cone)).toBe(0);
  });

  it("matches the documented biases at the catalogued sites' longitude", () => {
    // −117.7°W is 242.3°E; sin(38.5°) × (242.3 − 262.5) ≈ −12.6°.
    expect(lambertGridRotationDeg(242.3, HRRR.orientation, HRRR.cone)).toBeCloseTo(-12.575, 3);
    expect(lambertGridRotationDeg(-117.7, HRRR.orientation, HRRR.cone)).toBeCloseTo(
      lambertGridRotationDeg(242.3, HRRR.orientation, HRRR.cone),
      12,
    );
    // The parent's cone is sin(25°) about LoV 265°: sin(25°) × (242.3 − 265) ≈ −9.6°.
    expect(lambertGridRotationDeg(242.3, NAM_PARENT.orientation, NAM_PARENT.cone)).toBeCloseTo(
      -9.593,
      3,
    );
  });
});

describe("lambertEarthWind", () => {
  it("preserves speed and shifts direction by the local angle", () => {
    const windFromUv = (u: number, v: number) => ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;

    const [uEarth, vEarth] = lambertEarthWind(
      0,
      10,
      242.3,
      NAM_PARENT.orientation,
      NAM_PARENT.cone,
    );
    expect(Math.hypot(uEarth, vEarth)).toBeCloseTo(10, 9);
    expect(windFromUv(uEarth, vEarth)).toBeCloseTo(
      180 + lambertGridRotationDeg(242.3, NAM_PARENT.orientation, NAM_PARENT.cone),
      9,
    );
  });

  it("is orthogonal for an arbitrary wind", () => {
    const [uEarth, vEarth] = lambertEarthWind(-7.3, 2.1, 250.0, HRRR.orientation, HRRR.cone);
    expect(Math.hypot(uEarth, vEarth)).toBeCloseTo(Math.hypot(-7.3, 2.1), 9);
  });
});

describe("lambertConeConstant", () => {
  it("is sin(Latin1) for a tangent cone", () => {
    expect(lambertConeConstant(38.5, 38.5)).toBe(Math.sin((38.5 * Math.PI) / 180));
  });

  it("approaches the tangent value as the parallels converge", () => {
    expect(lambertConeConstant(38.4, 38.6)).toBeCloseTo(Math.sin((38.5 * Math.PI) / 180), 5);
  });
});
