import { describe, expect, it } from "vitest";
import type { ModelCapabilities } from "../src/contract.js";
import { buildKeySpec, buildMeteogramScene } from "../src/scene/index.js";
import { renderMeteogramSvg } from "../src/svg/index.js";
import { deterministicSceneProfile } from "../test/scene-fixtures.js";

const TZ = { timeZone: "America/Vancouver" };
const OMEGA_ON = { ...TZ, overlays: { verticalVelocity: true } };

// RDPS declares omega on 850 and 700 hPa only; the fixture's site floor
// (1,072.5 m) prunes everything at or below it, and its published levels
// stop at 800 hPa, so exactly one declared omega level survives.
function capabilitiesLike(verticalVelocityLevels: number[]): ModelCapabilities {
  return {
    levels: true,
    pressureLevels: [925, 900, 875, 850, 800, 750, 700],
    verticalVelocity: "omega",
    verticalVelocityLevels,
    heatFluxes: true,
    gust: "hourMax",
    precipitation: "windowMeanRate",
    cape: true,
    cin: true,
    pblHeight: true,
    cloudLayers: false,
    cloudProfile: false,
    smoke: false,
  };
}

describe("omega honesty gate", () => {
  it("suppresses the field when fewer than 3 declared omega levels sit inside the window", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), {
      ...OMEGA_ON,
      capabilities: capabilitiesLike([850, 700]),
    });
    expect(scene.fields.some((field) => field.key === "verticalVelocity")).toBe(false);
    expect(scene.suppressed).toEqual([
      {
        key: "verticalVelocity",
        reason:
          "1 of 2 declared omega levels inside the altitude window; fewer than 3 cannot outline an honest band",
      },
    ]);
    expect(renderMeteogramSvg(scene, { stylesheet: null })).not.toContain("meteo-gram-omega-");
  });

  it("never advertises a suppressed field in the key", () => {
    const suppressedScene = buildMeteogramScene(deterministicSceneProfile(), {
      ...OMEGA_ON,
      capabilities: capabilitiesLike([850, 700]),
    });
    expect(
      buildKeySpec(suppressedScene).ramps.some((ramp) => ramp.key === "verticalVelocity"),
    ).toBe(false);
  });

  it("draws when at least 3 declared levels survive the terrain", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), {
      ...OMEGA_ON,
      capabilities: capabilitiesLike([925, 900, 875, 850, 800]),
    });
    expect(scene.fields.some((field) => field.key === "verticalVelocity")).toBe(true);
    expect(scene.suppressed).toEqual([]);
    expect(buildKeySpec(scene).ramps.some((ramp) => ramp.key === "verticalVelocity")).toBe(true);
  });

  it("applies no gate without a capabilities declaration — the scene cannot know what was declared", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), OMEGA_ON);
    expect(scene.fields.some((field) => field.key === "verticalVelocity")).toBe(true);
    expect(scene.suppressed).toEqual([]);
  });

  it("suppresses the drawn field, not the published data: sampling keeps its omega nodes", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), {
      ...OMEGA_ON,
      capabilities: capabilitiesLike([850, 700]),
    });
    expect(scene.sampling[0].verticalVelocityPaS.length).toBeGreaterThan(0);
  });

  it("stays empty when the overlay is off — nothing was asked for, so nothing was suppressed", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      capabilities: capabilitiesLike([850, 700]),
    });
    expect(scene.suppressed).toEqual([]);
    expect(scene.fields.some((field) => field.key === "verticalVelocity")).toBe(false);
  });
});
