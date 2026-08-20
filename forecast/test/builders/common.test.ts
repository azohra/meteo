import { describe, expect, it } from "vitest";
import { dewPointDepression } from "../../src/moisture.js";
import { compactJson } from "../../src/publish.js";
import {
  KELVIN,
  emptyHour,
  manifestInstant,
  isCompleteLevel,
  memberRequiredValue,
  parseCycleStamp,
  profileInstant,
  requiredValue,
  runConcurrent,
  runReferenceTime,
  validTime,
  withDewPointDepression,
} from "../../src/builders/common.js";

it("KELVIN is the 0 °C offset", () => {
  expect(KELVIN).toBe(273.15);
});

describe("emptyHour", () => {
  it("seeds every universal scalar with NaN and keeps the slot's validAt", () => {
    const hour = emptyHour("2026-08-07T15:00:00Z");

    expect(hour.validAt).toBe("2026-08-07T15:00:00Z");
    expect(hour.levels).toEqual({});
    for (const field of [
      "cloudCoverPercent",
      "dewPointDepressionC",
      "latentHeatFluxWm2",
      "precipitationMm",
      "seaLevelPressureHpa",
      "sensibleHeatFluxWm2",
      "temperatureC",
      "windDirectionDeg",
      "windSpeedMps",
    ]) {
      expect(Number.isNaN(hour[field]), field).toBe(true);
    }
  });

  it("cannot be published untouched — the NaN seeds trip the serializer guard", () => {
    // The guard chain the NaN seeds exist for: a task that never ran
    // leaves NaN behind, and publish refuses to serialize it.
    expect(() => compactJson(emptyHour("2026-08-07T15:00:00Z"))).toThrow(/non-finite/);
  });
});

describe("isCompleteLevel", () => {
  const complete = {
    pressureHpa: 850,
    heightM: 1500,
    temperatureC: 5,
    dewPointDepressionC: 2,
    windDirectionDeg: 270,
    windSpeedMps: 10,
  };

  it("accepts a level carrying every required field", () => {
    expect(isCompleteLevel(complete)).toBe(true);
  });

  it("optional extras never gate completeness", () => {
    expect(isCompleteLevel({ ...complete, verticalVelocityPaS: -0.4 })).toBe(true);
  });

  it("rejects a level missing any required field", () => {
    const { windSpeedMps: _dropped, ...incomplete } = complete;
    expect(isCompleteLevel(incomplete)).toBe(false);
  });
});

describe("requiredValue", () => {
  const site = { name: "Boulder" };

  it("passes a finite value through", () => {
    expect(requiredValue("NOAA", 42.5, "temperatureC", site)).toBe(42.5);
  });

  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY])("dies loudly on %s", (value) => {
    expect(() => requiredValue("NOAA", value as number | null, "temperatureC", site)).toThrow(
      "NOAA returned no temperatureC for Boulder",
    );
  });

  it("memberRequiredValue names the member instead of the provider", () => {
    expect(() => memberRequiredValue(null, "heightM", site, 7)).toThrow(
      "No heightM for Boulder (member 7)",
    );
    expect(memberRequiredValue(3.5, "heightM", site, 7)).toBe(3.5);
  });
});

describe("withDewPointDepression", () => {
  it("trades relativeHumidityPercent for the inverse-Magnus depression", () => {
    const level = withDewPointDepression({
      pressureHpa: 850,
      temperatureC: 20.0,
      relativeHumidityPercent: 50.0,
    });

    expect(level["dewPointDepressionC"]).toBe(dewPointDepression(20.0, 50.0));
    expect(level).not.toHaveProperty("relativeHumidityPercent");
    expect(level["pressureHpa"]).toBe(850);
    expect(level["temperatureC"]).toBe(20.0);
  });
});

describe("cycle stamps", () => {
  it("runReferenceTime spells a provider cycle as an ISO instant", () => {
    expect(runReferenceTime({ date: "20260807", hour: "06" })).toBe("2026-08-07T06:00:00Z");
  });

  it("parseCycleStamp resolves a pinned cycle and refuses the rest", () => {
    expect(parseCycleStamp("2026-08-07T12:00:00Z", ["12", "00"], "GEPS")).toEqual({
      date: "20260807",
      hour: "12",
    });
    expect(() => parseCycleStamp("20260807T12Z", ["12", "00"], "GEPS")).toThrow(
      /not a GEPS cycle stamp/,
    );
    expect(() => parseCycleStamp("2026-08-07T06:00:00Z", ["12", "00"], "GEPS")).toThrow(
      /not a GEPS cycle \(12\/00\)/,
    );
  });
});

describe("timestamp grammars", () => {
  it("validTime adds forecast hours to the reference time, whole seconds", () => {
    expect(validTime("2026-08-07T12:00:00Z", 3)).toBe("2026-08-07T15:00:00Z");
    expect(validTime("2026-08-07T18:00:00Z", 9)).toBe("2026-08-08T03:00:00Z"); // crosses midnight
    expect(validTime("2026-12-31T18:00:00Z", 384)).toBe("2027-01-16T18:00:00Z"); // crosses the year
  });

  it("instant publishes milliseconds; profileInstant whole seconds", () => {
    expect(manifestInstant()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(profileInstant()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

describe("runConcurrent", () => {
  it("runs every task, never more than maxWorkers at once", async () => {
    let active = 0;
    let peak = 0;
    let completed = 0;
    const task = () => async (): Promise<void> => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      completed += 1;
    };

    await runConcurrent(Array.from({ length: 12 }, task), 3);

    expect(completed).toBe(12);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1); // it actually ran concurrently
  });

  it("the first failure stops new tasks and rethrows", async () => {
    let started = 0;
    const succeeding = () => async (): Promise<void> => {
      started += 1;
      await new Promise((resolve) => setTimeout(resolve, 1));
    };
    const failing = async (): Promise<void> => {
      started += 1;
      throw new Error("NOAA returned no temperatureC for Boulder");
    };
    const tasks = [failing, ...Array.from({ length: 20 }, succeeding)];

    await expect(runConcurrent(tasks, 2)).rejects.toThrow("NOAA returned no temperatureC");
    // The failure lands before the queue drains: the pool stops pulling.
    expect(started).toBeLessThan(tasks.length);
  });

  it("tolerates an empty task list", async () => {
    await expect(runConcurrent([], 10)).resolves.toBeUndefined();
  });
});
