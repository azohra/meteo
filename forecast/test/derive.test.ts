import { describe, expect, it } from "vitest";
import type { ForecastSurface } from "@azohra/meteo.briefing/contract";
import { deriveSiteForecast, type SourceProfile } from "../src/derive.js";

// Envelope filler for derivation tests.
const TEST_SEMANTICS = { gust: "hourMax", precipitation: "windowMeanRate" } as const;

function sourceProfile(): SourceProfile {
  return {
    generatedAt: "2026-07-27T19:00:00Z",
    latitude: 49.291977,
    longitude: -117.183569,
    modelElevationM: 1200,
    referenceTime: "2026-07-27T18:00:00Z",
    siteId: "dundee",
    siteName: "Dundee",
    siteTimeZone: "America/Vancouver",
    hours: [
      {
        cloudCoverPercent: 35,
        dewPointDepressionC: 6,
        latentHeatFluxWm2: 160,
        precipitationMm: 0.2,
        seaLevelPressureHpa: 1012,
        sensibleHeatFluxWm2: 320,
        temperatureC: 24,
        validAt: "2026-07-27T19:00:00Z",
        windDirectionDeg: -20,
        windSpeedMps: 5,
        levels: [
          {
            dewPointDepressionC: 5,
            heightM: 1500,
            pressureHpa: 850,
            temperatureC: 20,
            windDirectionDeg: 270,
            windSpeedMps: 6,
          },
          {
            dewPointDepressionC: 3,
            heightM: 2100,
            pressureHpa: 800,
            temperatureC: 14,
            windDirectionDeg: 280,
            windSpeedMps: 8,
          },
          {
            dewPointDepressionC: 0.4,
            heightM: 2700,
            pressureHpa: 750,
            temperatureC: 8,
            windDirectionDeg: 290,
            windSpeedMps: 10,
          },
        ],
      },
    ],
  };
}

function approx(actual: number, expected: number, absTol: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(absTol);
}

describe("deriveSiteForecast", () => {
  it("publishes the contract envelope with coordinates verbatim", () => {
    const profile = deriveSiteForecast(sourceProfile(), "hrdps-continental", TEST_SEMANTICS);

    expect(profile.schemaVersion).toBe(2);
    expect(profile.model).toBe("hrdps-continental");
    expect(profile.run).toEqual({
      referenceTime: "2026-07-27T18:00:00Z",
      generatedAt: "2026-07-27T19:00:00Z",
    });
    expect(profile.site).toEqual({
      id: "dundee",
      name: "Dundee",
      latitude: 49.291977,
      longitude: -117.183569,
      modelElevationM: 1200,
      timeZone: "America/Vancouver",
    });
  });

  it("omits site timeZone when the source declares none", () => {
    // A source without the catalogue echo publishes no timeZone key —
    // absence, never null.
    const source = sourceProfile();
    delete source.siteTimeZone;

    let profile = deriveSiteForecast(source, "hrdps-continental", TEST_SEMANTICS);

    expect("timeZone" in profile.site).toBe(false);

    source.siteTimeZone = null;
    profile = deriveSiteForecast(source, "hrdps-continental", TEST_SEMANTICS);

    expect("timeZone" in profile.site).toBe(false);
  });

  it("publishes semantics verbatim between site and hours", () => {
    // The builder's transport-semantics declaration lands as the document's
    // own "semantics" block — profiles self-interpret gust and precipitation
    // without a trip to the catalogue — in contract position: after site,
    // before hours.
    const semantics = { gust: "instant", precipitation: "instantRate" } as const;

    const profile = deriveSiteForecast(sourceProfile(), "hrrr-conus", semantics);

    expect(profile.semantics).toEqual(semantics);
    expect(Object.keys(profile)).toEqual([
      "schemaVersion",
      "model",
      "run",
      "site",
      "semantics",
      "hours",
    ]);
  });

  it("omits the gust semantics key for gustless models", () => {
    const profile = deriveSiteForecast(sourceProfile(), "reps", {
      precipitation: "windowMeanRate",
    });

    expect(profile.semantics).toEqual({ precipitation: "windowMeanRate" });
  });

  it("nests a source hour into SI surface, levels, and derived blocks", () => {
    const hour = deriveSiteForecast(sourceProfile(), "hrdps-continental", TEST_SEMANTICS).hours[0];

    expect(hour.surface).toEqual({
      seaLevelPressureHpa: 1012,
      temperatureC: 24,
      dewPointC: 18,
      windSpeedMps: 5,
      windDirectionDeg: 340,
      cloudCoverPercent: 35,
      precipitationMmHr: 0.2,
      sensibleHeatFluxWm2: 320,
      latentHeatFluxWm2: 160,
    });
    // Bolton (1980) eq. 15 by hand: T = 24 C = 297.15 K, Td = 18 C = 291.15 K.
    //   1/(291.15 - 56)          = 1/235.15    = 4.25260e-3
    //   ln(297.15/291.15)/800    = 0.0203988/800 = 2.54985e-5
    //   T_LCL = 1/(4.25260e-3 + 2.54985e-5) + 56 = 233.749 + 56 = 289.749 K
    //   climb = (297.15 - 289.749)/0.0098 = 755.3 m  ->  1200 + 755.3
    // The column's own first saturated height (depression reaches 0.5 C
    // between the 3 C level at 2100 m and the 0.4 C level at 2700 m) is
    // 2676.9 m, above the parcel LCL, so the parcel wins.
    approx(hour.derived.cloudBaseM as number, 1955.26, 0.01);
    expect(hour.derived.boundaryLayerTopM as number).toBeGreaterThan(1200);
    expect(hour.derived.thermalVelocityMps as number).toBeGreaterThan(0);
  });

  it("levels publish dew point and SI wind without display fields", () => {
    const hour = deriveSiteForecast(sourceProfile(), "hrdps-continental", TEST_SEMANTICS).hours[0];

    expect(hour.levels[0]).toEqual({
      pressureHpa: 850,
      heightM: 1500,
      temperatureC: 20,
      dewPointC: 15,
      windSpeedMps: 6,
      windDirectionDeg: 270,
    });
  });

  it("dew point is temperature minus the ECCC depression", () => {
    const source = sourceProfile();
    source.hours[0].dewPointDepressionC = 6.25;
    source.hours[0].levels[1].dewPointDepressionC = -0.5; // supersaturated

    const hour = deriveSiteForecast(source, "hrdps-continental", TEST_SEMANTICS).hours[0];

    expect(hour.surface.dewPointC).toBe(17.75);
    expect(hour.levels[1].dewPointC).toBe(14.5);
  });

  it("does not claim usable lift when surface heating is absent", () => {
    const source = sourceProfile();
    source.hours[0].sensibleHeatFluxWm2 = -20;
    source.hours[0].latentHeatFluxWm2 = 0;

    const derived = deriveSiteForecast(source, "hrdps-continental", TEST_SEMANTICS).hours[0]
      .derived;
    expect(derived.thermalVelocityMps).toBe(0);
    expect(derived.usableLiftTopM).toBeNull();
  });

  it("publishes derived heights unsmoothed hour by hour", () => {
    // The pipeline publishes the raw per-hour derivation so consumers can
    // recover the model's values; smoothing is a renderer option downstream.
    const source = sourceProfile();
    const base = source.hours[0];
    const times = ["2026-07-27T19:00:00Z", "2026-07-27T20:00:00Z", "2026-07-27T21:00:00Z"];
    const depressions = [1, 10, 1];
    source.hours = times.map((validAt, index) => ({
      ...base,
      dewPointDepressionC: depressions[index],
      levels: base.levels.map((level) => ({ ...level })),
      validAt,
    }));

    const hours = deriveSiteForecast(source, "hrdps-continental", TEST_SEMANTICS).hours;

    const cloudBases = hours.map((hour) => hour.derived.cloudBaseM as number);
    approx(cloudBases[0], 1326.81, 0.01);
    approx(cloudBases[1], 2451.42, 0.01);
    approx(cloudBases[2], 1326.81, 0.01);
  });

  it("cloud base drops to a column layer saturated below the parcel LCL", () => {
    const source = sourceProfile();
    // Surface depression 10 C puts the parcel LCL at 1200 + 1251.4 = 2451.4 m
    // (Bolton, as above), but the column saturates lower: depression falls
    // from 4 C at 1500 m through the 0.5 C threshold to 0.2 C at 2100 m.
    // Crossing by hand: (4 - 0.5)/(4 - 0.2) = 0.92105 of the 600 m layer,
    // so 1500 + 552.6 = 2052.6 m — the model's own cloud, below the LCL.
    source.hours[0].dewPointDepressionC = 10;
    const depressions = [4, 0.2, 6];
    source.hours[0].levels.forEach((level, index) => {
      level.dewPointDepressionC = depressions[index];
    });

    const derived = deriveSiteForecast(source, "hrdps-continental", TEST_SEMANTICS).hours[0]
      .derived;

    approx(derived.cloudBaseM as number, 2052.63, 0.01);
  });

  it("a dry column publishes the parcel LCL even above the sounding top", () => {
    const source = sourceProfile();
    // Depression 20 C: Bolton puts the LCL 2467.3 m above terrain — higher
    // than every retained level — and no level saturates, so the parcel
    // estimate stands on its own.
    source.hours[0].dewPointDepressionC = 20;
    const depressions = [12, 15, 14];
    source.hours[0].levels.forEach((level, index) => {
      level.dewPointDepressionC = depressions[index];
    });

    const derived = deriveSiteForecast(source, "hrdps-continental", TEST_SEMANTICS).hours[0]
      .derived;

    approx(derived.cloudBaseM as number, 3667.27, 0.01);
  });

  it("a supersaturated surface puts cloud base at model terrain", () => {
    const source = sourceProfile();
    source.hours[0].dewPointDepressionC = -1; // data noise: Td above T

    const derived = deriveSiteForecast(source, "hrdps-continental", TEST_SEMANTICS).hours[0]
      .derived;

    expect(derived.cloudBaseM).toBe(1200);
  });

  it("publishes every source hour chronologically", () => {
    // Every source hour is published; day windowing is a renderer concern.
    const source = sourceProfile();
    const base = source.hours[0];
    const times = [
      "2026-07-27T14:00:00Z",
      "2026-07-28T03:00:00Z", // 20:00 and 03:00 previous-day Pacific
      "2026-07-28T09:00:00Z",
      "2026-07-28T14:00:00Z",
    ];
    source.hours = times.map((validAt) => ({
      ...base,
      levels: base.levels.map((level) => ({ ...level })),
      validAt,
    }));

    const hours = deriveSiteForecast(source, "hrdps-continental", TEST_SEMANTICS).hours;

    expect(hours.map((hour) => hour.validAt)).toEqual(times);
  });

  it("optional science fields pass through in contract order", () => {
    const source = sourceProfile();
    Object.assign(source.hours[0], {
      windGustMps: 11.4,
      capeJkg: 850.0,
      cinJkg: -55.0,
      pblHeightM: 1650.0,
      lowCloudPercent: 62.0,
      midCloudPercent: 18.0,
      highCloudPercent: 4.0,
    });

    const surface = deriveSiteForecast(source, "hrrr-conus", TEST_SEMANTICS).hours[0].surface;

    expect(surface.windGustMps).toBe(11.4);
    expect(surface.capeJkg).toBe(850.0);
    expect(surface.cinJkg).toBe(-55.0);
    expect(surface.pblHeightM).toBe(1650.0);
    expect(surface.lowCloudPercent).toBe(62.0);
    expect(surface.midCloudPercent).toBe(18.0);
    expect(surface.highCloudPercent).toBe(4.0);
    // Object key order is the published contract order, for clean diffs.
    expect(Object.keys(surface).slice(-7)).toEqual([
      "windGustMps",
      "capeJkg",
      "cinJkg",
      "pblHeightM",
      "lowCloudPercent",
      "midCloudPercent",
      "highCloudPercent",
    ]);
  });

  it("absent science fields stay absent, not null", () => {
    const surface = deriveSiteForecast(sourceProfile(), "hrdps-continental", TEST_SEMANTICS)
      .hours[0].surface;
    for (const field of ["windGustMps", "capeJkg", "cinJkg", "pblHeightM", "lowCloudPercent"]) {
      expect(field in surface, field).toBe(false);
    }
  });

  it("science fields are clamped to their physical signs", () => {
    const source = sourceProfile();
    // Resampling noise: slightly negative CAPE/gust/PBL, positive CIN,
    // cloud fraction past 100.
    Object.assign(source.hours[0], {
      windGustMps: -0.2,
      capeJkg: -0.4,
      cinJkg: 0.3,
      pblHeightM: -1.0,
      lowCloudPercent: 100.4,
    });

    const surface: ForecastSurface = deriveSiteForecast(source, "gfs", TEST_SEMANTICS).hours[0]
      .surface;

    expect(surface.windGustMps).toBe(0.0);
    expect(surface.capeJkg).toBe(0.0);
    expect(surface.cinJkg).toBe(0.0);
    expect(surface.pblHeightM).toBe(0.0);
    expect(surface.lowCloudPercent).toBe(100.0);
  });

  it("levels carry cloud fraction only where the source has it", () => {
    const source = sourceProfile();
    source.hours[0].levels[0].cloudFractionPercent = 85.0;

    const levels = deriveSiteForecast(source, "gfs", TEST_SEMANTICS).hours[0].levels;

    expect(levels[0].cloudFractionPercent).toBe(85.0);
    for (const level of levels.slice(1)) {
      expect("cloudFractionPercent" in level).toBe(false);
    }
  });

  it("normalizes wind directions including negatives", () => {
    const source = sourceProfile();
    source.hours[0].windDirectionDeg = -370;
    const hour = deriveSiteForecast(source, "hrdps-continental", TEST_SEMANTICS).hours[0];
    expect(hour.surface.windDirectionDeg).toBe(350);
  });
});
