const hourFormatters = new Map<string, Intl.DateTimeFormat>();
const dateKeyFormatters = new Map<string, Intl.DateTimeFormat>();

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
