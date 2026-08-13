import { describe, expect, it } from "vitest";
import { foldCurrent, mergeCurrent } from "../src/index.js";
import {
  BASE_MS,
  conditionsFixture,
  downStation,
  feedFixture,
  iso,
  okStation,
} from "./fixtures.js";

describe("mergeCurrent", () => {
  it("replaces the matching station's reading, keeps its history, reports merged", () => {
    const feed = feedFixture();
    const newReading = {
      ...okStation().reading,
      observedAt: iso(BASE_MS + 60_000),
      windAvgMps: 33.3,
    };
    const result = mergeCurrent(feed, {
      schemaVersion: 2,
      servedAt: iso(BASE_MS + 61_000),
      station: { ...okStation(), reading: newReading, history: null },
    });
    expect(result.merged).toBe(true);
    const station = result.feed.stations[0];
    expect(station?.status).toBe("ok");
    expect(station?.reading?.windAvgMps).toBe(33.3);
    expect(station?.history?.points.length).toBe(12);
    expect(result.feed.servedAt).toBe(iso(BASE_MS + 61_000));
    expect(result.feed.stations[1]).toBe(feed.stations[1]);
  });

  it("preserves prior temperature, wind chill, and conditions over structural nulls", () => {
    const prior = okStation({
      reading: {
        ...okStation().reading,
        temperatureC: 14.2,
        windChillC: 10.1,
        conditions: conditionsFixture(),
      },
    });
    const feed = feedFixture([prior, downStation()]);
    const light = {
      ...okStation().reading,
      observedAt: iso(BASE_MS + 60_000),
      windAvgMps: 27.5,
      windDirectionDeg: 200,
      windGustMps: 31,
      windLullMps: 22,
      temperatureC: null,
      windChillC: null,
      conditions: null,
    };
    const result = mergeCurrent(feed, {
      schemaVersion: 2,
      servedAt: iso(BASE_MS + 61_000),
      station: { ...okStation(), reading: light, history: null },
    });
    expect(result.merged).toBe(true);
    const reading = result.feed.stations[0]?.reading;
    expect(reading?.windAvgMps).toBe(27.5);
    expect(reading?.windDirectionDeg).toBe(200);
    expect(reading?.observedAt).toBe(iso(BASE_MS + 60_000));
    expect(reading?.temperatureC).toBe(14.2);
    expect(reading?.windChillC).toBe(10.1);
    expect(reading?.conditions?.relativeHumidityPercent).toBe(64);
    expect(reading?.conditions?.uvIndex).toBe(6.1);
  });

  it("lets a non-null current value win over the preserved prior", () => {
    const feed = feedFixture();
    const result = mergeCurrent(feed, {
      schemaVersion: 2,
      servedAt: iso(BASE_MS + 61_000),
      station: {
        ...okStation(),
        reading: { ...okStation().reading, temperatureC: -3.5 },
        history: null,
      },
    });
    expect(result.merged).toBe(true);
    expect(result.feed.stations[0]?.reading?.temperatureC).toBe(-3.5);
  });

  it("reports merged:false and keeps the feed when the current response is unavailable", () => {
    const feed = feedFixture();
    const result = mergeCurrent(feed, {
      schemaVersion: 2,
      servedAt: iso(BASE_MS + 61_000),
      station: { ...downStation(), id: "test-station" },
    });
    expect(result.merged).toBe(false);
    expect(result.feed).toBe(feed);
  });

  it("reports merged:false when the current names a station absent from the feed", () => {
    const feed = feedFixture();
    const result = mergeCurrent(feed, {
      schemaVersion: 2,
      servedAt: iso(BASE_MS + 61_000),
      station: { ...okStation(), id: "not-in-feed" },
    });
    expect(result.merged).toBe(false);
    expect(result.feed).toBe(feed);
  });
});

describe("foldCurrent", () => {
  it("takes the current's clock only when the merge advanced", () => {
    const feed = feedFixture();
    const current = {
      schemaVersion: 2 as const,
      servedAt: iso(BASE_MS + 61_000),
      station: { ...okStation(), history: null },
    };
    const folded = foldCurrent(feed, BASE_MS + 1_000, current, BASE_MS + 61_500);
    expect(folded.receivedAtMs).toBe(BASE_MS + 61_500);
    expect(folded.feed?.servedAt).toBe(iso(BASE_MS + 61_000));
  });

  it("keeps the feed's own clock when the current did not merge", () => {
    const feed = feedFixture();
    const current = {
      schemaVersion: 2 as const,
      servedAt: iso(BASE_MS + 61_000),
      station: { ...downStation(), id: "test-station" },
    };
    const folded = foldCurrent(feed, BASE_MS + 1_000, current, BASE_MS + 61_500);
    expect(folded.receivedAtMs).toBe(BASE_MS + 1_000);
    expect(folded.feed).toBe(feed);
  });

  it("passes the feed through untouched when there is no current at all", () => {
    const feed = feedFixture();
    expect(foldCurrent(feed, BASE_MS + 1_000, null, null)).toEqual({
      feed,
      receivedAtMs: BASE_MS + 1_000,
    });
    expect(foldCurrent(null, null, null, null)).toEqual({ feed: null, receivedAtMs: null });
  });
});
