import { describe, expect, it } from "vitest";

import type { ObservationDocument } from "../src/contract.js";
import {
  clearSkyGhiWm2,
  nearestObservation,
  observedTransmittance,
} from "../src/derive/irradiance.js";
import { cursorReading } from "../src/scene/hit-test.js";
import { buildKeySpec } from "../src/scene/key.js";
import { buildMeteogramScene } from "../src/scene/scene.js";
import { renderMeteogramSvg } from "../src/svg/index.js";
import { tinySceneProfile } from "../test/scene-fixtures.js";

const OPTIONS = { columnWidthPx: 20, timeZone: "America/Vancouver" };

function observationsFor(validAts: string[], wm2: number, offsetMinutes = 10): ObservationDocument {
  const observations = validAts.map((validAt) => ({
    observedAt: new Date(Date.parse(validAt) + offsetMinutes * 60_000)
      .toISOString()
      .replace(".000Z", "Z"),
    downwardShortwaveWm2: wm2,
  }));
  return {
    schemaVersion: 1,
    model: "goes18-dsr",
    observed: {
      firstObservedAt: observations[0].observedAt,
      lastObservedAt: observations[observations.length - 1].observedAt,
      generatedAt: "2026-08-10T06:00:00Z",
    },
    site: { id: "synthetic-ridge", name: "Synthetic Ridge", latitude: 49, longitude: -123 },
    observations,
  };
}

describe("clear-sky irradiance and observed transmittance", () => {
  it("evaluates Haurwitz at the overhead sun and at sunset", () => {
    expect(clearSkyGhiWm2(1)).toBeCloseTo(1035.1, 0);
    expect(clearSkyGhiWm2(0)).toBe(0);
    expect(clearSkyGhiWm2(-0.3)).toBe(0);
  });

  it("reads a smoky sky as a transmittance deficit", () => {
    const cosZenith = 0.7;
    const transmittance = observedTransmittance(624.7, cosZenith);
    expect(transmittance).toBeGreaterThan(0.8);
    expect(transmittance).toBeLessThan(1);
  });

  it("refuses the ratio near the horizon and caps a suspicious one", () => {
    expect(observedTransmittance(100, 0.1)).toBeNull();
    expect(observedTransmittance(-5, 0.7)).toBeNull();
    expect(observedTransmittance(9_999, 0.7)).toBe(1.5);
  });

  it("joins by nearest instant within the tolerance", () => {
    const document = observationsFor(["2026-08-09T21:00:00Z", "2026-08-09T22:00:00Z"], 600, 10);
    const hit = nearestObservation(document, "2026-08-09T22:00:00Z");
    expect(hit?.observation.observedAt).toBe("2026-08-09T22:10:00Z");
    expect(hit?.offsetMinutes).toBeCloseTo(10);
    expect(nearestObservation(document, "2026-08-10T04:00:00Z")).toBeNull();
    expect(nearestObservation(document, "2026-08-09T22:00:00Z", 5)).toBeNull();
  });
});

describe("the measured Sun strip", () => {
  it("draws nothing and reports no source without observations", () => {
    const scene = buildMeteogramScene(tinySceneProfile(), OPTIONS);
    expect(scene.strips.find((strip) => strip.key === "observedIrradiance")).toBeUndefined();
    expect(scene.observationSource).toBeNull();
  });

  it("draws measurements with dimming shadows and names the source", () => {
    const profile = tinySceneProfile();
    const observations = observationsFor(
      profile.hours.map((hour) => hour.validAt),
      500,
    );
    const scene = buildMeteogramScene(profile, { ...OPTIONS, observations });

    const strip = scene.strips.find((entry) => entry.key === "observedIrradiance");
    expect(strip?.values.every((value) => value === 500)).toBe(true);
    expect(strip?.unit).toBe("W/m²");
    const shadow = (strip?.cells ?? []).find((cell) => cell !== null);
    expect(shadow?.className).toBe("meteo-gram-dim-cell");
    expect(shadow?.opacity).toBeGreaterThan(0);
    expect(scene.observationSource).toEqual({
      model: "goes18-dsr",
      lastObservedAt: observations.observed.lastObservedAt,
    });

    const key = buildKeySpec(scene);
    expect(key.measuredDimming?.label).toContain("dimming");

    const { plotLeft, plotTop, plotHeight, columnWidth } = scene.scales;
    const reading = cursorReading(scene, plotLeft + columnWidth / 2, plotTop + plotHeight / 2);
    expect(reading?.observedIrradianceWm2).toBe(500);
    expect(reading?.observedTransmittance).toBeGreaterThan(0);
  });

  it("draws the line at the product's cadence and marks the not-yet-measured remainder", () => {
    const profile = tinySceneProfile();
    const firstHourMs = Date.parse(profile.hours[0].validAt);
    // Ten-minute granules across the first rendered hour only: the line
    // carries every sample, and the window's unmeasured remainder renders
    // as a pending region from the newest measured instant.
    const observations = observationsFor([profile.hours[0].validAt], 500);
    observations.observations = [420, 450, 480, 500].map((wm2, index) => ({
      observedAt: new Date(firstHourMs + index * 10 * 60_000).toISOString().replace(".000Z", "Z"),
      downwardShortwaveWm2: wm2,
    }));
    observations.observed.lastObservedAt = observations.observations[3].observedAt;
    const scene = buildMeteogramScene(profile, { ...OPTIONS, observations });

    const strip = scene.strips.find((entry) => entry.key === "observedIrradiance");
    // Four samples in one column: more curve anchors than the two rendered
    // hours could ever supply, in one unbroken segment.
    expect(strip?.linePath.match(/M/g)).toHaveLength(1);
    expect(strip?.linePath.match(/C/g)?.length).toBeGreaterThanOrEqual(2);
    expect(strip?.dots).toBeUndefined();
    const { plotLeft, plotWidth } = scene.scales;
    expect(strip?.measuredToX).toBeGreaterThan(plotLeft);
    expect(strip?.measuredToX).toBeLessThan(plotLeft + plotWidth);
  });

  it("breaks the line across a retrieval outage instead of interpolating, and never extends to the plot edges", () => {
    const profile = tinySceneProfile();
    const firstHourMs = Date.parse(profile.hours[0].validAt);
    const observations = observationsFor([profile.hours[0].validAt], 500);
    // Two granule pairs an hour apart: each pair connects, the hour-wide
    // outage between them breaks the line.
    observations.observations = [0, 10, 60, 70].map((minutes, index) => ({
      observedAt: new Date(firstHourMs + minutes * 60_000).toISOString().replace(".000Z", "Z"),
      downwardShortwaveWm2: 400 + index * 50,
    }));
    observations.observed.lastObservedAt = observations.observations[3].observedAt;
    const scene = buildMeteogramScene(profile, { ...OPTIONS, observations });

    const strip = scene.strips.find((entry) => entry.key === "observedIrradiance");
    expect(strip?.linePath.match(/M/g)).toHaveLength(2);
    // A measured line must not fabricate readings at the plot edges the
    // way forecast strips extend their first and last hour.
    const { plotLeft, plotWidth } = scene.scales;
    const xs = [...strip!.linePath.matchAll(/[MC]([\d.]+),/g)].map((hit) => Number(hit[1]));
    expect(Math.min(...xs)).toBeGreaterThan(plotLeft);
    expect(Math.max(...xs)).toBeLessThan(plotLeft + plotWidth);
  });

  it("surfaces a lone surviving retrieval as a dot instead of an invisible path", () => {
    const profile = tinySceneProfile();
    const observations = observationsFor([profile.hours[0].validAt], 500);
    const scene = buildMeteogramScene(profile, { ...OPTIONS, observations });

    const strip = scene.strips.find((entry) => entry.key === "observedIrradiance");
    expect(strip?.linePath).toBe("");
    expect(strip?.dots).toHaveLength(1);
    const svg = renderMeteogramSvg(scene, { idPrefix: "sun-dot" });
    expect(svg).toContain('class="meteo-gram-strip-observedIrradiance-dot"');
    expect(svg).toContain('class="meteo-gram-strip-pending"');
  });

  it("bridges its cadence at the caller's gap tolerance", () => {
    const profile = tinySceneProfile();
    const observations = observationsFor(
      profile.hours.map((hour) => hour.validAt),
      500,
    );
    // Hour-apart samples: split at the trial default, one line at 90.
    const split = buildMeteogramScene(profile, { ...OPTIONS, observations });
    const bridged = buildMeteogramScene(profile, {
      ...OPTIONS,
      observations,
      measurementGapMinutes: 90,
    });
    expect(split.strips.find((entry) => entry.key === "observedIrradiance")?.dots).toHaveLength(2);
    expect(
      bridged.strips.find((entry) => entry.key === "observedIrradiance")?.linePath.match(/M/g),
    ).toHaveLength(1);
  });

  it("stays out of the graph when the overlay is off", () => {
    const profile = tinySceneProfile();
    const observations = observationsFor(
      profile.hours.map((hour) => hour.validAt),
      500,
    );
    const scene = buildMeteogramScene(profile, {
      ...OPTIONS,
      observations,
      overlays: { observedIrradiance: false },
    });
    expect(scene.strips.find((entry) => entry.key === "observedIrradiance")).toBeUndefined();
    expect(scene.observationSource).toBeNull();
  });
});
