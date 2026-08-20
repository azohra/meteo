import {
  DEFAULT_DAY_END_HOUR,
  DEFAULT_DAY_START_HOUR,
  localDateKey,
  localHourOfDay,
} from "../derive/index.js";

export interface DayWindowOptions {
  /** IANA timezone the day is judged in (e.g. "America/Vancouver"). */
  timeZone: string;
  /** First local hour kept, inclusive. Default 7. */
  dayStartHour?: number;
  /** Last local hour kept, inclusive. Default 21. */
  dayEndHour?: number;
  /** Days with fewer in-window hours than this are dropped. Default 5. */
  minHoursPerDay?: number;
}

const DEFAULT_MIN_HOURS_PER_DAY = 5;

/**
 * Keeps the hours inside the pilots' day — local hour within
 * [dayStartHour, dayEndHour], dropping days with fewer than minHoursPerDay
 * in-window hours — unless that would empty the set, in which case the
 * source hours are returned unchanged.
 */
export function meteogramDisplayHours<T extends { validAt: string }>(
  hours: readonly T[],
  options: DayWindowOptions,
): T[] {
  const dayStartHour = options.dayStartHour ?? DEFAULT_DAY_START_HOUR;
  const dayEndHour = options.dayEndHour ?? DEFAULT_DAY_END_HOUR;
  const minHoursPerDay = options.minHoursPerDay ?? DEFAULT_MIN_HOURS_PER_DAY;

  const byDate = new Map<string, T[]>();
  for (const hour of hours) {
    const hourOfDay = localHourOfDay(hour.validAt, options.timeZone);
    if (hourOfDay < dayStartHour || hourOfDay > dayEndHour) continue;
    const dateKey = localDateKey(hour.validAt, options.timeZone);
    const dateHours = byDate.get(dateKey) ?? [];
    dateHours.push(hour);
    byDate.set(dateKey, dateHours);
  }

  const completeDays = [...byDate.values()].filter(
    (dateHours) => dateHours.length >= minHoursPerDay,
  );
  return completeDays.length > 0 ? completeDays.flat() : [...hours];
}
