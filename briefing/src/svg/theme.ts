/**
 * The default stability ramp — the one home for these eight hexes; keys
 * are the `meteo-gram-stab-*` class/token suffixes in threshold order
 * (most unstable first). The ramp deliberately lives in a pale register:
 * the field is background, and everything drawn over it keeps
 * figure-ground contrast. Restyle via the --meteo-gram-stab-* tokens.
 */
export const STABILITY_TOKEN_DEFAULTS = {
  "very-unstable": "#d95f52",
  unstable: "#de8f3a",
  "conditional-strong": "#c67eb6",
  conditional: "#aeaad9",
  "near-neutral": "#d7b29b",
  stable: "#768bb9",
  inverted: "#9aa19d",
  "strong-inversion": "#b3b9b6",
} as const;

const STABILITY_RULES = Object.entries(STABILITY_TOKEN_DEFAULTS)
  .map(
    ([name, hex]) => `.meteo-gram-stab-${name} { fill: var(--meteo-gram-stab-${name}, ${hex}); }`,
  )
  .join("\n");

/**
 * Default values for every non-stability `--meteo-gram-*` token
 * DEFAULT_STYLESHEET declares — the one home for these values. Keys are
 * the token suffixes; `text-*` entries are the type scale; the halo
 * tokens are per-element, with `halo-series` defaulting transparent
 * (series lines are bare ink) and `halo-barb` the dark rim that keeps
 * the white barbs legible on any field or bare paper.
 */
export const TOKEN_DEFAULTS = {
  font: '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
  "font-mono": '"IBM Plex Mono", ui-monospace, monospace',
  "text-strip-name": "10.5px",
  "text-strip-unit": "9.5px",
  "text-strip-scale": "8px",
  "text-row-tag": "7.5px",
  "text-tick": "10.5px",
  "text-hour-tick": "11px",
  "text-gust": "9.5px",
  "text-series-label": "10.5px",
  "text-launch": "10.5px",
  "text-surface-temp": "9.5px",
  "text-key-title": "9px",
  "text-key-boundary": "8px",
  "text-key-group": "8px",
  "key-group-ink": "#ffffff",
  "key-group-halo": "#00000066",
  surface: "#fffdf8",
  "strip-bg": "#f2f4f1",
  rule: "#776956",
  ink: "#152529",
  "ink-soft": "#2f454a",
  "ink-mute": "#40565a",
  halo: "#fffdf8",
  "halo-series": "transparent",
  "halo-barb": "#355963",
  accent: "#913b0c",
  selection: "#913b0c",
  temp: "#913b0c",
  pressure: "#963f36",
  rain: "#207a83",
  cloud: "#5b6969",
  lift: "#9a7500",
  bs: "#6d597a",
  cape: "#8a4a08",
  "cape-calm": "#dde3d5",
  "cape-watch": "#e7c46c",
  "cape-risk": "#d98243",
  "cape-severe": "#c04f3a",
  gust: "#355963",
  pbl: "#56609b",
  smoke: "#8c5a3c",
  sun: "#b07a1a",
  "sun-dim": "#43404a",
  "ti-weak": "#f4e3c0",
  "ti-fair": "#ecc57e",
  "ti-good": "#de9b4e",
  "ti-strong": "#c96a33",
  "shear-light": "#cfc3de",
  "shear-moderate": "#a58ec4",
  "shear-strong": "#7b5ea7",
  "rh-60": "#d3e0e3",
  "rh-80": "#a9c7cf",
  "rh-95": "#7fadbb",
  "omega-lift": "#8dc2a0",
  "omega-lift-strong": "#56a377",
  "omega-sink": "#d3a68f",
  "omega-sink-strong": "#bd7d5c",
  boundary: "#a46b10",
  "cloud-base": "#355963",
  "cloud-marker": "#f8f3d8",
  usable: "#2179ad",
  freezing: "#2b748f",
  dewpoint: "#3a7d4f",
  wind: "#ffffff",
} as const;

/** Key-entry id -> the `--meteo-gram-*` token suffix that themes its stroke — the one home for that correspondence. */
export const SERIES_TOKENS = {
  "meteo-gram-series-usable": "usable",
  "meteo-gram-series-cloud-base": "cloud-base",
  "meteo-gram-series-boundary": "boundary",
  "meteo-gram-series-pbl": "pbl",
  "meteo-gram-isotherm": "ink",
  "meteo-gram-isotherm-freezing": "freezing",
  "meteo-gram-dewpoint-isoline": "dewpoint",
} as const satisfies Readonly<Record<string, keyof typeof TOKEN_DEFAULTS>>;

/** Fill token and opacity per field-overlay class — the one home for the facts a ramp chip needs. */
export const FIELD_STYLE_DEFAULTS = {
  "meteo-gram-cloud-medium": { token: "cloud", opacity: 0.22 },
  "meteo-gram-cloud-light": { token: "cloud", opacity: 0.1 },
  "meteo-gram-ti-weak": { token: "ti-weak", opacity: 0.55 },
  "meteo-gram-ti-fair": { token: "ti-fair", opacity: 0.55 },
  "meteo-gram-ti-good": { token: "ti-good", opacity: 0.55 },
  "meteo-gram-ti-strong": { token: "ti-strong", opacity: 0.55 },
  "meteo-gram-shear-light": { token: "shear-light", opacity: 0.5 },
  "meteo-gram-shear-moderate": { token: "shear-moderate", opacity: 0.5 },
  "meteo-gram-shear-strong": { token: "shear-strong", opacity: 0.5 },
  "meteo-gram-rh-60": { token: "rh-60", opacity: 0.5 },
  "meteo-gram-rh-80": { token: "rh-80", opacity: 0.5 },
  "meteo-gram-rh-95": { token: "rh-95", opacity: 0.5 },
  "meteo-gram-omega-lift": { token: "omega-lift", opacity: 0.4 },
  "meteo-gram-omega-lift-strong": { token: "omega-lift-strong", opacity: 0.5 },
  "meteo-gram-omega-sink": { token: "omega-sink", opacity: 0.4 },
  "meteo-gram-omega-sink-strong": { token: "omega-sink-strong", opacity: 0.5 },
} as const satisfies Readonly<
  Record<string, { token: keyof typeof TOKEN_DEFAULTS; opacity: number }>
>;

/** `var(--meteo-gram-<name>, <default>)` with the fallback read from TOKEN_DEFAULTS. */
function v(name: keyof typeof TOKEN_DEFAULTS): string {
  return `var(--meteo-gram-${name}, ${TOKEN_DEFAULTS[name]})`;
}

/** One field class's stylesheet rule, derived from FIELD_STYLE_DEFAULTS. */
function fieldRule(className: keyof typeof FIELD_STYLE_DEFAULTS): string {
  const style = FIELD_STYLE_DEFAULTS[className];
  return `.${className} { fill: ${v(style.token)}; opacity: ${style.opacity}; }`;
}

/** One series class's stroke value, derived from SERIES_TOKENS. */
function seriesStroke(id: keyof typeof SERIES_TOKENS): string {
  return v(SERIES_TOKENS[id]);
}

function haloVar(element: "marker" | "text"): string {
  return `var(--meteo-gram-halo-${element}, ${v("halo")})`;
}

export const DEFAULT_STYLESHEET = `
.meteo-gram text { font-family: ${v("font")}; }
.meteo-gram .meteo-gram-mono { font-family: ${v("font-mono")}; }
.meteo-gram-frame { fill: ${v("surface")}; stroke: ${v("rule")}; }
.meteo-gram-strip-frame { fill: ${v("strip-bg")}; stroke: ${v("rule")}; }
.meteo-gram-gridline { stroke: ${v("rule")}; }
.meteo-gram-hourline { stroke: ${v("ink")}; }
.meteo-gram-text { fill: ${v("ink")}; }
.meteo-gram-text-soft { fill: ${v("ink-soft")}; }
.meteo-gram-text-mute { fill: ${v("ink-mute")}; }
.meteo-gram-strip-name { fill: ${v("ink")}; font-size: ${v("text-strip-name")}; font-weight: 700; }
.meteo-gram-strip-unit { fill: ${v("ink-mute")}; font-size: ${v("text-strip-unit")}; }
.meteo-gram-strip-scale { fill: ${v("ink-mute")}; font-size: ${v("text-strip-scale")}; }
.meteo-gram-tick { fill: ${v("ink-mute")}; font-size: ${v("text-tick")}; }
.meteo-gram-hour-tick { fill: ${v("ink-mute")}; font-size: ${v("text-hour-tick")}; }
.meteo-gram-series-label { font-size: ${v("text-series-label")}; font-weight: 700; }
.meteo-gram-launch-label { fill: ${v("ink")}; font-size: ${v("text-launch")}; font-weight: 600; }
.meteo-gram-surface-temp { fill: ${v("temp")}; font-size: ${v("text-surface-temp")}; font-weight: 700; }
.meteo-gram-haloed-text { stroke: ${haloVar("text")}; paint-order: stroke; }
.meteo-gram-halo { stroke: ${v("halo-series")}; }
.meteo-gram-selected-column { fill: ${v("accent")}; opacity: 0.05; }
.meteo-gram-selected-line { stroke: ${v("accent")}; }
.meteo-gram-selection-column { fill: ${v("selection")}; opacity: 0.07; }
.meteo-gram-selection-line { stroke: ${v("selection")}; }
.meteo-gram-selection-ring { stroke: ${v("selection")}; }
.meteo-gram-launch-line { stroke: ${v("ink")}; }
.meteo-gram-strip-pressure { stroke: ${v("pressure")}; }
.meteo-gram-strip-pressure-area, .meteo-gram-strip-pressure-band { fill: ${v("pressure")}; }
.meteo-gram-strip-precipitation { stroke: ${v("rain")}; }
.meteo-gram-strip-precipitation-area, .meteo-gram-strip-precipitation-band { fill: ${v("rain")}; }
.meteo-gram-strip-cloudCover { stroke: ${v("cloud")}; }
.meteo-gram-strip-cloudCover-area, .meteo-gram-strip-cloudCover-band { fill: ${v("cloud")}; }
.meteo-gram-strip-thermalStrength { stroke: ${v("lift")}; }
.meteo-gram-strip-thermalStrength-area, .meteo-gram-strip-thermalStrength-band { fill: ${v("lift")}; }
.meteo-gram-strip-buoyancyShear { stroke: ${v("bs")}; }
.meteo-gram-strip-buoyancyShear-area, .meteo-gram-strip-buoyancyShear-band { fill: ${v("bs")}; }
.meteo-gram-strip-smoke { stroke: ${v("smoke")}; }
.meteo-gram-strip-smoke-area, .meteo-gram-strip-smoke-band { fill: ${v("smoke")}; }
.meteo-gram-smoke-cell { fill: ${v("smoke")}; }
.meteo-gram-strip-observedIrradiance { stroke: ${v("sun")}; }
.meteo-gram-strip-observedIrradiance-area, .meteo-gram-strip-observedIrradiance-band { fill: ${v("sun")}; }
.meteo-gram-strip-observedIrradiance-dot { fill: ${v("sun")}; }
.meteo-gram-dim-cell { fill: ${v("sun-dim")}; }
.meteo-gram-strip-observedAot { stroke: ${v("smoke")}; }
.meteo-gram-strip-observedAot-area, .meteo-gram-strip-observedAot-band { fill: ${v("smoke")}; }
.meteo-gram-strip-observedAot-dot { fill: ${v("smoke")}; }
.meteo-gram-strip-pending { fill: ${v("ink-mute")}; opacity: 0.07; }
.meteo-gram-strip-source { fill: ${v("ink-mute")}; font-size: 8px; font-style: italic; }
.meteo-gram-strip-divider { stroke: ${v("rule")}; stroke-dasharray: 2 3; stroke-width: 0.8; }
.meteo-gram-strip-divider-label { fill: ${v("ink-mute")}; font-size: 8px; font-style: italic; letter-spacing: 0.04em; }
.meteo-gram-strip-cape { stroke: ${v("cape")}; }
.meteo-gram-strip-cape-area, .meteo-gram-strip-cape-band { fill: ${v("cape")}; }
.meteo-gram-cape-calm { fill: ${v("cape-calm")}; opacity: 0.6; }
.meteo-gram-cape-watch { fill: ${v("cape-watch")}; opacity: 0.6; }
.meteo-gram-cape-risk { fill: ${v("cape-risk")}; opacity: 0.6; }
.meteo-gram-cape-severe { fill: ${v("cape-severe")}; opacity: 0.6; }
.meteo-gram-cape-capped { opacity: 0.28; }
.meteo-gram-bs-unopposed { fill: ${v("bs")}; opacity: 0.18; }
.meteo-gram-cloud-cell { fill: ${v("cloud")}; }
.meteo-gram-strip-row-label { fill: ${v("ink-mute")}; font-size: ${v("text-row-tag")}; }
.meteo-gram-gust { fill: ${v("gust")}; font-size: ${v("text-gust")}; font-weight: 700; }
.meteo-gram-series-pbl { stroke: ${seriesStroke("meteo-gram-series-pbl")}; }
.meteo-gram-series-pbl-band { fill: ${v("pbl")}; opacity: 0.16; }
${STABILITY_RULES}
.meteo-gram-cloud-hatch-line { stroke: ${v("ink-soft")}; }
${fieldRule("meteo-gram-cloud-medium")}
${fieldRule("meteo-gram-cloud-light")}
${fieldRule("meteo-gram-ti-weak")}
${fieldRule("meteo-gram-ti-fair")}
${fieldRule("meteo-gram-ti-good")}
${fieldRule("meteo-gram-ti-strong")}
${fieldRule("meteo-gram-shear-light")}
${fieldRule("meteo-gram-shear-moderate")}
${fieldRule("meteo-gram-shear-strong")}
${fieldRule("meteo-gram-rh-60")}
${fieldRule("meteo-gram-rh-80")}
${fieldRule("meteo-gram-rh-95")}
${fieldRule("meteo-gram-omega-lift")}
${fieldRule("meteo-gram-omega-lift-strong")}
${fieldRule("meteo-gram-omega-sink")}
${fieldRule("meteo-gram-omega-sink-strong")}
.meteo-gram-series-boundary { stroke: ${seriesStroke("meteo-gram-series-boundary")}; }
.meteo-gram-series-boundary-band { fill: ${v("boundary")}; opacity: 0.16; }
.meteo-gram-series-cloud-base { stroke: ${seriesStroke("meteo-gram-series-cloud-base")}; }
.meteo-gram-series-cloud-base-band { fill: ${v("cloud-base")}; opacity: 0.16; }
.meteo-gram-series-usable { stroke: ${seriesStroke("meteo-gram-series-usable")}; }
.meteo-gram-series-usable-band { fill: ${v("usable")}; opacity: 0.16; }
.meteo-gram-isotherm { stroke: ${seriesStroke("meteo-gram-isotherm")}; }
.meteo-gram-isotherm-freezing { stroke: ${seriesStroke("meteo-gram-isotherm-freezing")}; }
.meteo-gram-isotherm-label { fill: ${v("ink")}; }
.meteo-gram-isotherm-label-freezing { fill: ${v("freezing")}; }
.meteo-gram-dewpoint-isoline { stroke: ${seriesStroke("meteo-gram-dewpoint-isoline")}; }
.meteo-gram-dewpoint-label { fill: ${v("dewpoint")}; }
.meteo-gram-barb { stroke: ${v("wind")}; }
.meteo-gram-barb-fill { fill: ${v("wind")}; stroke: ${v("wind")}; }
.meteo-gram-barb-halo { stroke: ${v("halo-barb")}; }
.meteo-gram-barb-fill-halo { fill: ${v("halo-barb")}; stroke: ${v("halo-barb")}; }
.meteo-gram-marker-wing { fill: ${v("usable")}; stroke: ${v("usable")}; }
.meteo-gram-marker-cloud { fill: ${v("cloud-marker")}; stroke: ${v("cloud-base")}; }
.meteo-gram-marker-halo { fill: ${haloVar("marker")}; stroke: ${haloVar("marker")}; }
.meteo-gram-key-label { fill: ${v("ink-mute")}; font-size: ${v("text-tick")}; }
.meteo-gram-key-title { fill: ${v("ink")}; font-size: ${v("text-key-title")}; font-weight: 700; letter-spacing: 0.08em; }
.meteo-gram-key-boundary { fill: ${v("ink-mute")}; font-size: ${v("text-key-boundary")}; }
.meteo-gram-key-group { fill: ${v("key-group-ink")}; stroke: ${v("key-group-halo")}; paint-order: stroke; font-size: ${v("text-key-group")}; font-weight: 700; }
.meteo-gram-key-band { fill: ${v("ink-mute")}; opacity: 0.16; }
.meteo-gram-key-frame { fill: none; stroke: ${v("rule")}; }
`.trim();
