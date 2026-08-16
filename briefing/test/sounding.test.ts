import { describe, expect, it } from "vitest";
import {
  buildSoundingKeySpec,
  buildSoundingScene,
  readingAtAltitude,
  renderSoundingSvg,
  yForAltitude,
  type SoundingScene,
} from "../src/sounding.js";
import { deterministicSceneProfile, SCENE_LAUNCH } from "./scene-fixtures.js";
import {
  dryNeutralProfile,
  ensembleLevelsProfile,
  isothermalProfile,
} from "./sounding-fixtures.js";

const HOUR = "2026-08-09T17:00:00Z"; // deterministicSceneProfile hour index 3

function deterministicSounding(): SoundingScene {
  const scene = buildSoundingScene(deterministicSceneProfile(), {
    validAt: HOUR,
    launch: SCENE_LAUNCH,
  });
  expect(scene).not.toBeNull();
  return scene as SoundingScene;
}

describe("buildSoundingScene selection contract", () => {
  it("returns null for an instant the profile does not publish — never throws", () => {
    const scene = buildSoundingScene(deterministicSceneProfile(), {
      validAt: "2026-08-09T03:00:00Z",
    });
    expect(scene).toBeNull();
    expect(buildSoundingScene(deterministicSceneProfile(), { validAt: "not a time" })).toBeNull();
  });

  it("echoes validAt, comparing instants rather than strings", () => {
    const scene = buildSoundingScene(deterministicSceneProfile(), {
      validAt: "2026-08-09T17:00:00.000Z",
    });
    expect(scene?.validAt).toBe(HOUR);
  });
});

describe("sounding scene geometry", () => {
  it("uses the meteogram domain conventions: floor at model elevation, top above every level and derived height", () => {
    const scene = deterministicSounding();
    const profile = deterministicSceneProfile();
    expect(scene.scales.floorM).toBe(profile.site.modelElevationM);
    const maxLevel = Math.max(
      ...profile.hours.flatMap((hour) => hour.levels.map((level) => level.heightM as number)),
    );
    expect(scene.scales.topM).toBeGreaterThan(maxLevel);
    for (const mark of scene.marks) {
      expect(mark.altitudeM).toBeGreaterThanOrEqual(scene.scales.floorM);
      expect(mark.altitudeM).toBeLessThanOrEqual(scene.scales.topM);
    }
  });

  it("draws one dot per published level plus the surface, joined by straight segments — nothing smooths", () => {
    const scene = deterministicSounding();
    const temperature = scene.traces.find((trace) => trace.key === "temperature");
    expect(temperature).toBeDefined();
    expect(scene.levelCount).toBe(5);
    expect(temperature!.samples).toHaveLength(6);
    expect(temperature!.samples[0].surface).toBe(true);
    // Straight interpolation only: M and L commands, never a curve.
    expect(temperature!.segmentPath).toMatch(/^M[-\d. L]+$/);
    expect(temperature!.segmentPath).not.toContain("C");
    const dewPoint = scene.traces.find((trace) => trace.key === "dewPoint");
    expect(dewPoint!.samples).toHaveLength(6);
  });

  it("carries the honesty statement: level count and the published column top", () => {
    const scene = deterministicSounding();
    expect(scene.capNote).toContain("5 published levels");
    expect(scene.capNote).toContain("flyable-band");
    expect(scene.ariaLabel).toContain("not a full skew-T");
  });

  it("places a wind barb at the surface and every published level, unthinned", () => {
    const scene = deterministicSounding();
    expect(scene.barbs).toHaveLength(6);
    expect(scene.barbs[0].surface).toBe(true);
    const ys = scene.barbs.map((barb) => barb.y);
    expect([...ys].sort((a, b) => b - a)).toEqual(ys);
  });

  it("marks the derived heights and the launch with labelled altitudes", () => {
    const scene = deterministicSounding();
    const keys = scene.marks.map((mark) => mark.key);
    expect(keys).toEqual(["boundaryLayerTop", "cloudBase", "usableLiftTop", "launch"]);
    for (const mark of scene.marks) {
      expect(mark.label).toContain(`${Math.round(mark.altitudeM)} m`);
      expect(mark.y).toBeCloseTo(yForAltitude(scene, mark.altitudeM), 6);
    }
    const withoutLaunch = buildSoundingScene(deterministicSceneProfile(), { validAt: HOUR });
    expect(withoutLaunch?.marks.some((mark) => mark.key === "launch")).toBe(false);
  });

  it("keeps pressure ticks at the median published height per isobaric level", () => {
    const scene = deterministicSounding();
    const pressures = scene.axes.pressureAltitude
      .map((tick) => tick.pressureHpa)
      .filter((value): value is number => value !== null);
    expect(pressures).toContain(925);
    expect(pressures).toContain(800);
    // Heights vary +2 m per hour across 8 hours; the median is the fixture's mid-window height.
    const tick925 = scene.axes.pressureAltitude.find((tick) => tick.pressureHpa === 925);
    expect(tick925?.altitudeM).toBe(Math.round(1252.4 + 7));
  });

  it("fits the temperature scale around every drawn trace", () => {
    const scene = deterministicSounding();
    const { temperatureMinC, temperatureMaxC } = scene.scales;
    for (const trace of scene.traces) {
      for (const sample of trace.samples) {
        expect(sample.valueC).toBeGreaterThanOrEqual(temperatureMinC);
        expect(sample.valueC).toBeLessThanOrEqual(temperatureMaxC);
        expect(sample.x).toBeGreaterThanOrEqual(scene.scales.plotLeft);
        expect(sample.x).toBeLessThanOrEqual(scene.scales.plotLeft + scene.scales.plotWidth);
      }
    }
  });
});

describe("parcel wiring (controlled columns — no parcel-physics numbers are load-bearing)", () => {
  it("dry-neutral column: the parcel trace lies on the temperature trace and no LCL draws below the column top", () => {
    const scene = buildSoundingScene(dryNeutralProfile(), { validAt: "2026-08-09T18:00:00Z" });
    expect(scene).not.toBeNull();
    const temperature = scene!.traces.find((trace) => trace.key === "temperature")!;
    const parcel = scene!.traces.find((trace) => trace.key === "parcel")!;
    expect(parcel.samples).toHaveLength(temperature.samples.length);
    for (const [index, sample] of parcel.samples.entries()) {
      // Any correct dry parcel matches a dry-neutral environment closely;
      // virtual-temperature details may not move it more than a fraction of a degree.
      expect(Math.abs(sample.valueC - temperature.samples[index].valueC)).toBeLessThan(0.5);
    }
    expect(scene!.lcl).toBeNull();
  });

  it("isothermal column: the parcel runs colder than the environment aloft and buoyancy reads negative", () => {
    const scene = buildSoundingScene(isothermalProfile(), { validAt: "2026-08-09T18:00:00Z" });
    expect(scene).not.toBeNull();
    const reading = readingAtAltitude(scene!, yForAltitude(scene!, 3000));
    expect(reading).not.toBeNull();
    expect(reading!.temperatureC).toBeCloseTo(20, 5);
    expect(reading!.parcelTempC).not.toBeNull();
    expect(reading!.parcelTempC!).toBeLessThan(10);
    expect(reading!.buoyancyC).not.toBeNull();
    expect(reading!.buoyancyC!).toBeLessThan(0);
  });
});

describe("ensemble honesty", () => {
  it("a 5-level ensemble column renders with countable dots and p25-p75 envelopes on traces and marks", () => {
    const scene = buildSoundingScene(ensembleLevelsProfile(), {
      validAt: "2026-08-09T20:00:00Z",
    });
    expect(scene).not.toBeNull();
    expect(scene!.levelCount).toBe(5);
    const temperature = scene!.traces.find((trace) => trace.key === "temperature")!;
    expect(temperature.samples).toHaveLength(6);
    expect(temperature.bandPath).not.toBeNull();
    const dewPoint = scene!.traces.find((trace) => trace.key === "dewPoint")!;
    expect(dewPoint.bandPath).not.toBeNull();
    const parcel = scene!.traces.find((trace) => trace.key === "parcel")!;
    expect(parcel.bandPath).toBeNull();
    for (const mark of scene!.marks) {
      expect(mark.band).not.toBeNull();
    }
    const svg = renderSoundingSvg(scene!, { idPrefix: "sounding-ensemble-test" });
    expect(svg.match(/class="meteo-sounding-temp-dot"/g)).toHaveLength(6);
  });

  it("a levels-free hour still builds: one surface dot, no segments, and the capNote says surface only", () => {
    const profile = ensembleLevelsProfile();
    const scene = buildSoundingScene(
      { ...profile, hours: [{ ...profile.hours[0], levels: [] }] },
      { validAt: "2026-08-09T20:00:00Z" },
    );
    expect(scene).not.toBeNull();
    expect(scene!.levelCount).toBe(0);
    const temperature = scene!.traces.find((trace) => trace.key === "temperature")!;
    expect(temperature.samples).toHaveLength(1);
    expect(temperature.segmentPath).toBe("");
    expect(scene!.traces.some((trace) => trace.key === "parcel")).toBe(false);
    expect(scene!.capNote).toContain("surface only");
  });
});

describe("readingAtAltitude", () => {
  it("interpolates exactly the straight segments the chart draws", () => {
    const scene = deterministicSounding();
    const lower = scene.sampling.temperatureC[1];
    const upper = scene.sampling.temperatureC[2];
    const midAltitude = (lower.altitudeM + upper.altitudeM) / 2;
    const reading = readingAtAltitude(scene, yForAltitude(scene, midAltitude));
    expect(reading).not.toBeNull();
    expect(reading!.altitudeM).toBeCloseTo(midAltitude, 6);
    expect(reading!.temperatureC).toBeCloseTo((lower.value + upper.value) / 2, 6);
    expect(reading!.validAt).toBe(HOUR);
    expect(reading!.windSpeedMps).not.toBeNull();
    expect(reading!.windDirectionDeg).not.toBeNull();
  });

  it("returns null outside the plot and null quantities above the published column", () => {
    const scene = deterministicSounding();
    expect(readingAtAltitude(scene, scene.scales.plotTop - 5)).toBeNull();
    const nearTop = readingAtAltitude(scene, scene.scales.plotTop + 1);
    expect(nearTop).not.toBeNull();
    expect(nearTop!.temperatureC).toBeNull();
    expect(nearTop!.windSpeedMps).toBeNull();
  });
});

describe("buildSoundingKeySpec", () => {
  it("keys exactly what the scene drew, with the scene's own style facts", () => {
    const scene = deterministicSounding();
    const spec = buildSoundingKeySpec(scene);
    expect(spec.series.map((entry) => entry.key)).toEqual(["temperature", "dewPoint", "parcel"]);
    for (const [index, entry] of spec.series.entries()) {
      expect(entry.className).toBe(scene.traces[index].className);
      expect(entry.dash).toBe(scene.traces[index].dash);
      expect(entry.strokeWidth).toBe(scene.traces[index].strokeWidth);
    }
    expect(spec.levelDot).not.toBeNull();
    expect(spec.band).toBeNull(); // deterministic profile: no envelopes drawn
    expect(spec.marks.map((entry) => entry.key)).toEqual([
      "boundaryLayerTop",
      "cloudBase",
      "usableLiftTop",
      "launch",
    ]);
    expect(spec.lcl).not.toBeNull();

    const hidden = buildSoundingScene(deterministicSceneProfile(), {
      validAt: HOUR,
      overlays: { parcel: false, dewPoint: false, cloudBase: false },
    });
    const hiddenSpec = buildSoundingKeySpec(hidden!);
    expect(hiddenSpec.series.map((entry) => entry.key)).toEqual(["temperature"]);
    expect(hiddenSpec.marks.some((entry) => entry.key === "cloudBase")).toBe(false);
    expect(hiddenSpec.lcl).toBeNull();
  });

  it("adds the envelope note exactly when a band drew", () => {
    const scene = buildSoundingScene(ensembleLevelsProfile(), {
      validAt: "2026-08-09T20:00:00Z",
    });
    expect(buildSoundingKeySpec(scene!).band).not.toBeNull();
  });
});

describe("deterministic output", () => {
  it("the same profile and options serialize to identical bytes", () => {
    const first = renderSoundingSvg(deterministicSounding(), { idPrefix: "twice" });
    const second = renderSoundingSvg(deterministicSounding(), { idPrefix: "twice" });
    expect(first).toBe(second);
  });
});
