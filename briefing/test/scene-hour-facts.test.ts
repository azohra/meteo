import { describe, expect, it } from "vitest";
import { buildMeteogramScene } from "../src/scene/index.js";
import { deterministicSceneProfile, scienceSceneProfile } from "../test/scene-fixtures.js";

const TZ = { timeZone: "America/Vancouver" };

describe("HourSampling.cloudCapped", () => {
  it("is null while the hour has no usable-lift top — never false-by-default", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), TZ);
    // Hours 0 and 1 publish usableLiftTopM: null; every later hour tops
    // out well below the fixture's cloud base.
    expect(scene.sampling.map((hour) => hour.cloudCapped)).toEqual([
      null,
      null,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("reports true where the published lift top reaches the published cloud base", () => {
    const profile = deterministicSceneProfile();
    profile.hours[4].derived.usableLiftTopM = profile.hours[4].derived.cloudBaseM;
    // Published documents round heights to 0.1 m; a fraction of a metre
    // under cloud base is still the cap binding.
    profile.hours[5].derived.usableLiftTopM = (profile.hours[5].derived.cloudBaseM as number) - 0.5;
    const scene = buildMeteogramScene(profile, TZ);
    expect(scene.sampling[4].cloudCapped).toBe(true);
    expect(scene.sampling[5].cloudCapped).toBe(true);
    expect(scene.sampling[3].cloudCapped).toBe(false);
  });
});

describe("HourSampling.capeCapped", () => {
  it("is null when the model publishes no CAPE or no CIN — HRDPS-style absence is not 'no cap'", () => {
    const noScience = buildMeteogramScene(deterministicSceneProfile(), TZ);
    expect(noScience.sampling.every((hour) => hour.capeCapped === null)).toBe(true);

    const capeOnly = scienceSceneProfile();
    for (const hour of capeOnly.hours) delete hour.surface.cinJkg;
    const scene = buildMeteogramScene(capeOnly, TZ);
    expect(scene.sampling.every((hour) => hour.capeCapped === null)).toBe(true);
    // Without CIN, no cell dims either — the strip and the fact agree.
    const strip = scene.strips.find((entry) => entry.key === "cape")!;
    expect(strip.cells!.every((cell) => !cell!.className.includes("meteo-gram-cape-capped"))).toBe(
      true,
    );
  });

  it("is exactly the CAPE strip's dimmed-cell computation, hour by hour", () => {
    const scene = buildMeteogramScene(scienceSceneProfile(), TZ);
    expect(scene.sampling.map((hour) => hour.capeCapped)).toEqual([
      false,
      true,
      false,
      true,
      false,
      false,
    ]);
    const strip = scene.strips.find((entry) => entry.key === "cape")!;
    strip.cells!.forEach((cell, index) => {
      expect(cell!.className.includes("meteo-gram-cape-capped")).toBe(
        scene.sampling[index].capeCapped === true,
      );
    });
  });

  it("moves with options.capeClasses, keeping the strip and the fact on one computation", () => {
    const scene = buildMeteogramScene(scienceSceneProfile(), {
      ...TZ,
      capeClasses: { watchJkg: 100, riskJkg: 500, severeJkg: 1000, cappedCinJkg: -100 },
    });
    expect(scene.sampling.map((hour) => hour.capeCapped)).toEqual([
      false,
      false,
      false,
      true,
      false,
      false,
    ]);
  });
});
