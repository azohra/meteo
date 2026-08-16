/* The compare-board tier's one published surface: one local day across a
   comparison's members as marks on one shared clock. Scene-first — the
   exported shapes are the product; the SVG serializer is the reference
   rendering for goldens and documentation. */
export {
  compareBoardDayAxis,
  DEFAULT_DAY_END_HOUR,
  DEFAULT_DAY_START_HOUR,
  DEFAULT_TICK_HOURS,
  xForBoardTime,
} from "./axis.js";
export { buildCompareBoardScene } from "./scene.js";
export { renderCompareBoardSvg, type RenderCompareBoardSvgOptions } from "./svg.js";
export { BOARD_TOKEN_DEFAULTS, DEFAULT_BOARD_STYLESHEET } from "./theme.js";
export type {
  BoardInstant,
  BoardSpan,
  BoardTick,
  BoardWindSample,
  CompareBoardAloft,
  CompareBoardAxis,
  CompareBoardExceedance,
  CompareBoardGust,
  CompareBoardLaunch,
  CompareBoardOptions,
  CompareBoardRow,
  CompareBoardScene,
  CompareBoardStorms,
  CompareBoardTop,
  CompareBoardVote,
  CompareBoardWindow,
} from "./types.js";
