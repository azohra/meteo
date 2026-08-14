import { describe, expect, it } from "vitest";
import { z } from "zod";
import { httpUrl, ianaTimeZone, positionFields } from "../src/schema.js";

describe("ianaTimeZone", () => {
  it("accepts a real IANA zone and rejects a fictional one", () => {
    expect(ianaTimeZone.safeParse("America/Vancouver").success).toBe(true);
    expect(ianaTimeZone.safeParse("Mars/Olympus_Mons").success).toBe(false);
  });
});

describe("httpUrl", () => {
  it("accepts http and https, nothing else", () => {
    expect(httpUrl.safeParse("https://meteo.azohra.com/schema/x.json").success).toBe(true);
    expect(httpUrl.safeParse("http://127.0.0.1:8080/feed").success).toBe(true);
    expect(httpUrl.safeParse("ftp://example.com/file").success).toBe(false);
    expect(httpUrl.safeParse("not a url").success).toBe(false);
  });
});

describe("positionFields", () => {
  const position = z.object(positionFields);

  it("accepts an absent claim — every field is nullish", () => {
    expect(position.safeParse({}).success).toBe(true);
    expect(position.safeParse({ elevationM: null, latitude: null, longitude: null }).success).toBe(
      true,
    );
  });

  it("holds latitude to [-90, 90] and longitude to [-180, 180)", () => {
    expect(position.safeParse({ latitude: 49.2827, longitude: -123.1207 }).success).toBe(true);
    expect(position.safeParse({ longitude: -180 }).success).toBe(true);
    expect(position.safeParse({ latitude: 90.001 }).success).toBe(false);
    // The antimeridian is written -180, never +180.
    expect(position.safeParse({ longitude: 180 }).success).toBe(false);
  });

  it("refuses a non-finite elevation", () => {
    expect(position.safeParse({ elevationM: Number.POSITIVE_INFINITY }).success).toBe(false);
  });
});
