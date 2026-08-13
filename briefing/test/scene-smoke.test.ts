import { describe, expect, it } from "vitest";

import type { SmokeDocument } from "../src/contract.js";
import { cursorReading } from "../src/scene/hit-test.js";
import { buildKeySpec } from "../src/scene/key.js";
import { buildMeteogramScene } from "../src/scene/scene.js";
import { tinySceneProfile } from "../test/scene-fixtures.js";

const OPTIONS = { columnWidthPx: 20, timeZone: "America/Vancouver" };

function smokeDocumentFor(validAts: string[]): SmokeDocument {
  return {
    schemaVersion: 1,
    model: "raqdps",
    run: { referenceTime: "2026-08-09T12:00:00Z", generatedAt: "2026-08-09T14:00:00Z" },
    site: { id: "dundee", name: "Dundee", latitude: 49.1, longitude: -122.2 },
    hours: validAts.map((validAt) => ({
      validAt,
      pm25Ugm3: 40,
      smokePlumeSurfaceUgm3: 37.5,
      smokePlumeColumnMgm2: 200,
    })),
  };
}

describe("the smoke strip", () => {
  it("draws nothing and reports no source without smoke data", () => {
    const scene = buildMeteogramScene(tinySceneProfile(), OPTIONS);
    expect(scene.strips.find((strip) => strip.key === "smoke")).toBeUndefined();
    expect(scene.smokeSource).toBeNull();
  });

  it("draws the profile's own smoke block with same-run provenance", () => {
    const profile = tinySceneProfile();
    profile.hours[0].smoke = { surfaceUgm3: 184.6, columnMgm2: 228.2, aot: 1.018 };
    const scene = buildMeteogramScene(profile, OPTIONS);

    const strip = scene.strips.find((entry) => entry.key === "smoke");
    expect(strip?.values[0]).toBe(184.6);
    expect(strip?.unit).toBe("µg/m³");
    expect(strip?.cells?.[0]?.opacity).toBeCloseTo(0.34, 2);
    expect(scene.smokeSource).toEqual({
      model: profile.model,
      referenceTime: profile.run.referenceTime,
    });
  });

  it("joins a smoke document by validAt when the profile is smoke-blind", () => {
    const profile = tinySceneProfile();
    const smoke = smokeDocumentFor(profile.hours.map((hour) => hour.validAt));
    const scene = buildMeteogramScene(profile, { ...OPTIONS, smoke });

    const strip = scene.strips.find((entry) => entry.key === "smoke");
    expect(strip?.values.every((value) => value === 37.5)).toBe(true);
    expect(strip?.cells?.every((cell) => cell === null)).toBe(true);
    expect(scene.smokeSource).toEqual({
      model: "raqdps",
      referenceTime: "2026-08-09T12:00:00Z",
    });
  });

  it("never blends two models under one strip", () => {
    const profile = tinySceneProfile();
    profile.hours[0].smoke = { surfaceUgm3: 184.6, columnMgm2: 228.2, aot: 1.018 };
    const smoke = smokeDocumentFor(profile.hours.map((hour) => hour.validAt));
    const scene = buildMeteogramScene(profile, { ...OPTIONS, smoke });

    const strip = scene.strips.find((entry) => entry.key === "smoke");
    expect(strip?.values[0]).toBe(184.6);
    expect(strip?.values.slice(1).every((value) => value === null)).toBe(true);
    expect(scene.smokeSource?.model).toBe(profile.model);
  });

  it("no-ops the adjusted view on joined smoke — the column is quarantined", () => {
    const profile = tinySceneProfile();
    const smoke = smokeDocumentFor(profile.hours.map((hour) => hour.validAt));
    const base = buildMeteogramScene(profile, { ...OPTIONS, smoke });
    const adjusted = buildMeteogramScene(profile, { ...OPTIONS, smoke, smokeAdjusted: true });

    const baseW = base.strips.find((strip) => strip.key === "thermalStrength")?.values[0];
    const adjustedW = adjusted.strips.find((strip) => strip.key === "thermalStrength")?.values[0];
    expect(adjustedW).toBe(baseW);
    expect(adjusted.smokeAdjustment).toBeNull();
    expect(base.smokeAdjustment).toBeNull();
  });

  it("no-ops the adjustment on a smoke-aware profile", () => {
    const profile = tinySceneProfile();
    profile.semantics = { smoke: "radiativelyCoupled" };
    profile.hours[0].smoke = { surfaceUgm3: 184.6, columnMgm2: 228.2, aot: 1.018 };
    const scene = buildMeteogramScene(profile, { ...OPTIONS, smokeAdjusted: true });

    expect(scene.strips.find((strip) => strip.key === "smoke")).toBeDefined();
    expect(scene.smokeAdjustment).toBeNull();
    expect(scene.strips.find((strip) => strip.key === "thermalStrength")?.values[0]).toBe(
      profile.hours[0].derived.thermalVelocityMps,
    );
  });

  it("declares no adjustment when the sun is down through the smoky hours", () => {
    const profile = tinySceneProfile();
    profile.site.longitude = 60;
    const smoke = smokeDocumentFor(profile.hours.map((hour) => hour.validAt));
    const base = buildMeteogramScene(profile, { ...OPTIONS, smoke });
    const adjusted = buildMeteogramScene(profile, { ...OPTIONS, smoke, smokeAdjusted: true });

    expect(adjusted.smokeAdjustment).toBeNull();
    expect(JSON.stringify(adjusted.strips)).toBe(JSON.stringify(base.strips));
    expect(JSON.stringify(adjusted.series)).toBe(JSON.stringify(base.series));
  });

  it("declares no adjustment when there is nothing to derate", () => {
    const profile = tinySceneProfile();
    for (const hour of profile.hours) hour.derived.thermalVelocityMps = 0;
    const smoke = smokeDocumentFor(profile.hours.map((hour) => hour.validAt));
    const adjusted = buildMeteogramScene(profile, { ...OPTIONS, smoke, smokeAdjusted: true });

    expect(adjusted.smokeAdjustment).toBeNull();
  });

  it("reports the drawn smoke in cursor readings, so tooltips match pixels", () => {
    const profile = tinySceneProfile();
    profile.hours[0].smoke = { surfaceUgm3: 184.6, columnMgm2: 228.2, aot: 1.018 };
    const scene = buildMeteogramScene(profile, OPTIONS);
    const { plotLeft, plotTop, plotHeight, columnWidth } = scene.scales;

    const smoky = cursorReading(scene, plotLeft + columnWidth / 2, plotTop + plotHeight / 2);
    expect(smoky?.smokeSurfaceUgm3).toBe(184.6);
    expect(smoky?.smokeAot).toBe(1.018);
    const clear = cursorReading(scene, plotLeft + columnWidth * 1.5, plotTop + plotHeight / 2);
    expect(clear?.smokeSurfaceUgm3).toBeNull();
    expect(clear?.smokeAot).toBeNull();
  });

  it("keys the haze chip and labels the adjusted view — own smoke only", () => {
    const own = tinySceneProfile();
    own.hours[0].smoke = { surfaceUgm3: 184.6, columnMgm2: 228.2, aot: 1.018 };
    const base = buildKeySpec(buildMeteogramScene(own, OPTIONS));
    expect(base.smokeHaze?.label).toContain("optical depth");
    expect(base.smokeAdjusted).toBeNull();

    const adjusted = buildKeySpec(buildMeteogramScene(own, { ...OPTIONS, smokeAdjusted: true }));
    expect(adjusted.smokeAdjusted?.label).toContain(own.model);
    expect(adjusted.smokeAdjusted?.label).toContain(own.run.referenceTime);

    const joined = tinySceneProfile();
    const smoke = smokeDocumentFor(joined.hours.map((hour) => hour.validAt));
    const joinedKey = buildKeySpec(
      buildMeteogramScene(joined, { ...OPTIONS, smoke, smokeAdjusted: true }),
    );
    expect(joinedKey.smokeHaze).toBeNull();
    expect(joinedKey.smokeAdjusted).toBeNull();

    const clean = buildKeySpec(buildMeteogramScene(tinySceneProfile(), OPTIONS));
    expect(clean.smokeHaze).toBeNull();
  });

  it("stays out of the graph when the overlay is off", () => {
    const profile = tinySceneProfile();
    profile.hours[0].smoke = { surfaceUgm3: 184.6, columnMgm2: 228.2, aot: 1.018 };
    const scene = buildMeteogramScene(profile, { ...OPTIONS, overlays: { smoke: false } });

    expect(scene.strips.find((entry) => entry.key === "smoke")).toBeUndefined();
    expect(scene.smokeSource).toBeNull();
  });
});
