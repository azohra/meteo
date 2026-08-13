import { describe, expect, it } from "vitest";
import { groupByLocalDay, localDateKey, localHourOfDay } from "../src/derive/day-window.js";

function hoursBetween(startIso: string, count: number): Array<{ validAt: string }> {
  const startMs = Date.parse(startIso);
  return Array.from({ length: count }, (_, index) => ({
    validAt: new Date(startMs + index * 3_600_000).toISOString().replace(".000Z", "Z"),
  }));
}

describe("localHourOfDay / localDateKey", () => {
  it("resolves local time in the requested zone (PDT, UTC-7 in August)", () => {
    expect(localHourOfDay("2026-08-09T14:00:00Z", "America/Vancouver")).toBe(7);
    expect(localDateKey("2026-08-09T05:00:00Z", "America/Vancouver")).toBe("2026-08-08");
  });

  it("resolves the same instant differently in another zone (AEST, UTC+10)", () => {
    expect(localHourOfDay("2026-08-09T14:00:00Z", "Australia/Sydney")).toBe(0);
    expect(localDateKey("2026-08-09T14:00:00Z", "Australia/Sydney")).toBe("2026-08-10");
  });

  it("zero-pads the date key so string order is date order", () => {
    expect(localDateKey("2026-01-02T20:00:00Z", "America/Vancouver")).toBe("2026-01-02");
  });
});

describe("groupByLocalDay", () => {
  it("splits chronological hours into chronological local days", () => {
    const hours = hoursBetween("2026-08-09T00:00:00Z", 36);
    const days = groupByLocalDay(hours, "America/Vancouver");
    expect(days.map((day) => day.dateKey)).toEqual(["2026-08-08", "2026-08-09", "2026-08-10"]);
    expect(days.map((day) => day.hours.length)).toEqual([7, 24, 5]);
    expect(days.flatMap((day) => day.hours)).toEqual(hours);
  });

  it("groups by the requested timezone, not a hardcoded one", () => {
    const hours = hoursBetween("2026-08-09T00:00:00Z", 36);
    const sydney = groupByLocalDay(hours, "Australia/Sydney");
    expect(sydney.map((day) => day.dateKey)).toEqual(["2026-08-09", "2026-08-10"]);
    expect(sydney.map((day) => day.hours.length)).toEqual([14, 22]);
  });

  it("preserves the source hour objects (grouping, not copying)", () => {
    const hours = hoursBetween("2026-08-09T14:00:00Z", 3);
    const [day] = groupByLocalDay(hours, "America/Vancouver");
    expect(day.hours[0]).toBe(hours[0]);
  });

  it("returns no groups for empty input", () => {
    expect(groupByLocalDay([], "America/Vancouver")).toEqual([]);
  });
});
