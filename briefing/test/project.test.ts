import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSiteForecast, type SiteForecast } from "../src/contract.js";
import { projectForecast } from "../src/derive/project.js";

const fixtures = JSON.parse(
  readFileSync(join(__dirname, "analyze-fixtures.json"), "utf-8"),
) as Record<string, unknown>;

function hrrr(): SiteForecast {
  const profile = parseSiteForecast(fixtures["hrrrConusErie"]);
  expect(profile).not.toBeNull();
  return profile!;
}

describe("projectForecast", () => {
  it("returns a structural copy with no options — and it still passes the contract", () => {
    const projected = projectForecast(hrrr());
    expect(projected).toEqual(hrrr());
    expect(parseSiteForecast(projected)).not.toBeNull();
  });

  it("windows to one local day in the document's own timezone", () => {
    const projected = projectForecast(hrrr(), { day: "2026-08-08" });
    expect(projected.hours).toHaveLength(12);
    expect(projected.hours[0].validAt).toBe("2026-08-08T19:00:00Z");
    expect(projected.hours[11].validAt).toBe("2026-08-09T06:00:00Z");
    expect(projected.model).toBe("hrrr-conus");
    expect(projected.site.timeZone).toBe("America/Vancouver");
  });

  it("windows in a caller-supplied timezone override", () => {
    const utc = projectForecast(hrrr(), { day: "2026-08-08", timeZone: "UTC" });
    expect(utc.hours).toHaveLength(5);
  });

  it("throws rather than guessing a timezone for day windowing", () => {
    const undeclared = hrrr();
    delete (undeclared.site as { timeZone?: string }).timeZone;
    expect(() => projectForecast(undeclared, { day: "2026-08-08" })).toThrow(/timeZone/);
    expect(() => projectForecast(undeclared)).not.toThrow();
  });

  it("strips levels — the single biggest subtraction — leaving a contract-valid document", () => {
    const projected = projectForecast(hrrr(), { dropLevels: true });
    expect(projected.hours.every((hour) => hour.levels.length === 0)).toBe(true);
    expect(parseSiteForecast(projected)).not.toBeNull();
    const before = JSON.stringify(hrrr()).length;
    const after = JSON.stringify(projected).length;
    expect(after).toBeLessThan(before / 2);
  });

  it("selects field subsets per block, keeping validAt and only the asked-for values", () => {
    const projected = projectForecast(hrrr(), {
      day: "2026-08-08",
      dropLevels: true,
      fields: {
        surface: ["windSpeedMps", "windGustMps", "precipitationMmHr"],
        derived: ["usableLiftTopM", "thermalVelocityMps"],
      },
    });
    const hour = projected.hours[0];
    expect(Object.keys(hour.surface).sort()).toEqual([
      "precipitationMmHr",
      "windGustMps",
      "windSpeedMps",
    ]);
    expect(Object.keys(hour.derived).sort()).toEqual(["thermalVelocityMps", "usableLiftTopM"]);
    expect(hour.surface.windSpeedMps).toBe(hrrr().hours[0].surface.windSpeedMps);
    expect(hour.derived.usableLiftTopM).toBe(hrrr().hours[0].derived.usableLiftTopM);
  });

  it("skips selected fields an hour does not carry instead of inventing them", () => {
    const geps = parseSiteForecast(fixtures["gepsFlagpole"]);
    expect(geps).not.toBeNull();
    const projected = projectForecast(geps!, {
      fields: { surface: ["capeJkg", "cinJkg"] },
    });
    const withCape = projected.hours.filter((hour) => "capeJkg" in hour.surface);
    expect(withCape).toHaveLength(14);
    expect(projected.hours).toHaveLength(16);
  });

  it("does not mutate its input", () => {
    const original = hrrr();
    const snapshot = JSON.parse(JSON.stringify(original));
    projectForecast(original, { day: "2026-08-08", dropLevels: true, fields: { surface: [] } });
    expect(original).toEqual(snapshot);
  });
});
