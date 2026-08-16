import type { BoardTick, CompareBoardAxis, CompareBoardOptions } from "./types.js";

export const DEFAULT_DAY_START_HOUR = 7;
export const DEFAULT_DAY_END_HOUR = 21;
export const DEFAULT_TICK_HOURS: ReadonlyArray<number> = [8, 12, 16, 20];

const wallClockFormatters = new Map<string, Intl.DateTimeFormat>();

/** The instant's wall clock in `timeZone`, re-read as a UTC millisecond value — the fixed point `localInstant` iterates toward. */
function wallClockAsUtcMs(atMs: number, timeZone: string): number {
  let formatter = wallClockFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZone,
    });
    wallClockFormatters.set(timeZone, formatter);
  }
  const part = Object.fromEntries(
    formatter.formatToParts(new Date(atMs)).map(({ type, value }) => [type, value]),
  );
  return Date.parse(
    `${part["year"]}-${part["month"]}-${part["day"]}T${part["hour"]}:${part["minute"]}:${part["second"]}Z`,
  );
}

/**
 * The UTC instant whose wall clock in `timeZone` reads `dateKey`T`hour`:00
 * — resolved by iterating Intl's own formatter (never offset arithmetic),
 * so any zone's rules apply as the runtime knows them. A local time a DST
 * spring-forward skips resolves to the instant the clock actually shows
 * next; both iterations converge for every real transition.
 */
function localInstant(dateKey: string, hour: number, timeZone: string): number {
  const target = Date.parse(`${dateKey}T${String(hour).padStart(2, "0")}:00:00Z`);
  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const drift = target - wallClockAsUtcMs(guess, timeZone);
    if (drift === 0) return guess;
    guess += drift;
  }
  return guess;
}

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
  const startMs = localInstant(options.dateKey, dayStartHour, options.timeZone);
  const endMs = localInstant(options.dateKey, dayEndHour, options.timeZone);
  const axis = { startMs, endMs, dayStartHour, dayEndHour };
  const ticks: BoardTick[] = (options.tickHours ?? DEFAULT_TICK_HOURS)
    .filter((hour) => hour >= dayStartHour && hour <= dayEndHour)
    .map((hour) => {
      const atMs = localInstant(options.dateKey, hour, options.timeZone);
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
