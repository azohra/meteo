import { describe, expect, it } from "vitest";
import { parseSiteForecast } from "../src/contract.js";
import { DEFAULT_CAPE_CLASSES, buildMeteogramScene } from "../src/scene/index.js";
import { deterministicSceneProfile, scienceSceneProfile } from "../test/scene-fixtures.js";

const TZ = { timeZone: "America/Vancouver" };

describe("science fixture", () => {
  it("is a valid profile by the package's own contract", () => {
    expect(parseSiteForecast(scienceSceneProfile())).not.toBeNull();
  });
});

describe("CAPE strip", () => {
  const scene = buildMeteogramScene(scienceSceneProfile(), TZ);
  const strip = scene.strips.find((entry) => entry.key === "cape");

  it("joins the strip stack next to w*, with the line over classed cells", () => {
    expect(scene.strips.map((entry) => entry.key)).toEqual([
      "pressure",
      "precipitation",
      "cloudCover",
      "cloudLayers",
      "thermalStrength",
      "cape",
    ]);
    expect(strip!.linePath).not.toBe("");
    expect(strip!.cells).toHaveLength(6);
  });

  it("classifies every overdevelopment-risk band the fixture crosses", () => {
    expect(strip!.cells!.map((cell) => cell!.className.split(" ")[0])).toEqual([
      "meteo-gram-cape-calm",
      "meteo-gram-cape-watch",
      "meteo-gram-cape-risk",
      "meteo-gram-cape-severe",
      "meteo-gram-cape-watch",
      "meteo-gram-cape-calm",
    ]);
  });

  it("dims — never clears — hours capped by CIN <= -50 J/kg", () => {
    const capped = strip!.cells!.map((cell) => cell!.className.includes("meteo-gram-cape-capped"));
    expect(capped).toEqual([false, true, false, true, false, false]);
  });

  it("keeps the scale honest: the axis reaches at least the severe band", () => {
    expect(strip!.minimum).toBe(0);
    expect(strip!.maximum).toBeGreaterThanOrEqual(1700);
  });

  it("passing DEFAULT_CAPE_CLASSES explicitly changes nothing", () => {
    const explicit = buildMeteogramScene(scienceSceneProfile(), {
      ...TZ,
      capeClasses: { ...DEFAULT_CAPE_CLASSES },
    });
    expect(JSON.stringify(explicit)).toBe(JSON.stringify(scene));
  });

  it("reclassifies by options.capeClasses when a consumer overrides the doctrine", () => {
    const custom = buildMeteogramScene(scienceSceneProfile(), {
      ...TZ,
      capeClasses: { watchJkg: 100, riskJkg: 500, severeJkg: 1000, cappedCinJkg: -100 },
    });
    const customStrip = custom.strips.find((entry) => entry.key === "cape")!;
    expect(customStrip.cells!.map((cell) => cell!.className.split(" ")[0])).toEqual([
      "meteo-gram-cape-watch",
      "meteo-gram-cape-watch",
      "meteo-gram-cape-risk",
      "meteo-gram-cape-severe",
      "meteo-gram-cape-risk",
      "meteo-gram-cape-calm",
    ]);
    expect(
      customStrip.cells!.map((cell) => cell!.className.includes("meteo-gram-cape-capped")),
    ).toEqual([false, false, false, true, false, false]);
  });
});

describe("gust marks", () => {
  it("places one G<km/h> readout per barb-stride hour above the surface row", () => {
    const scene = buildMeteogramScene(scienceSceneProfile(), TZ);
    expect(scene.gusts).toHaveLength(6);
    expect(scene.gusts[0].label).toBe("G22");
    expect(scene.gusts[0].speedKmh).toBeCloseTo(21.6, 6);
    const surfaceY = scene.scales.plotTop + scene.scales.plotHeight;
    for (const gust of scene.gusts) expect(gust.y).toBeLessThan(surfaceY);
  });

  it("draws nothing when the overlay is off", () => {
    const scene = buildMeteogramScene(scienceSceneProfile(), { ...TZ, overlays: { gusts: false } });
    expect(scene.gusts).toEqual([]);
  });
});

describe("model PBL series", () => {
  it("adds modelPblTop with its own class, dash, and thinner stroke", () => {
    const scene = buildMeteogramScene(scienceSceneProfile(), TZ);
    const pbl = scene.series.find((entry) => entry.key === "modelPblTop");
    expect(pbl).toMatchObject({
      className: "meteo-gram-series-pbl",
      strokeWidth: 1.6,
      dash: "3 3",
    });
    expect(pbl!.path).not.toBe("");
  });

  it("plots pblHeightM + modelElevationM — identical to the parcel line when the AGL depths agree", () => {
    const profile = scienceSceneProfile();
    const floorM = profile.site.modelElevationM;
    for (const hour of profile.hours) {
      const top = hour.derived.boundaryLayerTopM;
      if (top === null) {
        delete hour.surface.pblHeightM;
      } else {
        hour.surface.pblHeightM = (top as number) - floorM;
      }
    }
    const scene = buildMeteogramScene(profile, TZ);
    const byKey = Object.fromEntries(scene.series.map((entry) => [entry.key, entry]));
    expect(byKey["modelPblTop"].path).toBe(byKey["boundaryLayerTop"].path);
  });

  it("is omitted, not empty, when no hour publishes pblHeightM", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), TZ);
    expect(scene.series.some((entry) => entry.key === "modelPblTop")).toBe(false);
  });
});

describe("cloud-layer strip", () => {
  const scene = buildMeteogramScene(scienceSceneProfile(), TZ);
  const strip = scene.strips.find((entry) => entry.key === "cloudLayers");

  it("stacks high, middle, low reading downward like the sky", () => {
    expect(strip!.rows!.map((row) => row.label)).toEqual(["H", "M", "L"]);
    const tops = strip!.rows!.map((row) => row.top);
    expect(tops[0]).toBeLessThan(tops[1]);
    expect(tops[1]).toBeLessThan(tops[2]);
    expect(strip!.rows![0].height).toBeCloseTo(strip!.height / 3, 6);
  });

  it("grades cell opacity by layer fraction", () => {
    const midRow = strip!.rows![1];
    expect(midRow.cells[4]!.opacity).toBeCloseTo(0.9, 6);
    expect(midRow.cells[0]!.opacity).toBeCloseTo(0.05, 6);
    expect(midRow.cells[0]!.className).toBe("meteo-gram-cloud-cell");
  });

  it("draws no strip line — the rows are the data", () => {
    expect(strip!.linePath).toBe("");
    expect(strip!.values.every((value) => value === null)).toBe(true);
  });
});

describe("cloud-shading precedence", () => {
  it("shades from the model's cloud profile where levels carry it, inference elsewhere", () => {
    const scene = buildMeteogramScene(scienceSceneProfile(), TZ);
    const cloudLayers = scene.fields.filter((field) => field.key === "clouds");
    expect(cloudLayers).toHaveLength(2);
    const classNames = cloudLayers.flatMap((layer) => layer.paths.map((entry) => entry.className));
    expect(classNames).toContain("meteo-gram-cloud-dense");
  });

  it("keeps a single inference layer when no level carries model cloud", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), TZ);
    expect(scene.fields.filter((field) => field.key === "clouds")).toHaveLength(1);
  });
});

describe("graceful degradation", () => {
  it("adds nothing at all to a profile without the science fields", () => {
    const on = buildMeteogramScene(deterministicSceneProfile(), TZ);
    const off = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      overlays: { cape: false, gusts: false, pblHeight: false, cloudLayers: false },
    });
    expect(JSON.stringify(on)).toBe(JSON.stringify(off));
    expect(on.strips.some((strip) => strip.key === "cape")).toBe(false);
    expect(on.strips.some((strip) => strip.key === "cloudLayers")).toBe(false);
    expect(on.gusts).toEqual([]);
  });
});
