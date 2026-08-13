import { describe, expect, it } from "vitest";
import { parseProduct, parseGrid, gridKey } from "../src/index.js";
import { section3Lambert, section3LatLon, section4 } from "./helpers/synthetic.js";

describe("parseProduct", () => {
  it("exposes forecastTime raw with its unit, never converted — HRDPS publishes minutes", () => {
    const product = parseProduct(
      new Uint8Array(
        section4({
          parameterCategory: 0,
          parameterNumber: 0,
          forecastTime: 60,
          indicatorOfUnitOfTimeRange: 0, // minutes
          typeOfFirstFixedSurface: 103,
          scaledValueOfFirstFixedSurface: 2,
        }),
      ),
    );
    expect(product.productDefinitionTemplateNumber).toBe(0);
    expect(product.forecastTime).toBe(60);
    expect(product.indicatorOfUnitOfTimeRange).toBe(0);
    expect(product.typeOfFirstFixedSurface).toBe(103);
    expect(product.scaleFactorOfFirstFixedSurface).toBe(0);
    expect(product.scaledValueOfFirstFixedSurface).toBe(2);
    expect(product.typeOfSecondFixedSurface).toBeUndefined();
    expect(product.perturbationNumber).toBeUndefined();
  });

  it("parses template 4.1's ensemble block", () => {
    const product = parseProduct(
      new Uint8Array(
        section4({
          template: 1,
          parameterCategory: 2,
          parameterNumber: 2,
          perturbationNumber: 7,
          numberOfForecastsInEnsemble: 21,
        }),
      ),
    );
    expect(product.productDefinitionTemplateNumber).toBe(1);
    expect(product.perturbationNumber).toBe(7);
    expect(product.numberOfForecastsInEnsemble).toBe(21);
  });

  it("keeps template-specific fields ABSENT on templates it does not parse", () => {
    const raw = section4({ parameterCategory: 20, parameterNumber: 0, forecastTime: 1 });
    raw[8] = 48; // template 4.48 (aerosol)
    const product = parseProduct(new Uint8Array(raw));
    expect(product.productDefinitionTemplateNumber).toBe(48);
    expect(product.parameterCategory).toBe(20); // octets 10-11 are template-invariant
    expect(product.parameterNumber).toBe(0);
    expect(product.forecastTime).toBeUndefined();
    expect(product.typeOfFirstFixedSurface).toBeUndefined();
  });
});

describe("parseGrid", () => {
  it("exposes scanning-mode flags and grid shape", () => {
    const grid = parseGrid(
      new Uint8Array(
        section3LatLon({
          ni: 4,
          nj: 3,
          la1: -12.3,
          lo1: 345.2,
          la2: -12.1,
          lo2: 345.5,
          di: 0.1,
          dj: 0.1,
          scanningMode: 0x40,
          southPoleLatitude: -36.0885,
          southPoleLongitude: 245.305,
        }),
      ),
    );
    expect(grid.kind).toBe("rotated");
    expect(grid.ni).toBe(4);
    expect(grid.nj).toBe(3);
    expect(grid.iScansNegatively).toBe(false);
    expect(grid.jScansPositively).toBe(true);
    expect(grid.jPointsAreConsecutive).toBe(false);
    expect(grid.alternativeRowScanning).toBe(false);
    expect(grid.earthRadiusM).toBe(6371229);
    if (grid.kind === "rotated") {
      expect(grid.southPoleLatitude).toBeCloseTo(-36.0885, 9);
      expect(grid.southPoleLongitude).toBeCloseTo(245.305, 9);
      expect(grid.angleOfRotation).toBe(0);
    }
  });

  it("parses the full Lambert template", () => {
    const grid = parseGrid(
      new Uint8Array(
        section3Lambert({
          ni: 614,
          nj: 428,
          la1: 12.19,
          lo1: 226.541,
          laD: 25,
          loV: 265,
          dxM: 12191,
          dyM: 12191,
          latin1: 25,
          latin2: 25,
          scanningMode: 0x40,
        }),
      ),
    );
    expect(grid.kind).toBe("lambert");
    if (grid.kind === "lambert") {
      expect(grid.loV).toBeCloseTo(265, 9);
      expect(grid.laD).toBeCloseTo(25, 9);
      expect(grid.dxM).toBe(12191);
      expect(grid.latin1).toBeCloseTo(25, 9);
      expect(grid.uvRelativeToGrid).toBe(true);
    }
  });

  it("keys grids by their raw section-3 bytes", () => {
    const spec = {
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
    const a = new Uint8Array(section3LatLon(spec));
    const b = new Uint8Array(section3LatLon(spec));
    const c = new Uint8Array(section3LatLon({ ...spec, la1: 49.1 }));
    expect(gridKey(a)).toBe(gridKey(b));
    expect(gridKey(a)).not.toBe(gridKey(c));
    expect(gridKey(a)).toMatch(/^[0-9a-f]{16}$/);
    expect(parseGrid(a).gridKey).toBe(gridKey(a));
  });

  it("refuses an oblate earth rather than pretending it is a sphere", () => {
    const raw = section3LatLon({
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
    raw[14] = 4; // shapeOfTheEarth: IAG-GRS80 oblate
    expect(() => parseGrid(new Uint8Array(raw))).toThrow(/shapeOfTheEarth=4/);
  });

  it("reads a scaled spherical radius (shape 1)", () => {
    const raw = section3LatLon({
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
    raw[14] = 1;
    raw[15] = 0; // scale factor 0
    raw[16] = 0x00;
    raw[17] = 0x61;
    raw[18] = 0x37;
    raw[19] = 0x4d; // 6371149
    expect(parseGrid(new Uint8Array(raw)).earthRadiusM).toBe(6371149);
  });
});
