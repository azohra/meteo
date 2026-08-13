import { describe, expect, it } from "vitest";
import {
  buoyancyShearRatio,
  surfaceToBoundaryLayerShearMps,
  vectorShearMps,
} from "../src/derive/shear.js";

describe("vectorShearMps", () => {
  it("is zero for identical winds", () => {
    expect(
      vectorShearMps(
        { windSpeedMps: 6, windDirectionDeg: 245 },
        { windSpeedMps: 6, windDirectionDeg: 245 },
      ),
    ).toBeCloseTo(0, 10);
  });

  it("is zero between two calm levels", () => {
    expect(
      vectorShearMps(
        { windSpeedMps: 0, windDirectionDeg: 0 },
        { windSpeedMps: 0, windDirectionDeg: 0 },
      ),
    ).toBe(0);
  });

  it("adds speeds for opposed directions", () => {
    expect(
      vectorShearMps(
        { windSpeedMps: 5, windDirectionDeg: 0 },
        { windSpeedMps: 5, windDirectionDeg: 180 },
      ),
    ).toBeCloseTo(10, 10);
  });

  it("composes perpendicular winds vectorially (3-4-5)", () => {
    expect(
      vectorShearMps(
        { windSpeedMps: 3, windDirectionDeg: 180 },
        { windSpeedMps: 4, windDirectionDeg: 270 },
      ),
    ).toBeCloseTo(5, 10);
  });
});

describe("surfaceToBoundaryLayerShearMps", () => {
  const base = {
    surfaceWind: { windSpeedMps: 0, windDirectionDeg: 0 },
    modelElevationM: 1000,
    levels: [
      { heightM: 2000, windSpeedMps: 10, windDirectionDeg: 270 },
      { heightM: 3000, windSpeedMps: 20, windDirectionDeg: 270 },
    ],
  };

  it("interpolates the wind at the boundary-layer top", () => {
    expect(surfaceToBoundaryLayerShearMps({ ...base, boundaryLayerTopM: 1500 })).toBeCloseTo(5, 10);
  });

  it("interpolates between levels above the first", () => {
    expect(surfaceToBoundaryLayerShearMps({ ...base, boundaryLayerTopM: 2500 })).toBeCloseTo(
      15,
      10,
    );
  });

  it("is null when the hour has no boundary layer", () => {
    expect(surfaceToBoundaryLayerShearMps({ ...base, boundaryLayerTopM: null })).toBeNull();
  });

  it("is null when the model publishes no levels", () => {
    expect(
      surfaceToBoundaryLayerShearMps({ ...base, levels: [], boundaryLayerTopM: 1500 }),
    ).toBeNull();
  });

  it("clamps a BL top above the column to the highest level's wind", () => {
    expect(surfaceToBoundaryLayerShearMps({ ...base, boundaryLayerTopM: 9000 })).toBeCloseTo(
      20,
      10,
    );
  });

  it("shears the surface against itself below model elevation", () => {
    expect(surfaceToBoundaryLayerShearMps({ ...base, boundaryLayerTopM: 900 })).toBeCloseTo(0, 10);
  });

  it("subtracts a non-calm surface wind vectorially", () => {
    expect(
      surfaceToBoundaryLayerShearMps({
        ...base,
        surfaceWind: { windSpeedMps: 5, windDirectionDeg: 270 },
        boundaryLayerTopM: 2000,
      }),
    ).toBeCloseTo(5, 10);
  });
});

describe("buoyancyShearRatio", () => {
  it("divides W* by the boundary-layer shear", () => {
    expect(buoyancyShearRatio(2, 4)).toBeCloseTo(0.5, 10);
    expect(buoyancyShearRatio(1.63, 0.5)).toBeCloseTo(3.26, 10);
  });

  it("is unbounded when thermals rise through zero shear", () => {
    expect(buoyancyShearRatio(1.63, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it("is undefined with neither thermals nor shear", () => {
    expect(buoyancyShearRatio(0, 0)).toBeNull();
  });

  it("is zero when there are no thermals but some shear", () => {
    expect(buoyancyShearRatio(0, 3)).toBe(0);
  });
});
