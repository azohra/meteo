const hourFormatters = new Map<string, Intl.DateTimeFormat>();
const dateKeyFormatters = new Map<string, Intl.DateTimeFormat>();
const wallClockFormatters = new Map<string, Intl.DateTimeFormat>();

/** The pilots' day: first local hour kept/drawn, inclusive. */
export const DEFAULT_DAY_START_HOUR = 7;
/** The pilots' day: last local hour kept/drawn, inclusive. */
export const DEFAULT_DAY_END_HOUR = 21;

/** The instant's wall clock in `timeZone`, re-read as a UTC millisecond value — the fixed point `localInstantMs` iterates toward. */
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
 * The UTC instant (ms) whose wall clock in `timeZone` reads `dateKey`'s
 * local `hour` (fractional hours welcome) — resolved by iterating Intl's
 * own formatter (never offset arithmetic), so any zone's rules apply as
 * the runtime knows them. A local time a DST spring-forward skips
 * resolves to the instant the clock actually shows next; the iterations
 * converge for every real transition.
 */
export function localInstantMs(dateKey: string, hour: number, timeZone: string): number {
  const target = Date.parse(`${dateKey}T00:00:00Z`) + hour * 3_600_000;
  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const drift = target - wallClockAsUtcMs(guess, timeZone);
    if (drift === 0) return guess;
    guess += drift;
  }
  return guess;
}

/** Local hour of day (0-23) of a UTC instant in the given timezone. */
export function localHourOfDay(validAt: string, timeZone: string): number {
  let formatter = hourFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { hour: "2-digit", hourCycle: "h23", timeZone });
    hourFormatters.set(timeZone, formatter);
  }
  return Number(formatter.format(new Date(validAt)));
}

/** Zero-padded local date key (YYYY-MM-DD) — string order is date order. */
export function localDateKey(validAt: string, timeZone: string): string {
  let formatter = dateKeyFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone,
    });
    dateKeyFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(new Date(validAt));
  const part = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${part["year"]}-${part["month"]}-${part["day"]}`;
}

/**
 * Groups hours by local calendar day in the given timezone; groups appear
 * in first-encounter order and each group's hours keep their input order.
 */
export function groupByLocalDay<T extends { validAt: string }>(
  hours: readonly T[],
  timeZone: string,
): Array<{ dateKey: string; hours: T[] }> {
  const groups: Array<{ dateKey: string; hours: T[] }> = [];
  const byKey = new Map<string, T[]>();
  for (const hour of hours) {
    const dateKey = localDateKey(hour.validAt, timeZone);
    let bucket = byKey.get(dateKey);
    if (!bucket) {
      bucket = [];
      byKey.set(dateKey, bucket);
      groups.push({ dateKey, hours: bucket });
    }
    bucket.push(hour);
  }
  return groups;
}
