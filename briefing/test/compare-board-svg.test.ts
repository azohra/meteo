import { describe, expect, it } from "vitest";
import { compareAnalyses } from "../src/compare.js";
import {
  BOARD_TOKEN_DEFAULTS,
  buildCompareBoardScene,
  DEFAULT_BOARD_STYLESHEET,
  renderCompareBoardSvg,
} from "../src/compare-board/index.js";
import { boardAnalyses } from "./compare-board-fixtures.js";

function boardSvg(): string {
  const analyses = boardAnalyses();
  const scene = buildCompareBoardScene(analyses, compareAnalyses(analyses), {
    dateKey: "2026-08-09",
    timeZone: "America/Vancouver",
  });
  return renderCompareBoardSvg(scene);
}

describe("golden compare-board SVG", () => {
  it("matches the compare-board golden", async () => {
    await expect(boardSvg()).toMatchFileSnapshot("golden/compare-board.svg");
  });
});

describe("renderCompareBoardSvg structure", () => {
  const svg = boardSvg();

  it("is a self-contained SVG document with the default stylesheet", () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain("<style>");
    expect(svg).toContain(`--meteo-board-window, ${BOARD_TOKEN_DEFAULTS.window}`);
    expect(svg).toContain(`--meteo-board-limit, ${BOARD_TOKEN_DEFAULTS.limit}`);
  });

  it("derives every stylesheet fallback from the exported token map", () => {
    let sheet = DEFAULT_BOARD_STYLESHEET;
    for (const [name, value] of Object.entries(BOARD_TOKEN_DEFAULTS)) {
      sheet = sheet.replaceAll(`var(--meteo-board-${name}, ${value})`, "");
    }
    expect(sheet).not.toContain("var(--meteo-board-");
  });

  it("is accessible: labelled as an image, with text equivalents on every row", () => {
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-labelledby="meteo-board-title"');
    expect(svg).toContain("Compare board — 2026-08-09 (America/Vancouver), 3 members");
    /* Each row narrates its lane: window words with the data-boundary
       phrasing, exceedances against the caller's ceiling, rain onset. */
    expect(svg).toContain("window opens 09:00, still open at 14:00");
    expect(svg).toContain("surface wind at or above 3 m/s");
    expect(svg).toContain("rain from 11:00");
    expect(svg).toContain("cap breaks 09:00");
  });

  it("never converts units: winds stay m/s and the gust cell carries its class", () => {
    expect(svg).toContain("LAUNCH m/s");
    expect(svg).toContain("13.5 inst");
    expect(svg).not.toContain("km/h");
  });

  it("marks the ensemble row and encodes marks by shape and position, not colour alone", () => {
    expect(svg).toContain("ENSEMBLE");
    expect(svg).toContain('class="meteo-board-window-clip"');
    expect(svg).toContain("meteo-board-limit meteo-board-limit-surfaceWind");
    expect(svg).toContain('class="meteo-board-rain"');
    expect(svg).toContain('class="meteo-board-cap"');
  });

  it("prefixes generated ids so two boards can share a page", () => {
    const prefixed = renderCompareBoardSvg(
      buildCompareBoardScene(boardAnalyses(), null, {
        dateKey: "2026-08-09",
        timeZone: "America/Vancouver",
      }),
      { idPrefix: "second-board" },
    );
    expect(prefixed).toContain('aria-labelledby="second-board-title"');
    expect(prefixed).not.toContain('"meteo-board-title"');
  });
});
