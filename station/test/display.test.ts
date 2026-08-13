import { describe, expect, it } from "vitest";
import {
  defaultFormatTime,
  defaultStrings,
  requireResolved,
  resolveDisplay,
  resolveStation,
} from "../src/index.js";
import type { SpeedThresholds } from "../src/index.js";
import { downStation, feedFixture, okStation } from "./fixtures.js";

const ambientThresholds: SpeedThresholds = { unit: "kmh", values: [12, 20, 28] };
const ownThresholds: SpeedThresholds = { unit: "knots", values: [10, 15] };

describe("resolveDisplay", () => {
  it("lets an explicit prop win over the ambient default over the package default", () => {
    const formatTime = () => "now";
    const resolved = resolveDisplay(
      { unit: "mph", formatTime: defaultFormatTime, thresholds: ambientThresholds },
      { unit: "knots", formatTime },
    );
    expect(resolved.unit).toBe("knots");
    expect(resolved.formatTime).toBe(formatTime);
    expect(resolved.thresholds).toBe(ambientThresholds);
  });

  it("falls back to the package defaults with no ambient layer at all", () => {
    const resolved = resolveDisplay(null, {});
    expect(resolved.unit).toBe("kmh");
    expect(resolved.formatTime).toBe(defaultFormatTime);
    expect(resolved.thresholds).toBeUndefined();
    expect(resolved.words).toBe(defaultStrings);
    expect(resolved.strings).toBeUndefined();
  });

  it("thresholds: undefined inherits, a value overrides, null opts out — a ?? fallback would erase the opt-out", () => {
    const defaults = { thresholds: ambientThresholds };
    expect(resolveDisplay(defaults, {}).thresholds).toBe(ambientThresholds);
    expect(resolveDisplay(defaults, { thresholds: ownThresholds }).thresholds).toBe(ownThresholds);
    expect(resolveDisplay(defaults, { thresholds: null }).thresholds).toBeUndefined();
  });

  it("merges string overrides with the inner layer winning per key", () => {
    const resolved = resolveDisplay(
      { strings: { calm: "Still", noHistory: "Nothing yet" } },
      { strings: { calm: "Flat" } },
    );
    expect(resolved.words.calm).toBe("Flat");
    expect(resolved.words.noHistory).toBe("Nothing yet");
    expect(resolved.words.notReporting).toBe(defaultStrings.notReporting);
  });
});

describe("resolveStation", () => {
  it("resolves in order: stationId, then primaryStationId, then first", () => {
    const feed = {
      ...feedFixture([okStation(), downStation()]),
      primaryStationId: "down-station",
    };
    expect(resolveStation(feed, "test-station")?.id).toBe("test-station");
    expect(resolveStation(feed, undefined)?.id).toBe("down-station");
    expect(resolveStation({ ...feed, primaryStationId: null }, undefined)?.id).toBe("test-station");
  });

  it("returns null for an unknown id, a missing primary, an absent feed", () => {
    const feed = feedFixture();
    expect(resolveStation(feed, "nope")).toBeNull();
    expect(resolveStation({ ...feed, primaryStationId: "ghost" }, undefined)?.id).toBe(
      "test-station",
    );
    expect(resolveStation(null, "test-station")).toBeNull();
    expect(resolveStation({ ...feed, stations: [] }, undefined)).toBeNull();
  });
});

describe("requireResolved", () => {
  it("passes a resolved value through and throws the wiring error with the binding's hint", () => {
    expect(requireResolved("Speed", "station", okStation(), "hint")).toEqual(okStation());
    expect(() =>
      requireResolved("Speed", "station", null, "render inside <StationFeedProvider> with a feed"),
    ).toThrow(
      "<Speed> resolved no station — pass the prop explicitly or render inside " +
        "<StationFeedProvider> with a feed.",
    );
  });
});
