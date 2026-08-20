import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { measureText } from "./fonts.mjs";

const figuresRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { TOKEN_DEFAULTS } = await import(join(figuresRoot, "briefing/dist/meteogram.js")).catch(
  (error) => {
    throw new Error(
      `Cannot load briefing/dist/meteogram — build the workspace first ` +
        `(pnpm build, or run via pnpm figures). ${error.message}`,
    );
  },
);

/* Every ground, rule, and label ink below is emitted as a var() reference
   to one of the eight ancestor chrome tokens the site (and any downstream
   page) supplies — --meteo-gram-surface, strip-bg, ink, ink-soft,
   ink-mute, rule, halo, halo-barb — with the committed light value as the
   fallback: the same bytes render the light plate wherever no ancestor
   sets tokens (GitHub, raw file views) and follow the page theme once
   inlined. Colors that are part of the figures' fixed face (the accent
   annotation inks, the dark code panel and its syntax colors, the brand
   flag) stay resolved literals: they pair with each other, not with the
   page, and the site's :root supplies only the eight chrome tokens. */
const chrome = (name, lightDefault) => `var(--meteo-gram-${name}, ${lightDefault})`;

export const PAGE = chrome("strip-bg", "#f4efe4");
export const SURFACE = chrome("surface", TOKEN_DEFAULTS.surface);
export const SURFACE_RAISED = chrome("strip-bg", "#efe4d3");
export const SURFACE_SUNKEN = chrome("strip-bg", "#e1d3c0");
export const SURFACE_ACCENT = "#f2dcc1";
export const STRIP_BG = chrome("strip-bg", TOKEN_DEFAULTS["strip-bg"]);
export const RULE = chrome("rule", TOKEN_DEFAULTS.rule);
export const RULE_STRONG = chrome("ink-soft", "#51483e");
export const INK = chrome("ink", TOKEN_DEFAULTS.ink);
export const INK_SOFT = chrome("ink-soft", TOKEN_DEFAULTS["ink-soft"]);
export const INK_MUTE = chrome("ink-mute", TOKEN_DEFAULTS["ink-mute"]);
export const HALO = chrome("halo", TOKEN_DEFAULTS.halo);
export const ACCENT = TOKEN_DEFAULTS.accent;
export const ACCENT_STRONG = "#743008";
export const ACCENT_INK = TOKEN_DEFAULTS.surface;
export const FLAG_ORANGE = "#da934a";
export const CODE_BG = TOKEN_DEFAULTS.ink;
export const CODE_TEXT = "#e8e1cf";
export const CODE_STRING = TOKEN_DEFAULTS["rh-95"];

export const SANS = "IBM Plex Sans";
export const MONO = "IBM Plex Mono";
export const DISPLAY = "Big Shoulders";

export function esc(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function round(value) {
  return Math.round(value * 100) / 100;
}

export function t(x, y, content, o = {}) {
  const attrs = [
    `x="${round(x)}"`,
    `y="${round(y)}"`,
    o.anchor ? `text-anchor="${o.anchor}"` : "",
    `fill="${o.fill ?? INK}"`,
    `font-family="${o.font ?? SANS}"`,
    `font-size="${o.size ?? 16}"`,
    o.weight ? `font-weight="${o.weight}"` : "",
    o.ls ? `letter-spacing="${o.ls}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `<text ${attrs}>${esc(content)}</text>`;
}

export function fitSize(text, targetWidth, spec) {
  const probe = 100;
  const width = measureText(text, {
    ...spec,
    size: probe,
    letterSpacing: (spec.letterSpacingEm ?? 0) * probe,
  });
  return round((targetWidth / width) * probe);
}

export function paper(id, width, height, rx = 20) {
  return `<defs>
    <pattern id="${id}-paper-grid" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M24 0H0V24" fill="none" stroke="${RULE}" stroke-opacity=".06" stroke-width="1"/>
    </pattern>
    <marker id="${id}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
      <path d="M0 0l10 5-10 5z" fill="${ACCENT}"/>
    </marker>
  </defs>
  <rect width="${width}" height="${height}" rx="${rx}" fill="${PAGE}"/>
  <rect width="${width}" height="${height}" rx="${rx}" fill="url(#${id}-paper-grid)"/>
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="${rx > 0 ? rx - 1 : 0}" fill="none" stroke="${RULE}" stroke-opacity=".75" stroke-width="2"/>`;
}

export function flag(scale = 1) {
  /* Brand mark: fixed dark ground under fixed orange; not themed by chrome tokens. */
  return `<g transform="scale(${scale})">
      <rect width="104" height="32" rx="2" fill="${CODE_BG}"/>
      <path d="M7 27V7l53 16 15 2 22-14v16z" fill="${FLAG_ORANGE}"/>
    </g>`;
}

export function placeChart(chart, { x, y, width, height }) {
  const w = width ?? round((height * chart.width) / chart.height);
  const h = height ?? round((width * chart.height) / chart.width);
  const markup = chart.svg.replace(
    "<svg ",
    `<svg x="${round(x)}" y="${round(y)}" width="${w}" height="${h}" `,
  );
  return { markup, width: w, height: h };
}

export function codeSegments(line) {
  const segments = [];
  const pattern = /("[^"]*")|(\b(?:import|from|const|if|throw|new)\b)/g;
  let cursor = 0;
  for (const match of line.matchAll(pattern)) {
    if (match.index > cursor)
      segments.push({ text: line.slice(cursor, match.index), fill: CODE_TEXT });
    segments.push({ text: match[0], fill: match[1] ? CODE_STRING : FLAG_ORANGE });
    cursor = match.index + match[0].length;
  }
  if (cursor < line.length) segments.push({ text: line.slice(cursor), fill: CODE_TEXT });
  return segments;
}
