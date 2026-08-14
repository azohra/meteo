import { describe, expect, it } from "vitest";
import { buildMeteogramScene } from "../src/scene/index.js";
import {
  DEFAULT_STYLESHEET,
  STABILITY_TOKEN_DEFAULTS,
  TOKEN_DEFAULTS,
  renderMeteogramSvg,
} from "../src/svg/index.js";
import {
  deterministicSceneProfile,
  ensembleSceneProfile,
  SCENE_LAUNCH,
  scienceSceneProfile,
} from "../test/scene-fixtures.js";

const TZ = { timeZone: "America/Vancouver", launch: SCENE_LAUNCH };

function deterministicSvg(): string {
  return renderMeteogramSvg(
    buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      overlays: { thermalIndex: true, windShear: true, buoyancyShear: true },
    }),
  );
}

function ensembleSvg(): string {
  return renderMeteogramSvg(buildMeteogramScene(ensembleSceneProfile(), TZ));
}

function scienceSvg(): string {
  return renderMeteogramSvg(buildMeteogramScene(scienceSceneProfile(), TZ));
}

function selectionSvg(): string {
  return renderMeteogramSvg(
    buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      selection: { hourIndex: 2, altitudeM: 1500 },
    }),
  );
}

describe("golden SVG fixtures", () => {
  it("matches the deterministic golden", async () => {
    await expect(deterministicSvg()).toMatchFileSnapshot("golden/deterministic.svg");
  });

  it("matches the ensemble golden", async () => {
    await expect(ensembleSvg()).toMatchFileSnapshot("golden/ensemble.svg");
  });

  it("matches the science golden", async () => {
    await expect(scienceSvg()).toMatchFileSnapshot("golden/science.svg");
  });

  it("matches the selection golden", async () => {
    await expect(selectionSvg()).toMatchFileSnapshot("golden/selection.svg");
  });
});

describe("renderMeteogramSvg structure", () => {
  const svg = deterministicSvg();

  it("is a self-contained SVG document with the default stylesheet", () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain("<style>");
    expect(svg).toContain(
      `--meteo-gram-stab-very-unstable, ${STABILITY_TOKEN_DEFAULTS["very-unstable"]}`,
    );
    expect(svg).toContain(`--meteo-gram-pbl, ${TOKEN_DEFAULTS.pbl}`);
    expect(svg).toContain(
      `.meteo-gram-marker-cloud { fill: var(--meteo-gram-cloud-marker, ${TOKEN_DEFAULTS["cloud-marker"]}); stroke: var(--meteo-gram-cloud-base, ${TOKEN_DEFAULTS["cloud-base"]}); }`,
    );
  });

  it("derives every stylesheet fallback from the exported token maps", () => {
    let sheet = DEFAULT_STYLESHEET;
    for (const element of ["series", "barb", "marker", "text"]) {
      sheet = sheet.replaceAll(
        `var(--meteo-gram-halo-${element}, var(--meteo-gram-halo, ${TOKEN_DEFAULTS.halo}))`,
        "",
      );
    }
    for (const [name, value] of Object.entries(TOKEN_DEFAULTS)) {
      sheet = sheet.replaceAll(`var(--meteo-gram-${name}, ${value})`, "");
    }
    for (const [name, value] of Object.entries(STABILITY_TOKEN_DEFAULTS)) {
      sheet = sheet.replaceAll(`var(--meteo-gram-stab-${name}, ${value})`, "");
    }
    expect(sheet).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(sheet).not.toContain("var(");
  });

  it("styles by class name only — no hardcoded hex outside the stylesheet", () => {
    const body = svg.slice(svg.indexOf("</style>"));
    expect(body).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });

  it("draws the stability field, hatch pattern, series, barbs and labels", () => {
    expect(svg).toContain('class="meteo-gram-stab-');
    expect(svg).toContain('id="meteo-gram-cloud-hatch"');
    expect(svg).toContain('fill="url(#meteo-gram-cloud-hatch)"');
    expect(svg).toContain('class="meteo-gram-series-usable"');
    expect(svg).toContain('class="meteo-gram-barb"');
    expect(svg).toContain(">7</text>");
    expect(svg).toContain("launch 1485 m");
  });

  it("renders the new overlay strips and fields when enabled", () => {
    expect(svg).toContain('class="meteo-gram-strip-buoyancyShear"');
    expect(svg).toContain('class="meteo-gram-ti-');
    expect(svg).toContain('class="meteo-gram-shear-');
  });

  it("draws the consumer selection from the scene's resolved geometry, ring over the barbs", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), {
      ...TZ,
      selection: { hourIndex: 2, altitudeM: 1500 },
    });
    const rendered = renderMeteogramSvg(scene);
    expect(rendered).toContain('class="meteo-gram-selection-column"');
    expect(rendered).toContain('class="meteo-gram-selection-line"');
    const barb = scene.selection!.barb!;
    expect(rendered).toContain(`<circle cx="${barb.x}"`);
    expect(rendered).toContain(`r="${12 * barb.scale}" class="meteo-gram-selection-ring"`);
    expect(rendered.indexOf('class="meteo-gram-selection-ring"')).toBeGreaterThan(
      rendered.lastIndexOf('class="meteo-gram-barb"'),
    );
    const bare = deterministicSvg();
    expect(bare.slice(bare.indexOf("</style>"))).not.toContain("meteo-gram-selection-");
  });

  it("renders ensemble bands for strips and series", () => {
    const ensemble = ensembleSvg();
    expect(ensemble).toContain('class="meteo-gram-strip-thermalStrength-band"');
    expect(ensemble).toContain('class="meteo-gram-series-usable-band"');
    expect(ensemble).not.toContain('class="meteo-gram-stab-');
  });

  it("renders the science-wave elements: CAPE cells, cloud-layer rows, gusts, PBL series", () => {
    const science = scienceSvg();
    expect(science).toContain('class="meteo-gram-cape-severe meteo-gram-cape-capped"');
    expect(science).toContain('class="meteo-gram-cape-calm"');
    expect(science).toContain('class="meteo-gram-strip-cape"');
    expect(science).toContain('class="meteo-gram-cloud-cell"');
    expect(science).toContain(">H</text>");
    expect(science).toContain(">L</text>");
    expect(science).toContain(">G22</text>");
    expect(science).toContain('class="meteo-gram-series-pbl"');
  });

  it("carries a strip cell's data-driven opacity into the markup", () => {
    const profile = deterministicSceneProfile();
    profile.hours[0].smoke = { surfaceUgm3: 184.6, columnMgm2: 228.2, aot: 1.018 };
    const svg = renderMeteogramSvg(buildMeteogramScene(profile, TZ), { stylesheet: null });
    expect(svg).toContain('class="meteo-gram-smoke-cell" opacity="0.34"');
  });

  it("adds no science markup for a profile without the fields", () => {
    const svg = renderMeteogramSvg(buildMeteogramScene(deterministicSceneProfile(), TZ), {
      stylesheet: null,
    });
    expect(svg).not.toContain("meteo-gram-cape");
    expect(svg).not.toContain("meteo-gram-cloud-cell");
    expect(svg).not.toContain("meteo-gram-gust");
    expect(svg).not.toContain("meteo-gram-series-pbl");
  });

  it("leaves nothing unremovable except the axes and frame", () => {
    const everythingOff = renderMeteogramSvg(
      buildMeteogramScene(scienceSceneProfile(), {
        ...TZ,
        overlays: {
          temperature: false,
          wind: false,
          clouds: false,
          thermalStrength: false,
          stability: false,
          cape: false,
          gusts: false,
          pblHeight: false,
          cloudLayers: false,
          pressure: false,
          precipitation: false,
          boundaryLayerTop: false,
          cloudBase: false,
          usableLiftTop: false,
          launch: false,
          selectedHour: false,
          surfaceTemperature: false,
        },
      }),
      { stylesheet: null },
    );
    for (const forbidden of [
      "meteo-gram-strip-",
      "meteo-gram-series-",
      "meteo-gram-surface-temp",
      "meteo-gram-stab-",
      "meteo-gram-cloud-dense",
      "meteo-gram-cloud-medium",
      "meteo-gram-cloud-light",
      "meteo-gram-cloud-cell",
      "meteo-gram-cape-",
      "meteo-gram-barb",
      "meteo-gram-gust",
      "meteo-gram-marker-",
      "meteo-gram-isotherm",
      "meteo-gram-launch-line",
      "meteo-gram-selected-column",
      "meteo-gram-selected-line",
      "launch 1485 m",
    ]) {
      expect(everythingOff, forbidden).not.toContain(forbidden);
    }
    expect(everythingOff).toContain('class="meteo-gram-frame"');
    expect(everythingOff).toContain('class="meteo-gram-gridline"');
    expect(everythingOff).toContain('class="meteo-gram-tick"');
    expect(everythingOff).toContain('class="meteo-gram-hour-tick meteo-gram-mono"');
  });

  it("removes the derived-height lines and selected-hour highlight per toggle", () => {
    const scene = buildMeteogramScene(scienceSceneProfile(), {
      ...TZ,
      overlays: { boundaryLayerTop: false, cloudBase: false, selectedHour: false },
    });
    const svg = renderMeteogramSvg(scene, { stylesheet: null });
    expect(svg).not.toContain("meteo-gram-series-boundary");
    expect(svg).not.toContain("meteo-gram-series-cloud-base");
    expect(svg).not.toContain("meteo-gram-marker-cloud");
    expect(svg).not.toContain("meteo-gram-selected-column");
    expect(svg).toContain('class="meteo-gram-series-usable"');
    expect(svg).toContain('class="meteo-gram-series-pbl"');
    expect(svg).toContain('class="meteo-gram-marker-wing"');
  });

  it("honours idPrefix and stylesheet overrides", () => {
    const scene = buildMeteogramScene(deterministicSceneProfile(), TZ);
    const custom = renderMeteogramSvg(scene, { idPrefix: "left", stylesheet: null });
    expect(custom).toContain('id="left-cloud-hatch"');
    expect(custom).toContain('fill="url(#left-cloud-hatch)"');
    expect(custom).not.toContain("<style>");
    expect(DEFAULT_STYLESHEET).toContain(".meteo-gram-cloud-hatch-line");
  });
});
