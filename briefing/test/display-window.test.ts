import { describe, expect, it } from "vitest";
import { localDateKey, localHourOfDay } from "../src/derive/index.js";
import { meteogramDisplayHours } from "../src/scene/display-window.js";

function hoursBetween(startIso: string, count: number): Array<{ validAt: string }> {
  const startMs = Date.parse(startIso);
  return Array.from({ length: count }, (_, index) => ({
    validAt: new Date(startMs + index * 3_600_000).toISOString().replace(".000Z", "Z"),
  }));
}

describe("meteogramDisplayHours", () => {
  it("keeps 07:00-21:00 local inclusive and drops the rest", () => {
    const hours = hoursBetween("2026-08-09T13:00:00Z", 17);
    const kept = meteogramDisplayHours(hours, { timeZone: "America/Vancouver" });
    expect(kept).toHaveLength(15);
    expect(kept[0].validAt).toBe("2026-08-09T14:00:00Z");
    expect(kept.at(-1)?.validAt).toBe("2026-08-10T04:00:00Z");
  });

  it("windows against the parameterized timezone, not a hardcoded one", () => {
    const hours = hoursBetween("2026-08-08T20:00:00Z", 17);
    const kept = meteogramDisplayHours(hours, { timeZone: "Australia/Sydney" });
    expect(kept).toHaveLength(15);
    expect(kept[0].validAt).toBe("2026-08-08T21:00:00Z");
  });

  it("drops days with fewer than five in-window hours", () => {
    const fullDay = hoursBetween("2026-08-09T14:00:00Z", 15);
    const shortDay = hoursBetween("2026-08-10T14:00:00Z", 4);
    const kept = meteogramDisplayHours([...fullDay, ...shortDay], {
      timeZone: "America/Vancouver",
    });
    expect(kept).toHaveLength(15);
    expect(
      kept.every((hour) => localDateKey(hour.validAt, "America/Vancouver") === "2026-08-09"),
    ).toBe(true);
  });

  it("honours custom day bounds and minimum", () => {
    const hours = hoursBetween("2026-08-09T13:00:00Z", 17);
    const kept = meteogramDisplayHours(hours, {
      timeZone: "America/Vancouver",
      dayStartHour: 10,
      dayEndHour: 12,
      minHoursPerDay: 3,
    });
    expect(kept.map((hour) => localHourOfDay(hour.validAt, "America/Vancouver"))).toEqual([
      10, 11, 12,
    ]);
  });

  it("returns the source hours when no day survives the window", () => {
    const nightHours = hoursBetween("2026-08-09T09:00:00Z", 3);
    const kept = meteogramDisplayHours(nightHours, { timeZone: "America/Vancouver" });
    expect(kept).toEqual(nightHours);
  });

  it("returns an empty set for empty input", () => {
    expect(meteogramDisplayHours([], { timeZone: "America/Vancouver" })).toEqual([]);
  });
});
