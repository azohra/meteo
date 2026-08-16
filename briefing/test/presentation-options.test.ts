import { describe, expect, it } from "vitest";
import {
  BARB_GLYPH_RADIUS,
  buildMeteogramScene,
  resolveSelection,
  windBarbPaths,
} from "../src/scene/index.js";
import { renderMeteogramSvg } from "../src/svg/index.js";
import {
  deterministicSceneProfile,
  ensembleSceneProfile,
  scienceSceneProfile,
} from "../test/scene-fixtures.js";

const TZ = { timeZone: "America/Vancouver" };

describe("hourLabel", () => {
  it("defaults to 24h — identical to passing nothing, ':00' in the aria label", () => {
    const bare = buildMeteogramScene(deterministicSceneProfile(), TZ);
    const explicit = buildMeteogramScene(deterministicSceneProfile(), { ...TZ, hourLabel: "24h" });
    expect(JSON.stringify(explicit)).toBe(JSON.stringify(bare));
    expect(bare.ariaLabel).toContain("7:00 to 14:00");
  });

  it("renders 12h ticks as 7a … 12p … 2p and threads the aria label", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), { ...TZ, hourLabel: "12h" });
    expect(scene.axes.hours.map((tick) => tick.label)).toEqual([
      "7a",
      "8a",
      "9a",
      "10a",
      "11a",
      "12p",
      "1p",
      "2p",
    ]);
    expect(scene.ariaLabel).toContain("7a to 2p");
    expect(scene.ariaLabel).not.toContain(":00");
  });

  it("labels midnight 12a and noon 12p", () => {
    const sydney = buildMeteogramScene(deterministicSceneProfile(), {
      timeZone: "Australia/Sydney",
      hourLabel: "12h",
    });
    expect(sydney.axes.hours[0].label).toBe("12a");
  });

  it("hands a formatter function the validAt and timezone, verbatim into ticks and aria", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      hourLabel: (validAt, timeZone) => `${new Date(validAt).getUTCHours()}Z/${timeZone}`,
    });
    expect(scene.axes.hours[0].label).toBe("14Z/America/Vancouver");
    expect(scene.ariaLabel).toContain("14Z/America/Vancouver to 21Z/America/Vancouver");
  });
});

describe("geometry-aware barbs", () => {
  it("auto stride is 1 wherever the column covers the glyph footprint", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), TZ);
    const surfaceBarbCount = scene.barbs.filter(
      (barb) => barb.y === Math.max(...scene.barbs.map((entry) => entry.y)),
    ).length;
    expect(surfaceBarbCount).toBe(8);
  });

  it("auto stride widens only when columns get too narrow for the glyph", () => {
    const narrow = buildMeteogramScene(deterministicSceneProfile(), { ...TZ, columnWidthPx: 20 });
    const expectedStride = Math.ceil((2 * BARB_GLYPH_RADIUS * 0.85) / 20);
    expect(expectedStride).toBe(2);
    const barbHourXs = new Set(narrow.barbs.map((barb) => barb.x));
    expect(barbHourXs.size).toBe(4);
  });

  it("an explicit barbStride forces the hour stride, and gusts follow it", () => {
    const scene = buildMeteogramScene(scienceSceneProfile(), { ...TZ, barbStride: 3 });
    const barbXs = [...new Set(scene.barbs.map((barb) => barb.x))].sort((a, b) => a - b);
    const gustXs = scene.gusts.map((gust) => gust.x).sort((a, b) => a - b);
    expect(barbXs).toEqual(gustXs);
    expect(gustXs).toHaveLength(2);
  });

  it("scale follows the pitch: 0.85 at 44px, 1.0 from 66px, pinnable", () => {
    const at = (columnWidthPx?: number, barbScale?: number) =>
      buildMeteogramScene(deterministicSceneProfile(), { ...TZ, columnWidthPx, barbScale }).barbs[0]
        .scale;
    expect(at()).toBe(0.85);
    expect(at(55)).toBeCloseTo(0.925, 6);
    expect(at(66)).toBe(1);
    expect(at(90)).toBe(1);
    expect(at(90, 0.85)).toBe(0.85);
  });

  it("thins a column by pixel gap — surface always drawn, the top always wins", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), { ...TZ, barbMinGapPx: 1000 });
    const columnYs = scene.barbs
      .filter((barb) => barb.x === scene.barbs[0].x)
      .map((barb) => barb.y);
    expect(columnYs).toHaveLength(2);
    const surfaceY = Math.max(...columnYs);
    const topY = Math.min(...columnYs);
    expect(surfaceY).toBeGreaterThan(topY);
  });

  it("default gap thins only what actually collides on the fixture column", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), TZ);
    expect(scene.barbs).toHaveLength(8 * 5);
  });
});

describe("surface barb row", () => {
  it("lifts the surface barbs half a glyph height clear of the plot floor", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), TZ);
    const plotBottom = scene.scales.plotTop + scene.scales.plotHeight;
    const surfaceBarbY = Math.max(...scene.barbs.map((barb) => barb.y));
    expect(surfaceBarbY).toBe(scene.scales.surfaceWindY);
    expect(surfaceBarbY).toBeLessThan(plotBottom);
    expect(plotBottom - surfaceBarbY).toBeCloseTo((25 / 2) * scene.barbs[0].scale, 6);
  });

  it("keeps the gust row clear of the lifted glyphs' rotated reach", () => {
    const scene = buildMeteogramScene(scienceSceneProfile(), TZ);
    const reach = 20 * scene.barbs[0].scale;
    for (const gust of scene.gusts) {
      expect(gust.y).toBeLessThanOrEqual(scene.scales.surfaceWindY - reach);
    }
  });
});

describe("barb glyph geometry", () => {
  it("spaces feathers 4.8 apart on a shaft long enough for the densest sub-50 stack", () => {
    const { shaft } = windBarbPaths(45);
    expect(shaft).toContain("M0 5 L0 -20");
    const featherYs = [...shaft.matchAll(/M0 (-?[\d.]+) L8/g)].map((match) => Number(match[1]));
    expect(featherYs).toEqual([-20, -15.2, -10.4, -5.6]);
    expect(shaft).toContain("M0 -0.8 L4.5");
  });

  it("exports the glyph radius the auto stride sizes against", () => {
    expect(BARB_GLYPH_RADIUS).toBe(20);
  });
});

describe("surfaceTemperature row", () => {
  it("prints one rounded readout per hour under the hour labels", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), TZ);
    expect(scene.surfaceTemperatures).toHaveLength(8);
    expect(scene.surfaceTemperatures[0].label).toBe("8°");
    expect(scene.surfaceTemperatures[7].label).toBe("22°");
    const hourLabelY = scene.scales.plotTop + scene.scales.plotHeight + 18;
    for (const mark of scene.surfaceTemperatures) {
      expect(mark.y).toBeGreaterThan(hourLabelY);
      expect(mark.y).toBeLessThan(scene.height);
    }
  });

  it("rides its toggle: off removes the row and its reserved height", () => {
    const on = buildMeteogramScene(deterministicSceneProfile(), TZ);
    const off = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      overlays: { surfaceTemperature: false },
    });
    expect(off.surfaceTemperatures).toEqual([]);
    expect(off.height).toBe(on.height - 14);
    expect(renderMeteogramSvg(off, { stylesheet: null })).not.toContain("meteo-gram-surface-temp");
  });
});

describe("markerStride", () => {
  it("defaults to a single glyph per line at the selected hour", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), TZ);
    expect(scene.markers.map((marker) => marker.kind).sort()).toEqual(["cloud", "wing"]);
  });

  it("draws a train along the line that always includes the selected hour", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      markerStride: { cloudBase: 2 },
    });
    const clouds = scene.markers.filter((marker) => marker.kind === "cloud");
    const wings = scene.markers.filter((marker) => marker.kind === "wing");
    expect(wings).toHaveLength(1);
    expect(clouds).toHaveLength(4);
    const selectedX = wings[0].x;
    expect(clouds.some((marker) => marker.x === selectedX)).toBe(true);
  });

  it("the object form { every: n } and the bare number say the same thing", () => {
    const object = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      markerStride: { usableLiftTop: { every: 2 } },
    });
    const bare = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      markerStride: { usableLiftTop: 2 },
    });
    expect(JSON.stringify(object.markers)).toBe(JSON.stringify(bare.markers));
  });

  it("pushes clouds before wings so a coincident wing draws over, never under", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      markerStride: { cloudBase: 1, usableLiftTop: 1 },
    });
    const kinds = scene.markers.map((marker) => marker.kind);
    expect(kinds.lastIndexOf("cloud")).toBeLessThan(kinds.indexOf("wing"));
  });

  it("a wing coincident with a cloud tucks below it and says so", () => {
    const profile = deterministicSceneProfile();
    for (const hour of profile.hours) hour.derived.usableLiftTopM = hour.derived.cloudBaseM;
    const scene = buildMeteogramScene(profile, {
      ...TZ,
      markerStride: { cloudBase: 1, usableLiftTop: 1 },
    });
    const cloudYByX = new Map(
      scene.markers
        .filter((marker) => marker.kind === "cloud")
        .map((marker) => [marker.x, marker.y]),
    );
    const wings = scene.markers.filter((marker) => marker.kind === "wing");
    expect(wings.length).toBeGreaterThan(0);
    for (const wing of wings) {
      expect(wing.atCloudBase).toBe(true);
      expect(wing.y).toBe(cloudYByX.get(wing.x)! + 5);
    }
    const apart = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      markerStride: { cloudBase: 1, usableLiftTop: 1 },
    });
    for (const wing of apart.markers.filter((marker) => marker.kind === "wing")) {
      expect(wing.atCloudBase).toBeUndefined();
      expect(wing.y).toBeGreaterThan(cloudYByX.get(wing.x)! + 1);
    }
  });

  it("each train rides its own line's overlay toggle", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      overlays: { cloudBase: false },
      markerStride: { cloudBase: 1 },
    });
    expect(scene.markers.some((marker) => marker.kind === "cloud")).toBe(false);
  });
});

describe("widthPx container fit", () => {
  it("derives the column width so scene.width equals the target", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), { ...TZ, widthPx: 900 });
    expect(scene.width).toBe(900);
    expect(scene.scales.columnWidth).toBeCloseTo((900 - 120) / 8, 9);
  });

  it("wins over columnWidthPx — it is the statement of intent", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      widthPx: 900,
      columnWidthPx: 44,
    });
    expect(scene.width).toBe(900);
  });

  it("windowing happens first: the same target over fewer hours widens columns", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      widthPx: 900,
      hourIndices: [2, 3, 4],
    });
    expect(scene.width).toBe(900);
    expect(scene.scales.columnWidth).toBe(260);
  });

  it("clamps the resolved pitch — the density policy without a probe build", () => {
    const capped = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      widthPx: 900,
      maxColumnWidthPx: 60,
    });
    expect(capped.scales.columnWidth).toBe(60);
    expect(capped.width).toBe(120 + 8 * 60);
    const floored = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      widthPx: 300,
      minColumnWidthPx: 32,
    });
    expect(floored.scales.columnWidth).toBe(32);
    expect(floored.width).toBeGreaterThan(300);
    const conflicted = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      widthPx: 900,
      minColumnWidthPx: 50,
      maxColumnWidthPx: 40,
    });
    expect(conflicted.scales.columnWidth).toBe(50);
    const bare = buildMeteogramScene(deterministicSceneProfile(), { ...TZ, widthPx: 900 });
    const bounded = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      widthPx: 900,
      minColumnWidthPx: 22,
      maxColumnWidthPx: 120,
    });
    expect(JSON.stringify(bounded)).toBe(JSON.stringify(bare));
  });

  it("fitMinColumns keeps a short window from stretching, and only affects the fit", () => {
    const short = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      widthPx: 900,
      hourIndices: [2, 3, 4],
      fitMinColumns: 10,
    });
    expect(short.scales.columnWidth).toBe(78);
    const long = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      widthPx: 900,
      fitMinColumns: 8,
    });
    expect(long.scales.columnWidth).toBeCloseTo((900 - 120) / 8, 9);
    const explicit = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      columnWidthPx: 44,
      hourIndices: [2, 3, 4],
      fitMinColumns: 10,
    });
    expect(explicit.scales.columnWidth).toBe(44);
  });
});

describe("svgHeightPx container fit", () => {
  it("round-trips exactly across strip-stack permutations — the scene solves the panel from its own geometry", () => {
    const builds: Array<[string, () => number]> = [
      [
        "deterministic",
        () => buildMeteogramScene(deterministicSceneProfile(), { ...TZ, svgHeightPx: 620 }).height,
      ],
      [
        "science strips (cape + cloud layers)",
        () => buildMeteogramScene(scienceSceneProfile(), { ...TZ, svgHeightPx: 620 }).height,
      ],
      [
        "buoyancyShear strip added",
        () =>
          buildMeteogramScene(deterministicSceneProfile(), {
            ...TZ,
            overlays: { buoyancyShear: true },
            svgHeightPx: 620,
          }).height,
      ],
      [
        "surfaceTemperature row off",
        () =>
          buildMeteogramScene(scienceSceneProfile(), {
            ...TZ,
            overlays: { surfaceTemperature: false },
            svgHeightPx: 620,
          }).height,
      ],
      [
        "ensemble",
        () => buildMeteogramScene(ensembleSceneProfile(), { ...TZ, svgHeightPx: 620 }).height,
      ],
      [
        "wind-window marker row added",
        () =>
          buildMeteogramScene(deterministicSceneProfile(), {
            ...TZ,
            launchWindows: [{ fromDeg: 180, toDeg: 270 }],
            svgHeightPx: 620,
          }).height,
      ],
      [
        "smoke strip added",
        () => {
          const profile = deterministicSceneProfile();
          for (const hour of profile.hours) {
            hour.smoke = { surfaceUgm3: 40, columnMgm2: 120, aot: 0.6 };
          }
          return buildMeteogramScene(profile, { ...TZ, svgHeightPx: 620 }).height;
        },
      ],
      [
        "measurement strip and provenance divider added",
        () => {
          const profile = deterministicSceneProfile();
          const observations = profile.hours.map((hour) => ({
            observedAt: hour.validAt,
            downwardShortwaveWm2: 500,
          }));
          return buildMeteogramScene(profile, {
            ...TZ,
            svgHeightPx: 620,
            observations: {
              schemaVersion: 1,
              model: "goes18-dsr",
              observed: {
                firstObservedAt: observations[0].observedAt,
                lastObservedAt: observations[observations.length - 1].observedAt,
                generatedAt: "2026-08-10T06:00:00Z",
              },
              site: { id: "dundee", name: "Dundee", latitude: 49.29, longitude: -117.18 },
              observations,
            },
          }).height;
        },
      ],
    ];
    for (const [label, height] of builds) expect(height(), label).toBe(620);
  });

  it("solves the same scene an explicit plotHeightPx would have produced", () => {
    const solved = buildMeteogramScene(deterministicSceneProfile(), { ...TZ, svgHeightPx: 620 });
    const explicit = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      plotHeightPx: solved.scales.plotHeight,
    });
    expect(JSON.stringify(solved)).toBe(JSON.stringify(explicit));
  });

  it("wins over plotHeightPx — the total is the statement of intent", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      svgHeightPx: 620,
      plotHeightPx: 900,
    });
    expect(scene.height).toBe(620);
  });

  it("never solves the panel below 1px — an impossible target overflows instead of inverting", () => {
    const scene = buildMeteogramScene(scienceSceneProfile(), { ...TZ, svgHeightPx: 40 });
    expect(scene.scales.plotHeight).toBe(1);
    expect(scene.height).toBeGreaterThan(40);
  });
});

describe("stripLabels", () => {
  it("overrides display voice while the key stays the identity", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      stripLabels: { thermalStrength: "LIFT" },
    });
    const strip = scene.strips.find((entry) => entry.key === "thermalStrength")!;
    expect(strip.label).toBe("LIFT");
    expect(strip.className).toBe("meteo-gram-strip-thermalStrength");
    expect(scene.strips.find((entry) => entry.key === "pressure")!.label).toBe("Pressure");
  });
});

describe("selection option", () => {
  it("defaults to none — identical to passing nothing", () => {
    const bare = buildMeteogramScene(deterministicSceneProfile(), TZ);
    expect(bare.selection).toBeNull();
    expect(
      JSON.stringify(buildMeteogramScene(deterministicSceneProfile(), { ...TZ, selection: null })),
    ).toBe(JSON.stringify(bare));
  });

  it("resolves the column from the scene's own scales, spanning strips to plot floor", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      selection: { hourIndex: 3 },
    });
    const selection = scene.selection!;
    const { plotLeft, plotTop, plotHeight, columnWidth, stripTop } = scene.scales;
    expect(selection.hourIndex).toBe(3);
    expect(selection.x).toBeCloseTo(plotLeft + 3 * columnWidth, 6);
    expect(selection.width).toBe(columnWidth);
    expect(selection.centerX).toBeCloseTo(selection.x + columnWidth / 2, 6);
    expect(selection.top).toBe(stripTop);
    expect(selection.bottom).toBeCloseTo(plotTop + plotHeight, 6);
    expect(selection.barb).toBeNull();
    expect(scene.selectedHourIndex).not.toBe(3);
  });

  it("snaps a requested altitude to the hour's nearest DRAWN barb", () => {
    const profile = deterministicSceneProfile();
    const scene = buildMeteogramScene(profile, {
      ...TZ,
      selection: { hourIndex: 2, altitudeM: 1500 },
    });
    const barb = scene.selection!.barb!;
    const drawn = scene.barbs.filter((candidate) => candidate.hourIndex === 2);
    expect(drawn.map((candidate) => candidate.altitudeM)).toContain(barb.altitudeM);
    const surface = buildMeteogramScene(profile, {
      ...TZ,
      selection: { hourIndex: 2, altitudeM: scene.scales.floorM },
    });
    expect(surface.selection!.barb!.surface).toBe(true);
    expect(surface.selection!.barb!.y).toBe(surface.scales.surfaceWindY);
  });

  it("resolveSelection IS the build's resolver — an overlay and the drawn pin cannot disagree", () => {
    const request = { hourIndex: 2, altitudeM: 1500 };
    const built = buildMeteogramScene(deterministicSceneProfile(), { ...TZ, selection: request });
    expect(resolveSelection(built, request)).toEqual(built.selection);
    const bare = buildMeteogramScene(deterministicSceneProfile(), TZ);
    expect(resolveSelection(bare, request)).toEqual(built.selection);
    expect(resolveSelection(bare, { hourIndex: 3 })!.barb).toBeNull();
    const empty = buildMeteogramScene(deterministicSceneProfile(), { ...TZ, hourIndices: [] });
    expect(resolveSelection(empty, request)).toBeNull();
  });

  it("clamps the hour into the window and drops the ring when nothing drew", () => {
    const clamped = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      selection: { hourIndex: 99, altitudeM: 2000 },
    });
    expect(clamped.selection!.hourIndex).toBe(clamped.scales.hourCount - 1);
    const windless = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      overlays: { wind: false },
      selection: { hourIndex: 2, altitudeM: 2000 },
    });
    expect(windless.selection!.barb).toBeNull();
  });
});

describe("strip edge extension", () => {
  it("holds terminal values flat to the plot edges, matching the field's full-bleed cells", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), TZ);
    const { plotLeft, plotWidth } = scene.scales;
    for (const strip of scene.strips) {
      expect(strip.linePath.startsWith(`M${plotLeft},`)).toBe(true);
      const lastPair = strip.linePath.trim().split(" ").at(-1)!;
      expect(Number(lastPair.split(",")[0])).toBe(plotLeft + plotWidth);
      expect(strip.areaPath).toContain(`L${plotLeft.toFixed(2)},`);
    }
  });

  it("extends ensemble bands the same way", () => {
    const scene = buildMeteogramScene(ensembleSceneProfile(), TZ);
    const { plotLeft, plotWidth } = scene.scales;
    for (const strip of scene.strips) {
      expect(strip.bandPath!.startsWith(`M${plotLeft},`)).toBe(true);
      expect(strip.bandPath).toContain(`L${plotLeft + plotWidth},`);
    }
  });

  it("does not invent data across a terminal gap", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      overlays: { buoyancyShear: true },
    });
    const strip = scene.strips.find((entry) => entry.key === "buoyancyShear")!;
    expect(strip.values[0]).toBeNull();
    expect(strip.linePath.startsWith(`M${scene.scales.plotLeft},`)).toBe(false);
  });
});

describe("strip scale values", () => {
  it("prints each strip's maximum and minimum at its right edge", () => {
    const svg = renderMeteogramSvg(buildMeteogramScene(deterministicSceneProfile(), TZ));
    expect(svg).toContain('class="meteo-gram-strip-scale meteo-gram-mono">101.3<');
    expect(svg).toContain('class="meteo-gram-strip-scale meteo-gram-mono">101<');
    expect(svg).toContain('class="meteo-gram-strip-scale meteo-gram-mono">0.5<');
  });

  it("row strips keep their tags instead — no scale text where H/M/L sit", () => {
    const scene = buildMeteogramScene(scienceSceneProfile(), TZ);
    const svg = renderMeteogramSvg(scene, { stylesheet: null });
    const layers = scene.strips.find((strip) => strip.key === "cloudLayers");
    expect(layers).toBeDefined();
    const scaleTexts = svg.match(/meteo-gram-strip-scale/g) ?? [];
    const lineStrips = scene.strips.filter((strip) => !strip.rows);
    expect(scaleTexts).toHaveLength(lineStrips.length * 2);
  });
});
