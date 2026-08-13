import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSiteForecast } from "../src/contract.js";
import { buildMeteogramScene } from "../src/scene/index.js";
import { ensembleSceneProfile } from "../test/scene-fixtures.js";

const fixture = parseSiteForecast(
  JSON.parse(
    readFileSync(join(__dirname, "..", "..", "briefing", "test", "pipeline-parity.json"), "utf-8"),
  ),
);

describe("scene option sinkRateMps", () => {
  const TZ = { timeZone: "America/Vancouver" };

  it("at 1.0 the recomputed series equals the published one — the whole scene is unchanged", () => {
    const published = buildMeteogramScene(fixture!, TZ);
    const recomputed = buildMeteogramScene(fixture!, { ...TZ, sinkRateMps: 1.0 });
    expect(JSON.stringify(recomputed)).toBe(JSON.stringify(published));
  });

  it("a different sink rate moves the drawn line without touching the published document", () => {
    const usableSeries = (sinkRateMps?: number) =>
      buildMeteogramScene(
        fixture!,
        sinkRateMps === undefined ? TZ : { ...TZ, sinkRateMps },
      ).series.find((entry) => entry.key === "usableLiftTop")!;
    expect(usableSeries(1.6).path).not.toBe(usableSeries().path);
    expect(usableSeries(0.7).path).not.toBe(usableSeries().path);
  });

  it("no-ops for ensemble documents — the published percentile series is kept, not a fabricated p50 rerun", () => {
    const published = buildMeteogramScene(ensembleSceneProfile(), TZ);
    const requested = buildMeteogramScene(ensembleSceneProfile(), { ...TZ, sinkRateMps: 0.7 });
    expect(JSON.stringify(requested)).toBe(JSON.stringify(published));
  });
});
