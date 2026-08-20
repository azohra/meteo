import { PALETTE } from "../palette.js";

/**
 * Default values for every `--meteo-board-*` token the board stylesheet
 * declares — the one home for which token wears which value, following
 * the platform's `meteo-<family>-*` token convention (the Meteogram's
 * `meteo-gram-*` is the sibling); values the charts share come from the
 * palette module. Keys are the token suffixes; restyle by setting the
 * custom properties, never by editing serialized output.
 */
export const BOARD_TOKEN_DEFAULTS = {
  font: PALETTE.fontSans,
  "font-mono": PALETTE.fontMono,
  "text-head": "9px",
  "text-model": "10.5px",
  "text-cell": "10px",
  "text-note": "8.5px",
  "text-hour": "9px",
  surface: PALETTE.surface,
  lane: PALETTE.panel,
  rule: PALETTE.rule,
  ink: PALETTE.ink,
  "ink-soft": PALETTE.inkSoft,
  "ink-mute": PALETTE.inkMute,
  window: PALETTE.usable,
  limit: "#b3402e",
  cap: PALETTE.cap,
  rain: PALETTE.rain,
} as const;

/** `var(--meteo-board-<name>, <default>)` with the fallback read from BOARD_TOKEN_DEFAULTS. */
function v(name: keyof typeof BOARD_TOKEN_DEFAULTS): string {
  return `var(--meteo-board-${name}, ${BOARD_TOKEN_DEFAULTS[name]})`;
}

export const DEFAULT_BOARD_STYLESHEET = `
.meteo-board text { font-family: ${v("font")}; }
.meteo-board .meteo-board-mono { font-family: ${v("font-mono")}; }
.meteo-board-frame { fill: ${v("surface")}; stroke: ${v("rule")}; }
.meteo-board-lane { fill: ${v("lane")}; stroke: ${v("rule")}; }
.meteo-board-tick { stroke: ${v("rule")}; stroke-width: 0.6; }
.meteo-board-head { fill: ${v("ink-mute")}; font-size: ${v("text-head")}; font-weight: 700; letter-spacing: 0.06em; }
.meteo-board-hour { fill: ${v("ink-mute")}; font-size: ${v("text-hour")}; }
.meteo-board-model { fill: ${v("ink")}; font-size: ${v("text-model")}; font-weight: 700; }
.meteo-board-kind { fill: ${v("ink-mute")}; font-size: ${v("text-note")}; letter-spacing: 0.08em; }
.meteo-board-note { fill: ${v("ink-mute")}; font-size: ${v("text-note")}; font-style: italic; }
.meteo-board-cell { fill: ${v("ink-soft")}; font-size: ${v("text-cell")}; }
.meteo-board-cell-blank { fill: ${v("ink-mute")}; font-size: ${v("text-cell")}; }
.meteo-board-cell-over { fill: ${v("limit")}; font-size: ${v("text-cell")}; font-weight: 700; }
.meteo-board-window { fill: ${v("window")}; }
.meteo-board-window-clip { stroke: ${v("window")}; fill: none; stroke-width: 1.2; }
.meteo-board-limit { fill: ${v("limit")}; }
.meteo-board-limit-hatch-line { stroke: ${v("limit")}; }
.meteo-board-cap { fill: ${v("cap")}; }
.meteo-board-cap-span { fill: ${v("cap")}; opacity: 0.3; }
.meteo-board-rain { fill: ${v("rain")}; stroke: ${v("rain")}; }
`.trim();
