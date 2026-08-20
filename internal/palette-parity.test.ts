import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/* The palettes are deliberately stated twice — the station package must
   render with no site present, and the figure generators re-type specific
   hexes at declared boundaries — but nothing else may keep them honest.
   These tests hold every mirror to its source. Merging the palettes is
   not the fix; see site/src/styles/theme.css's header. */

const ROOT = join(__dirname, "..");
const themeCss = readFileSync(join(ROOT, "site", "src", "styles", "theme.css"), "utf-8");
const stationCss = readFileSync(join(ROOT, "station", "styles.css"), "utf-8");

/** station/styles.css's token block: full token name → normalized value. */
function stationTokens(): Map<string, string> {
  const marker = ":where(.meteo-root) {";
  const start = stationCss.indexOf(marker);
  expect(start, "station/styles.css token block").toBeGreaterThanOrEqual(0);
  const block = stationCss.slice(start, stationCss.indexOf("\n}", start));
  const tokens = new Map<string, string>();
  for (const match of block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
    tokens.set(match[1] as string, (match[2] as string).replace(/\s+/g, " ").trim());
  }
  return tokens;
}

/** light-dark(a, b) → [a, b], splitting at the top-level comma only. */
function lightDarkArms(value: string): [string, string] {
  const inner = value.match(/^light-dark\((.*)\)$/)?.[1];
  expect(inner, `${value} is a light-dark() pair`).toBeDefined();
  let depth = 0;
  for (let i = 0; i < (inner as string).length; i += 1) {
    const char = (inner as string)[i];
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      return [(inner as string).slice(0, i).trim(), (inner as string).slice(i + 1).trim()];
    }
  }
  throw new Error(`no top-level comma in ${value}`);
}

describe("theme.css mirrors of station/styles.css (/* = --meteo-* */ lines)", () => {
  const tokens = stationTokens();
  const annotated = [
    ...themeCss.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);\s*\/\* = (--meteo-[a-z0-9-]+) \*\//gm),
  ];

  it("the annotation convention is still in use (the parser found the lines)", () => {
    const names = annotated.map((match) => match[3]);
    expect(names).toContain("--meteo-surface");
    expect(names).toContain("--meteo-freshness-live");
    expect(names).toContain("--meteo-band-4");
  });

  for (const match of annotated) {
    const [, siteName, value, stationName] = match as unknown as [string, string, string, string];
    it(`${siteName} = ${stationName}`, () => {
      expect(tokens.get(stationName), `${stationName} exists in station/styles.css`).toBeDefined();
      expect(value.replace(/\s+/g, " ").trim()).toBe(tokens.get(stationName));
    });
  }
});

describe("figure-generator hexes mirrored from the site palette (targets.mjs)", () => {
  const targets = readFileSync(join(ROOT, "internal", "doc-figures", "targets.mjs"), "utf-8");
  const mirrors = [...targets.matchAll(/^const (?:SITE|NIGHT)_[A-Z_]+ = "(#[0-9a-f]{3,8})";/gm)];

  it("the SITE_*/NIGHT_* constants are still hex mirrors (the parser found them)", () => {
    expect(mirrors.length).toBeGreaterThanOrEqual(15);
  });

  for (const match of mirrors) {
    const [line, hex] = match as unknown as [string, string];
    it(`${line.split(" =")[0]} (${hex}) appears in theme.css`, () => {
      expect(themeCss.includes(hex)).toBe(true);
    });
  }
});

describe("token-map panel hexes mirrored from station/styles.css (generate-station-assets.mjs)", () => {
  /* tokenMapSvg's fixed literals depict station's own palette (see the
     intent comment there); each is one arm of one station token. */
  const literals: Array<[string, string, 0 | 1]> = [
    ["#ffffff", "--meteo-surface", 0],
    ["#dbe2e9", "--meteo-border", 0],
    ["#17232e", "--meteo-ink", 0],
    ["#10161d", "--meteo-surface", 1],
    ["#2b3844", "--meteo-border", 1],
    ["#e7edf3", "--meteo-ink", 1],
    ["#62717f", "--meteo-muted", 0],
    ["#f4f6f9", "--meteo-surface-raised", 0],
  ];
  const generator = readFileSync(join(ROOT, "internal", "generate-station-assets.mjs"), "utf-8");
  const tokens = stationTokens();

  for (const [hex, token, arm] of literals) {
    it(`${hex} is ${token}'s ${arm === 0 ? "light" : "dark"} arm and still typed in the generator`, () => {
      expect(generator.includes(hex), `${hex} in generate-station-assets.mjs`).toBe(true);
      const value = tokens.get(token);
      expect(value, `${token} exists in station/styles.css`).toBeDefined();
      expect(lightDarkArms(value as string)[arm]).toBe(hex);
    });
  }
});
