import { describe, expect, it } from "vitest";
import { buildKeySpec, buildMeteogramScene } from "../src/scene/index.js";
import { renderKeySvg, renderMeteogramSvg } from "../src/svg/index.js";
import { deterministicSceneProfile } from "../test/scene-fixtures.js";

const TZ = { timeZone: "America/Vancouver" };

// The deterministic fixture's surface wind walks 220° → 227° across its
// eight hours, so a 200–225° arc splits the window mid-day.
const SW_ARC = { fromDeg: 200, toDeg: 225 } as const;

describe("launchWindows marks", () => {
  it("is a judgment parameter: omitted (or no arcs) draws nothing and reserves no row", () => {
    const bare = buildMeteogramScene(deterministicSceneProfile(), TZ);
    expect(bare.windWindow).toBeNull();
    const empty = buildMeteogramScene(deterministicSceneProfile(), { ...TZ, launchWindows: [] });
    expect(JSON.stringify(empty)).toBe(JSON.stringify(bare));
    const svg = renderMeteogramSvg(bare, { stylesheet: null });
    expect(svg).not.toContain("meteo-gram-wind-window");
    expect(buildKeySpec(bare).windWindow).toBeNull();
  });

  it("marks every hour's surface p50 direction against the arcs, at the hour-tick x", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      launchWindows: [SW_ARC],
    });
    const marks = scene.windWindow!.marks;
    expect(marks).toHaveLength(8);
    // Directions 220..225 are in, 226 and 227 are out.
    expect(marks.map((mark) => mark.inWindow)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
    marks.forEach((mark, index) => {
      expect(mark.hourIndex).toBe(index);
      expect(mark.x).toBe(scene.axes.hours[index].x);
    });
  });

  it("supports wrap-around arcs and unions multiple arcs", () => {
    const wrapped = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      launchWindows: [{ fromDeg: 226, toDeg: 10 }],
    });
    expect(wrapped.windWindow!.marks.map((mark) => mark.inWindow)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
    const north = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      launchWindows: [{ fromDeg: 315, toDeg: 45 }],
    });
    expect(north.windWindow!.marks.every((mark) => !mark.inWindow)).toBe(true);
    const union = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      launchWindows: [
        { fromDeg: 315, toDeg: 45 },
        { fromDeg: 200, toDeg: 260 },
      ],
    });
    expect(union.windWindow!.marks.every((mark) => mark.inWindow)).toBe(true);
  });

  it("draws the row between the plot floor and the hour labels, adding its height honestly", () => {
    const bare = buildMeteogramScene(deterministicSceneProfile(), TZ);
    const scene = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      launchWindows: [SW_ARC],
    });
    const plotBottom = scene.scales.plotTop + scene.scales.plotHeight;
    expect(scene.windWindow!.y).toBeGreaterThan(plotBottom);
    expect(scene.windWindow!.y).toBeLessThan(scene.scales.hourLabelY);
    expect(scene.scales.hourLabelY).toBe(bare.scales.hourLabelY + 10);
    expect(scene.height).toBe(bare.height + 10);
    // The surface-temperature row shifts down with the labels.
    expect(scene.surfaceTemperatures[0].y).toBe(bare.surfaceTemperatures[0].y + 10);
  });

  it("encodes in/out with shape as well as colour: filled triangle in, open circle out", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      launchWindows: [SW_ARC],
    });
    const svg = renderMeteogramSvg(scene, { stylesheet: null });
    expect(svg.match(/class="meteo-gram-wind-window-in"/g)).toHaveLength(6);
    expect(svg.match(/class="meteo-gram-wind-window-out"/g)).toHaveLength(2);
    expect(svg).toMatch(/<path d="M[^"]+Z" class="meteo-gram-wind-window-in"/);
    expect(svg).toMatch(/<circle [^>]*class="meteo-gram-wind-window-out" fill="none"/);
  });

  it("keys the marker pair only when the row drew, with both shapes in the swatch", () => {
    const spec = buildKeySpec(
      buildMeteogramScene(deterministicSceneProfile(), { ...TZ, launchWindows: [SW_ARC] }),
    );
    expect(spec.windWindow).toEqual({
      id: "meteo-gram-wind-window",
      label: "Surface wind in (filled) / out of launch window",
    });
    const key = renderKeySvg(spec, { stylesheet: null });
    expect(key).toContain('class="meteo-gram-wind-window-in"');
    expect(key).toContain('class="meteo-gram-wind-window-out"');
    expect(key).toContain("Surface wind in (filled) / out of launch window");
  });

  it("accepts a label override by entry id", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      launchWindows: [SW_ARC],
    });
    const spec = buildKeySpec(scene, { labels: { "meteo-gram-wind-window": "Launch wind" } });
    expect(spec.windWindow!.label).toBe("Launch wind");
  });
});
