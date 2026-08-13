import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSiteForecast } from "../src/contract.js";
import { p50, usableLiftTopM } from "../src/derive/index.js";

const fixture = parseSiteForecast(
  JSON.parse(readFileSync(join(__dirname, "pipeline-parity.json"), "utf-8")),
);

describe("parameterized usable-lift top", () => {
  it("reproduces the pipeline's published value exactly at the default 1.0 m/s", () => {
    expect(fixture).not.toBeNull();
    const { site, hours } = fixture!;
    expect(hours).toHaveLength(15);
    let nonNull = 0;
    for (const hour of hours) {
      const rederived = usableLiftTopM({
        modelElevationM: site.modelElevationM,
        boundaryLayerTopM: p50(hour.derived.boundaryLayerTopM),
        thermalVelocityMps: p50(hour.derived.thermalVelocityMps)!,
        cloudBaseM: p50(hour.derived.cloudBaseM)!,
        levels: hour.levels.map((level) => ({ heightM: p50(level.heightM)! })),
      });
      const published = p50(hour.derived.usableLiftTopM);
      if (published === null) {
        expect(rederived, hour.validAt).toBeNull();
      } else {
        expect(rederived, hour.validAt).not.toBeNull();
        expect(rederived!, hour.validAt).toBeCloseTo(published, 9);
        nonNull += 1;
      }
    }
    expect(nonNull).toBe(10);
  });

  it("covers the cloud-base cap in the real column, not just synthetic data", () => {
    const { hours } = fixture!;
    const capped = hours.filter(
      (hour) =>
        p50(hour.derived.usableLiftTopM) !== null &&
        p50(hour.derived.usableLiftTopM) === p50(hour.derived.cloudBaseM),
    );
    expect(capped.length).toBeGreaterThanOrEqual(1);
  });

  it("moves monotonically with the sink rate — a floatier glider climbs higher", () => {
    const { site, hours } = fixture!;
    const hour = hours.find((entry) => p50(entry.derived.usableLiftTopM) !== null)!;
    const inputs = {
      modelElevationM: site.modelElevationM,
      boundaryLayerTopM: p50(hour.derived.boundaryLayerTopM),
      thermalVelocityMps: p50(hour.derived.thermalVelocityMps)!,
      cloudBaseM: p50(hour.derived.cloudBaseM)!,
      levels: hour.levels.map((level) => ({ heightM: p50(level.heightM)! })),
    };
    const floaty = usableLiftTopM(inputs, 0.7)!;
    const standard = usableLiftTopM(inputs, 1.0)!;
    const sinky = usableLiftTopM(inputs, 1.6)!;
    expect(floaty).toBeGreaterThanOrEqual(standard);
    expect(standard).toBeGreaterThanOrEqual(sinky);
  });

  it("returns null when the strongest core cannot beat the sink rate", () => {
    const { site, hours } = fixture!;
    const hour = hours.find((entry) => p50(entry.derived.usableLiftTopM) !== null)!;
    const inputs = {
      modelElevationM: site.modelElevationM,
      boundaryLayerTopM: p50(hour.derived.boundaryLayerTopM),
      thermalVelocityMps: p50(hour.derived.thermalVelocityMps)!,
      cloudBaseM: p50(hour.derived.cloudBaseM)!,
      levels: hour.levels.map((level) => ({ heightM: p50(level.heightM)! })),
    };
    expect(usableLiftTopM(inputs, inputs.thermalVelocityMps * 2.02 + 0.01)).toBeNull();
    expect(usableLiftTopM({ ...inputs, boundaryLayerTopM: null })).toBeNull();
  });
});
