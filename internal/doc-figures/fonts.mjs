import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import opentype from "opentype.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const siteRequire = createRequire(join(root, "scripts", "package.json"));

const FAMILIES = {
  "big-shoulders": { pkg: "@fontsource/big-shoulders", weights: [700, 800] },
  "ibm-plex-sans": { pkg: "@fontsource/ibm-plex-sans", weights: [400, 500, 600, 700] },
  "ibm-plex-mono": { pkg: "@fontsource/ibm-plex-mono", weights: [400, 500, 600, 700] },
};

const fontCache = new Map();

function fontFile(familyKey, weight) {
  const family = FAMILIES[familyKey];
  const pkgDir = dirname(siteRequire.resolve(`${family.pkg}/package.json`));
  return join(pkgDir, "files", `${familyKey}-latin-${weight}-normal.woff`);
}

export function getFont(familyKey, weight = 400) {
  const family = FAMILIES[familyKey];
  if (!family) throw new Error(`Unknown font family key: ${familyKey}`);
  const snapped = family.weights.reduce((best, candidate) =>
    Math.abs(candidate - weight) < Math.abs(best - weight) ? candidate : best,
  );
  const cacheKey = `${familyKey}-${snapped}`;
  let font = fontCache.get(cacheKey);
  if (!font) {
    const bytes = readFileSync(fontFile(familyKey, snapped));
    font = opentype.parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    fontCache.set(cacheKey, font);
  }
  return font;
}

export function familyKey(cssFamily) {
  const value = cssFamily.toLowerCase();
  if (value.includes("big shoulders")) return "big-shoulders";
  if (value.includes("mono")) return "ibm-plex-mono";
  return "ibm-plex-sans";
}

function coordinate(value) {
  if (!Number.isFinite(value)) throw new Error(`Non-finite coordinate in glyph outline: ${value}`);
  return String(Math.round(value * 100) / 100);
}

/* Serialized from each glyph's raw font-unit commands, never opentype's
   getPath/toPathData: those shapers emit NaN path data for some sequences in
   these WOFF builds (2.x corrupts single glyphs too — hence the 1.3.5 pin). */
function glyphPathData(glyph, x, y, scale) {
  const px = (value) => coordinate(x + value * scale);
  const py = (value) => coordinate(y - value * scale);
  const parts = [];
  for (const cmd of glyph.path.commands) {
    if (cmd.type === "M") parts.push(`M${px(cmd.x)} ${py(cmd.y)}`);
    else if (cmd.type === "L") parts.push(`L${px(cmd.x)} ${py(cmd.y)}`);
    else if (cmd.type === "Q") parts.push(`Q${px(cmd.x1)} ${py(cmd.y1)} ${px(cmd.x)} ${py(cmd.y)}`);
    else if (cmd.type === "C")
      parts.push(
        `C${px(cmd.x1)} ${py(cmd.y1)} ${px(cmd.x2)} ${py(cmd.y2)} ${px(cmd.x)} ${py(cmd.y)}`,
      );
    else if (cmd.type === "Z") parts.push("Z");
    else throw new Error(`Unsupported path command ${cmd.type}`);
  }
  return parts.join("");
}

function shapeRun(font, text, x, y, sizePx, letterSpacingPx) {
  const scale = sizePx / font.unitsPerEm;
  const placements = [];
  let cursor = x;
  let previous = null;
  for (const character of text) {
    const glyph = font.charToGlyph(character);
    if (glyph.index === 0 && character !== " ") {
      throw new Error(`No glyph for ${JSON.stringify(character)} in the latin brand faces`);
    }
    if (previous) cursor += font.getKerningValue(previous, glyph) * scale;
    if (glyph.path.commands.length > 0) placements.push({ glyph, x: cursor });
    cursor += glyph.advanceWidth * scale + letterSpacingPx;
    previous = glyph;
  }
  return { placements, width: cursor - x };
}

export function measureText(text, spec) {
  const font = getFont(spec.family ?? "ibm-plex-sans", spec.weight ?? 400);
  return shapeRun(font, text, 0, 0, spec.size ?? 16, spec.letterSpacing ?? 0).width;
}

export function wrapText(text, maxWidthPx, spec) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measureText(candidate, spec) > maxWidthPx) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const XML_UNESCAPES = [
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, '"'],
  [/&apos;/g, "'"],
  [/&#39;/g, "'"],
  [/&amp;/g, "&"],
];

function unescapeXml(value) {
  return XML_UNESCAPES.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value,
  );
}

function parseAttributes(raw) {
  const attrs = {};
  for (const [, name, value] of raw.matchAll(/([a-zA-Z_:][-\w:.]*)\s*=\s*"([^"]*)"/g)) {
    attrs[name] = value;
  }
  return attrs;
}

function parsePx(value, relativeToPx = 16) {
  const trimmed = value.trim();
  if (trimmed.endsWith("em")) return Number.parseFloat(trimmed) * relativeToPx;
  return Number.parseFloat(trimmed);
}

function parseWeight(value) {
  if (value === "bold") return 700;
  if (value === "normal") return 400;
  return Number.parseFloat(value) || 400;
}

function parseClassRules(svg) {
  const rules = [];
  for (const [, css] of svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    const resolved = css.replace(/var\(--[\w-]+,\s*([^)]+)\)/g, "$1");
    for (const [, selectors, body] of resolved.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const props = {};
      for (const declaration of body.split(";")) {
        const colon = declaration.indexOf(":");
        if (colon < 0) continue;
        props[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
      }
      for (const selector of selectors.split(",")) {
        const match = /^\.(?:([\w-]+) \.)?([\w-]+)$/.exec(selector.trim());
        if (match && match[2] !== "meteo-gram" && match[2] !== match[1]) {
          rules.push({ className: match[2], props });
        }
      }
    }
  }
  return rules;
}

const CONSUMED_ATTRIBUTES = new Set([
  "x",
  "y",
  "text-anchor",
  "font-family",
  "font-size",
  "font-weight",
  "letter-spacing",
]);

/* idPrefix namespaces the shared glyph defs (tg0, tg1, …). Figures that are
   inlined as real <svg> elements share one HTML document per page, so two
   figures on the same page would otherwise resolve each other's glyphs. */
export function convertTextToPaths(svg, { idPrefix = "" } = {}) {
  const rules = parseClassRules(svg);
  const defs = new Map();

  function glyphUse(font, familyName, weight, glyph, size, x, y) {
    const key = `${familyName}-${weight}-${glyph.index}-${size}`;
    let entry = defs.get(key);
    if (!entry) {
      entry = {
        id: `${idPrefix}tg${defs.size}`,
        d: glyphPathData(glyph, 0, 0, size / font.unitsPerEm),
      };
      defs.set(key, entry);
    }
    return `<use href="#${entry.id}" x="${coordinate(x)}" y="${coordinate(y)}"/>`;
  }

  const converted = svg.replace(
    /<text\b([^>]*)>([\s\S]*?)<\/text>/g,
    (element, rawAttrs, rawContent) => {
      if (rawContent.includes("<")) {
        throw new Error(`Unsupported nested markup inside <text>: ${element}`);
      }
      const attrs = parseAttributes(rawAttrs);
      const content = unescapeXml(rawContent);
      if (!content.trim()) return "";

      const classes = (attrs.class ?? "").split(/\s+/).filter(Boolean);
      let family = "ibm-plex-sans";
      let size = 16;
      let weight = 400;
      let letterSpacingRaw = null;
      for (const rule of rules) {
        if (!classes.includes(rule.className)) continue;
        if (rule.props["font-family"]) family = familyKey(rule.props["font-family"]);
        if (rule.props["font-size"]) size = parsePx(rule.props["font-size"]);
        if (rule.props["font-weight"]) weight = parseWeight(rule.props["font-weight"]);
        if (rule.props["letter-spacing"]) letterSpacingRaw = rule.props["letter-spacing"];
      }
      if (attrs["font-family"]) family = familyKey(attrs["font-family"]);
      if (attrs["font-size"]) size = parsePx(attrs["font-size"]);
      if (attrs["font-weight"]) weight = parseWeight(attrs["font-weight"]);
      if (attrs["letter-spacing"]) letterSpacingRaw = attrs["letter-spacing"];
      const letterSpacing = letterSpacingRaw ? parsePx(letterSpacingRaw, size) : 0;

      const font = getFont(family, weight);
      let x = Number.parseFloat(attrs.x ?? "0");
      const y = Number.parseFloat(attrs.y ?? "0");
      const run = shapeRun(font, content, 0, 0, size, letterSpacing);
      if (attrs["text-anchor"] === "middle") x -= run.width / 2;
      else if (attrs["text-anchor"] === "end") x -= run.width;

      if (run.placements.length === 0) return "";
      const uses = run.placements
        .map((placement) =>
          glyphUse(font, family, weight, placement.glyph, size, x + placement.x, y),
        )
        .join("");
      const kept = Object.entries(attrs)
        .filter(([name]) => !CONSUMED_ATTRIBUTES.has(name))
        .map(([name, value]) => ` ${name}="${value}"`)
        .join("");
      return `<g${kept}>${uses}</g>`;
    },
  );
  if (/<text\b/.test(converted)) {
    throw new Error("Text-to-path conversion left <text> elements behind");
  }
  if (defs.size === 0) return converted;
  const defsMarkup = `<defs>${[...defs.values()].map((entry) => `<path id="${entry.id}" d="${entry.d}"/>`).join("")}</defs>`;
  return converted.replace(/(<svg\b[^>]*>)/, `$1\n${defsMarkup}`);
}
