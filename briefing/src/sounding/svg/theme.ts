import { PALETTE } from "../../palette.js";

/**
 * Default values for every `--meteo-sounding-*` token the sounding
 * stylesheet declares — the one home for which token wears which value,
 * following the Meteogram theme module's generated-stylesheet pattern.
 * Keys are the token suffixes (`temp` maps to `--meteo-sounding-temp`).
 * Shared meanings read the shared palette — the same cloud base is the
 * same colour on both charts — but the sounding is themed only through
 * its own family.
 */
export const SOUNDING_TOKEN_DEFAULTS = {
  font: PALETTE.fontSans,
  "font-mono": PALETTE.fontMono,
  "text-tick": "10.5px",
  "text-trace-label": "10.5px",
  "text-mark-label": "10px",
  "text-note": "9.5px",
  "text-unit": "9.5px",
  "text-key-label": "10.5px",
  surface: PALETTE.surface,
  rule: PALETTE.rule,
  ink: PALETTE.ink,
  "ink-soft": PALETTE.inkSoft,
  "ink-mute": PALETTE.inkMute,
  halo: PALETTE.surface,
  temp: PALETTE.temp,
  dewpoint: "#2e8b50",
  parcel: "#7b5ea7",
  lcl: "#7b5ea7",
  boundary: PALETTE.boundary,
  "cloud-base": PALETTE.cloudBase,
  usable: PALETTE.usable,
  launch: PALETTE.ink,
  wind: PALETTE.cloudBase,
} as const;

/** `var(--meteo-sounding-<name>, <default>)` with the fallback read from SOUNDING_TOKEN_DEFAULTS. */
function v(name: keyof typeof SOUNDING_TOKEN_DEFAULTS): string {
  return `var(--meteo-sounding-${name}, ${SOUNDING_TOKEN_DEFAULTS[name]})`;
}

/** Trace class -> its colour token — the one home for that correspondence, for legends and focus styles. */
export const SOUNDING_TRACE_TOKENS = {
  "meteo-sounding-temp": "temp",
  "meteo-sounding-dewpoint": "dewpoint",
  "meteo-sounding-parcel": "parcel",
} as const satisfies Readonly<Record<string, keyof typeof SOUNDING_TOKEN_DEFAULTS>>;

/** Mark class -> its colour token — the one home for that correspondence. */
export const SOUNDING_MARK_TOKENS = {
  "meteo-sounding-mark-boundary": "boundary",
  "meteo-sounding-mark-cloud-base": "cloud-base",
  "meteo-sounding-mark-usable": "usable",
  "meteo-sounding-mark-launch": "launch",
} as const satisfies Readonly<Record<string, keyof typeof SOUNDING_TOKEN_DEFAULTS>>;

/* Labels carry no per-series colour rule: text wears ink, and the trace's
   line-chip or the mark's own line carries the hue beside it. */
function traceRules(className: keyof typeof SOUNDING_TRACE_TOKENS): string {
  const token = SOUNDING_TRACE_TOKENS[className];
  return [
    `.${className} { stroke: ${v(token)}; }`,
    `.${className}-dot { fill: ${v(token)}; stroke: ${v("halo")}; }`,
    `.${className}-band { fill: ${v(token)}; opacity: 0.14; }`,
  ].join("\n");
}

function markRules(className: keyof typeof SOUNDING_MARK_TOKENS): string {
  const token = SOUNDING_MARK_TOKENS[className];
  return [
    `.${className} { stroke: ${v(token)}; }`,
    `.${className}-band { fill: ${v(token)}; opacity: 0.14; }`,
  ].join("\n");
}

export const DEFAULT_SOUNDING_STYLESHEET = `
.meteo-sounding text { font-family: ${v("font")}; }
.meteo-sounding .meteo-sounding-mono { font-family: ${v("font-mono")}; }
.meteo-sounding-frame { fill: ${v("surface")}; stroke: ${v("rule")}; }
.meteo-sounding-gridline { stroke: ${v("rule")}; }
.meteo-sounding-tick { fill: ${v("ink-mute")}; font-size: ${v("text-tick")}; }
.meteo-sounding-unit { fill: ${v("ink-mute")}; font-size: ${v("text-unit")}; }
.meteo-sounding-trace-label { fill: ${v("ink-soft")}; font-size: ${v("text-trace-label")}; font-weight: 600; }
.meteo-sounding-mark-label { fill: ${v("ink-soft")}; font-size: ${v("text-mark-label")}; font-weight: 600; }
.meteo-sounding-note { fill: ${v("ink-mute")}; font-size: ${v("text-note")}; font-style: italic; }
.meteo-sounding-haloed-text { stroke: ${v("halo")}; paint-order: stroke; }
${traceRules("meteo-sounding-temp")}
${traceRules("meteo-sounding-dewpoint")}
${traceRules("meteo-sounding-parcel")}
${markRules("meteo-sounding-mark-boundary")}
${markRules("meteo-sounding-mark-cloud-base")}
${markRules("meteo-sounding-mark-usable")}
${markRules("meteo-sounding-mark-launch")}
.meteo-sounding-lcl { fill: ${v("lcl")}; stroke: ${v("halo")}; }
.meteo-sounding-lcl-line { stroke: ${v("lcl")}; }
.meteo-sounding-barb { stroke: ${v("wind")}; }
.meteo-sounding-barb-fill { fill: ${v("wind")}; stroke: ${v("wind")}; }
.meteo-sounding-key-label { fill: ${v("ink-mute")}; font-size: ${v("text-key-label")}; }
.meteo-sounding-key-band { fill: ${v("ink-mute")}; opacity: 0.16; }
.meteo-sounding-key-frame { fill: none; stroke: ${v("rule")}; }
`.trim();
