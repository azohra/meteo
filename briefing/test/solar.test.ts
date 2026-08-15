import { describe, expect, it } from "vitest";
import { solarEventsForDate } from "../src/derive/solar.js";

const ONE_MINUTE_MS = 60_000;

describe("solarEventsForDate", () => {
  it("matches NOAA's published sunrise and sunset table within one minute", () => {
    const events = solarEventsForDate("2026-07-28", 40.72, -74.02);

    expect(events).not.toBeNull();
    expect(
      Math.abs((events?.sunrise.getTime() ?? 0) - Date.parse("2026-07-28T09:49:00Z")),
    ).toBeLessThanOrEqual(ONE_MINUTE_MS);
    expect(
      Math.abs((events?.sunset.getTime() ?? 0) - Date.parse("2026-07-29T00:16:00Z")),
    ).toBeLessThanOrEqual(ONE_MINUTE_MS);
  });

  it("resolves far-eastern longitudes to the right instants, sunrise on the prior UTC day", () => {
    // Gisborne, New Zealand (38.66° S, 178.02° E) in southern summer.
    // USNO Astronomical Applications values to the minute (UTC): sunrise
    // 2026-01-14T17:00Z — before the keyed date's UTC midnight — and
    // sunset 2026-01-15T07:34Z.
    const events = solarEventsForDate("2026-01-15", -38.66, 178.02);

    expect(events).not.toBeNull();
    expect(
      Math.abs((events?.sunrise.getTime() ?? 0) - Date.parse("2026-01-14T17:00:00Z")),
    ).toBeLessThanOrEqual(ONE_MINUTE_MS);
    expect(
      Math.abs((events?.sunset.getTime() ?? 0) - Date.parse("2026-01-15T07:34:00Z")),
    ).toBeLessThanOrEqual(ONE_MINUTE_MS);
  });

  it("rejects malformed and impossible date keys", () => {
    expect(solarEventsForDate("2026-02-30", 49.1, -117.7)).toBeNull();
    expect(solarEventsForDate("2026-7-28", 49.1, -117.7)).toBeNull();
    expect(solarEventsForDate("2026-07-28T00:00:00Z", 49.1, -117.7)).toBeNull();
    expect(solarEventsForDate("not-a-date", 49.1, -117.7)).toBeNull();
  });

  it("rejects out-of-range coordinates", () => {
    expect(solarEventsForDate("2026-07-28", 91, -117.7)).toBeNull();
    expect(solarEventsForDate("2026-07-28", -91, -117.7)).toBeNull();
    expect(solarEventsForDate("2026-07-28", 49.1, 181)).toBeNull();
    expect(solarEventsForDate("2026-07-28", 49.1, -181)).toBeNull();
    expect(solarEventsForDate("2026-07-28", Number.NaN, -117.7)).toBeNull();
    expect(solarEventsForDate("2026-07-28", 49.1, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("returns null for polar day and polar night, where the sun never crosses the horizon", () => {
    expect(solarEventsForDate("2026-06-21", 90, 0)).toBeNull();
    expect(solarEventsForDate("2026-06-21", 80, 15)).toBeNull();
    expect(solarEventsForDate("2026-12-21", 80, 15)).toBeNull();
  });
});
