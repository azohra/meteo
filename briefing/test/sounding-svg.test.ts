import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { siteForecastSchema } from "../src/contract.js";
import {
  buildSoundingKeySpec,
  buildSoundingScene,
  renderSoundingKeySvg,
  renderSoundingSvg,
  type SoundingScene,
} from "../src/sounding.js";
import { deterministicSceneProfile, SCENE_LAUNCH } from "./scene-fixtures.js";
import { ensembleLevelsProfile } from "./sounding-fixtures.js";

/* GOLDEN REVIEW NOTE: every golden here draws the parcel trace, so their
   bytes move when lane A1's authoritative parcelAscent replaces the
   placeholder in derive/parcel.ts — re-review them all after A1 lands.
   The structural sounding tests are the parcel-independent floor. */

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

function requiredScene(scene: SoundingScene | null): SoundingScene {
  expect(scene).not.toBeNull();
  return scene as SoundingScene;
}

function deterministicSounding(): SoundingScene {
  return requiredScene(
    buildSoundingScene(deterministicSceneProfile(), {
      validAt: "2026-08-09T17:00:00Z",
      launch: SCENE_LAUNCH,
    }),
  );
}

describe("golden sounding SVG fixtures", () => {
  it("matches the deterministic golden", async () => {
    const svg = renderSoundingSvg(deterministicSounding(), {
      idPrefix: "sounding-deterministic",
    });
    await expect(svg).toMatchFileSnapshot("golden/sounding-deterministic.svg");
  });

  it("matches the 5-level ensemble golden — sparse levels drawn honestly, envelopes included", async () => {
    const scene = requiredScene(
      buildSoundingScene(ensembleLevelsProfile(), { validAt: "2026-08-09T20:00:00Z" }),
    );
    const svg = renderSoundingSvg(scene, { idPrefix: "sounding-ensemble" });
    await expect(svg).toMatchFileSnapshot("golden/sounding-ensemble.svg");
  });

  it("matches the key golden, derived from the deterministic scene", async () => {
    const svg = renderSoundingKeySvg(buildSoundingKeySpec(deterministicSounding()), {
      idPrefix: "sounding-key",
    });
    await expect(svg).toMatchFileSnapshot("golden/sounding-key.svg");
  });

  it("matches the convective-cycle scenario golden at the midday hour", async () => {
    const scenarioDir = resolve(TEST_DIR, "../../scenarios");
    const index = JSON.parse(readFileSync(join(scenarioDir, "index.json"), "utf8")) as {
      scenarios: Array<{
        id: string;
        launch: { elevationM: number };
        outputs: Array<{ path: string }>;
      }>;
    };
    const entry = index.scenarios.find((candidate) => candidate.id === "convective-cycle");
    expect(entry).toBeDefined();
    const profile = siteForecastSchema.parse(
      JSON.parse(readFileSync(join(scenarioDir, entry!.outputs[0].path), "utf8")),
    );
    const scene = requiredScene(
      buildSoundingScene(profile, {
        validAt: "2000-01-01T15:00:00Z",
        launch: entry!.launch,
      }),
    );
    expect(scene.levelCount).toBe(8);
    const svg = renderSoundingSvg(scene, { idPrefix: "sounding-convective-cycle" });
    await expect(svg).toMatchFileSnapshot("golden/sounding-convective-cycle.svg");
  });
});
