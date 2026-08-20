import {
  DEFAULT_DAY_END_HOUR,
  DEFAULT_DAY_START_HOUR,
  localInstantMs,
} from "../derive/day-window.js";
import type { BoardTick, CompareBoardAxis, CompareBoardOptions } from "./types.js";

export const DEFAULT_TICK_HOURS: ReadonlyArray<number> = [8, 12, 16, 20];

/**
 * The board's shared clock: `dateKey`'s local day span resolved to UTC
 * instants through Intl. Every lane positions against this one axis —
 * which is what makes a column of models scannable by position.
 */
export function compareBoardDayAxis(options: CompareBoardOptions): CompareBoardAxis {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.dateKey)) {
    throw new Error(
      `compareBoardDayAxis: dateKey (${options.dateKey}) must be localDateKey-shaped (YYYY-MM-DD)`,
    );
  }
  const dayStartHour = options.dayStartHour ?? DEFAULT_DAY_START_HOUR;
  const dayEndHour = options.dayEndHour ?? DEFAULT_DAY_END_HOUR;
  if (
    !Number.isInteger(dayStartHour) ||
    !Number.isInteger(dayEndHour) ||
    dayStartHour < 0 ||
    dayEndHour > 23 ||
    dayStartHour >= dayEndHour
  ) {
    throw new Error(
      `compareBoardDayAxis: day hours (${dayStartHour}–${dayEndHour}) must be integers with 0 <= start < end <= 23`,
    );
  }
  const startMs = localInstantMs(options.dateKey, dayStartHour, options.timeZone);
  const endMs = localInstantMs(options.dateKey, dayEndHour, options.timeZone);
  const axis = { startMs, endMs, dayStartHour, dayEndHour };
  const ticks: BoardTick[] = (options.tickHours ?? DEFAULT_TICK_HOURS)
    .filter((hour) => hour >= dayStartHour && hour <= dayEndHour)
    .map((hour) => {
      const atMs = localInstantMs(options.dateKey, hour, options.timeZone);
      return { hour, atMs, x: xForBoardTime(axis, atMs) };
    });
  return { ...axis, ticks };
}

/**
 * The one time→x mapping: an instant's fraction 0..1 of the axis's day
 * span, clamped at the edges. Renderer-agnostic — multiply by a lane
 * width, a percentage, whatever the surface draws in.
 */
export function xForBoardTime(
  axis: Pick<CompareBoardAxis, "startMs" | "endMs">,
  atMs: number,
): number {
  const fraction = (atMs - axis.startMs) / (axis.endMs - axis.startMs);
  return Math.max(0, Math.min(1, fraction));
}
