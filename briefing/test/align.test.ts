import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSiteForecast, type SiteForecast } from "../src/contract.js";
import { p50 } from "../src/derive/ensemble.js";
import { alignByValidAt } from "../src/derive/align.js";

const fixtures = JSON.parse(
  readFileSync(join(__dirname, "analyze-fixtures.json"), "utf-8"),
) as Record<string, unknown>;

function load(key: string): SiteForecast {
  const profile = parseSiteForecast(fixtures[key]);
  expect(profile).not.toBeNull();
  return profile!;
}

describe("alignByValidAt", () => {
  it("intersects real documents on their shared instants, chronological", () => {
    const hrrr = load("hrrrConusErie");
    const reps = load("repsErie");
    const aligned = alignByValidAt([hrrr, reps]);
    expect(aligned.map((row) => row.validAt)).toEqual(reps.hours.map((hour) => hour.validAt));
    expect(aligned).toHaveLength(8);
    const first = aligned[0];
    expect(Object.keys(first.byModel).sort()).toEqual(["hrrr-conus", "reps"]);
    expect(first.byModel["hrrr-conus"]).toBe(hrrr.hours[2]);
    expect(first.byModel["reps"]).toBe(reps.hours[0]);
    expect(typeof p50(first.byModel["reps"].surface.temperatureC)).toBe("number");
  });

  it("returns every instant for a single profile and nothing for none", () => {
    const reps = load("repsErie");
    expect(alignByValidAt([reps])).toHaveLength(8);
    expect(alignByValidAt([])).toEqual([]);
  });

  it("yields no rows when the documents never overlap", () => {
    const hrrr = load("hrrrConusErie");
    const shifted: SiteForecast = {
      ...hrrr,
      model: "hrrr-shifted",
      hours: hrrr.hours.map((hour) => ({
        ...hour,
        validAt: hour.validAt.replace("2026-08", "2026-09"),
      })),
    };
    expect(alignByValidAt([hrrr, shifted])).toEqual([]);
  });

  it("throws on a duplicate model slug instead of silently shadowing", () => {
    const reps = load("repsErie");
    expect(() => alignByValidAt([reps, reps])).toThrow(/reps/);
  });
});
