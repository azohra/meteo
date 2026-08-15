import { describe, expect, it } from "vitest";
import {
  normalizeWindnerdStationKey,
  parseStationConfig,
  windnerdStationUrl,
} from "../src/server/index.js";

describe("normalizeWindnerdStationKey", () => {
  it("accepts a bare kebab key", () => {
    expect(normalizeWindnerdStationKey("bluff-launch")).toBe("bluff-launch");
    expect(normalizeWindnerdStationKey("  mara ")).toBe("mara");
  });

  it("accepts a pasted station page URL", () => {
    expect(normalizeWindnerdStationKey("https://windnerd.net/en/bluff-launch")).toBe(
      "bluff-launch",
    );
  });

  it("rejects other hosts, protocols, and paths", () => {
    expect(normalizeWindnerdStationKey("https://evil.example/en/bluff-launch")).toBeNull();
    expect(normalizeWindnerdStationKey("http://windnerd.net/en/bluff-launch")).toBeNull();
    expect(normalizeWindnerdStationKey("https://windnerd.net/fr/bluff-launch")).toBeNull();
    expect(normalizeWindnerdStationKey("https://windnerd.net/en/a/b")).toBeNull();
    expect(normalizeWindnerdStationKey("Not A Key")).toBeNull();
    expect(normalizeWindnerdStationKey("")).toBeNull();
    expect(normalizeWindnerdStationKey(null)).toBeNull();
  });
});

describe("windnerdStationUrl", () => {
  it("builds the public station page", () => {
    expect(windnerdStationUrl("bluff-launch")).toBe("https://windnerd.net/en/bluff-launch");
  });

  it("refuses a non-key", () => {
    expect(() => windnerdStationUrl("https://windnerd.net/en/x")).toThrow();
  });
});

describe("parseStationConfig", () => {
  it("normalizes a pasted URL into the station key and defaults the thermometer on", () => {
    const config = parseStationConfig({
      vendor: "windnerd",
      id: "bluff",
      name: "Bluff Launch",
      stationKey: "https://windnerd.net/en/bluff-launch",
      locationId: 8675,
    });
    if (config.vendor !== "windnerd") throw new Error("wrong vendor");
    expect(config.stationKey).toBe("bluff-launch");
    expect(config.hasTemperature).toBe(true);
  });

  it("defaults the pressure board off and requires the sensor's elevation with it", () => {
    const base = {
      vendor: "windnerd",
      id: "vernon",
      name: "Vernon Lookout",
      stationKey: "vernon-lookout",
      locationId: 311,
    };
    const bare = parseStationConfig(base);
    if (bare.vendor !== "windnerd") throw new Error("wrong vendor");
    expect(bare.hasPressure).toBe(false);

    expect(() => parseStationConfig({ ...base, hasPressure: true })).toThrow(/sensor's elevation/);
    expect(() => parseStationConfig({ ...base, hasPressure: true, elevationM: null })).toThrow(
      /sensor's elevation/,
    );

    const declared = parseStationConfig({ ...base, hasPressure: true, elevationM: 450 });
    if (declared.vendor !== "windnerd") throw new Error("wrong vendor");
    expect(declared.hasPressure).toBe(true);
    expect(declared.elevationM).toBe(450);
  });

  it("defaults the battery report off — an OnSpot owner declares it", () => {
    const base = {
      vendor: "windnerd",
      id: "dundee",
      name: "Dundee Launch",
      stationKey: "dundee",
      locationId: 240,
    };
    const bare = parseStationConfig(base);
    if (bare.vendor !== "windnerd") throw new Error("wrong vendor");
    expect(bare.hasBattery).toBe(false);

    const declared = parseStationConfig({ ...base, hasBattery: true });
    if (declared.vendor !== "windnerd") throw new Error("wrong vendor");
    expect(declared.hasBattery).toBe(true);
  });

  it("rejects a station key on another host", () => {
    expect(() =>
      parseStationConfig({
        vendor: "windnerd",
        id: "bluff",
        name: "Bluff Launch",
        stationKey: "https://evil.example/en/bluff-launch",
        locationId: 8675,
      }),
    ).toThrow();
  });

  it("rejects a non-positive location id", () => {
    expect(() =>
      parseStationConfig({
        vendor: "windnerd",
        id: "bluff",
        name: "Bluff Launch",
        stationKey: "bluff-launch",
        locationId: 0,
      }),
    ).toThrow();
  });

  it("requires a tempest token", () => {
    expect(() =>
      parseStationConfig({
        vendor: "tempest",
        id: "base",
        name: "Base",
        stationId: 12345,
        token: "",
      }),
    ).toThrow();
  });

  it("normalizes an ecowitt MAC to uppercase and requires the gateway's elevation", () => {
    const base = {
      vendor: "ecowitt",
      id: "yard",
      name: "Home Yard",
      applicationKey: "app-key",
      apiKey: "api-key",
      mac: "34:94:54:aa:bb:cc",
    };
    const config = parseStationConfig({ ...base, elevationM: 1000 });
    if (config.vendor !== "ecowitt") throw new Error("wrong vendor");
    expect(config.mac).toBe("34:94:54:AA:BB:CC");
    expect(config.hasBattery).toBe(true);

    expect(() => parseStationConfig(base)).toThrow(/barometer's elevation/);
    expect(() => parseStationConfig({ ...base, elevationM: null })).toThrow(
      /barometer's elevation/,
    );
  });

  it("rejects an ecowitt MAC that is not colon-separated hex", () => {
    const base = {
      vendor: "ecowitt",
      id: "yard",
      name: "Home Yard",
      applicationKey: "app-key",
      apiKey: "api-key",
      elevationM: 1000,
    };
    expect(() => parseStationConfig({ ...base, mac: "34945_AABBCC" })).toThrow();
    expect(() => parseStationConfig({ ...base, mac: "34-94-54-AA-BB-CC" })).toThrow();
    expect(() => parseStationConfig({ ...base, mac: "34:94:54:AA:BB" })).toThrow();
  });

  it("fills campbell table and cadence defaults", () => {
    const config = parseStationConfig({
      vendor: "campbell",
      id: "summit",
      name: "Summit Logger",
      baseUrl: "http://logger.example:30001/.",
      source: "LOGGER01:Wind Station",
      timeZone: "America/Vancouver",
    });
    if (config.vendor !== "campbell") throw new Error("wrong vendor");
    expect(config.currentTable).toBe("I3Sec");
    expect(config.historyTable).toBe("I5Min");
    expect(config.currentIntervalSeconds).toBe(3);
    expect(config.historyPeriodMinutes).toBe(5);
  });

  it("rejects a campbell station without a real IANA zone", () => {
    const base = {
      vendor: "campbell",
      id: "summit",
      name: "Summit Logger",
      baseUrl: "http://logger.example:30001/.",
      source: "LOGGER01:Wind Station",
    };
    expect(() => parseStationConfig({ ...base, timeZone: "Pacific Time" })).toThrow();
    expect(() => parseStationConfig(base)).toThrow();
  });

  it("rejects a misspelled key instead of silently defaulting", () => {
    expect(() =>
      parseStationConfig({
        vendor: "windnerd",
        id: "bluff",
        name: "Bluff Launch",
        stationKey: "bluff-launch",
        locationId: 8675,
        hasTemp: false,
      }),
    ).toThrow();
    expect(() =>
      parseStationConfig({
        vendor: "campbell",
        id: "summit",
        name: "Summit Logger",
        baseUrl: "http://logger.example:30001/.",
        source: "LOGGER01:Wind Station",
        timeZone: "America/Vancouver",
        historyTables: "I5Min",
      }),
    ).toThrow();
  });

  it("accepts shared identity position and zone on every vendor", () => {
    const identity = { latitude: 50.24, longitude: -117.8, timeZone: "America/Vancouver" };
    const windnerd = parseStationConfig({
      vendor: "windnerd",
      id: "bluff",
      name: "Bluff Launch",
      stationKey: "bluff-launch",
      locationId: 8675,
      ...identity,
    });
    expect(windnerd.latitude).toBe(50.24);
    expect(windnerd.timeZone).toBe("America/Vancouver");

    const tempest = parseStationConfig({
      vendor: "tempest",
      id: "base",
      name: "Base",
      stationId: 12345,
      token: "tok",
      ...identity,
    });
    expect(tempest.longitude).toBe(-117.8);
  });

  it("rejects a position off the globe or a fake zone", () => {
    const base = {
      vendor: "tempest",
      id: "base",
      name: "Base",
      stationId: 12345,
      token: "tok",
    };
    expect(() => parseStationConfig({ ...base, latitude: 91 })).toThrow();
    expect(() => parseStationConfig({ ...base, longitude: 180 })).toThrow();
    expect(() => parseStationConfig({ ...base, timeZone: "Mars/Olympus" })).toThrow();
  });

  it("parses a custom station whose loader is a function, and only a function", () => {
    const config = parseStationConfig({
      vendor: "custom",
      id: "ridge",
      name: "Ridge Sensor",
      load: async () => {
        throw new Error("unused here");
      },
    });
    if (config.vendor !== "custom") throw new Error("wrong vendor");
    expect(typeof config.load).toBe("function");

    expect(() =>
      parseStationConfig({ vendor: "custom", id: "ridge", name: "Ridge Sensor", load: "later" }),
    ).toThrow();
    expect(() =>
      parseStationConfig({ vendor: "custom", id: "ridge", name: "Ridge Sensor" }),
    ).toThrow();
  });

  it("enforces the campbell current-cache TTL floor", () => {
    const base = {
      vendor: "campbell",
      id: "summit",
      name: "Summit Logger",
      baseUrl: "http://logger.example:30001/.",
      source: "LOGGER01:Wind Station",
      timeZone: "America/Vancouver",
    };
    const config = parseStationConfig(base);
    if (config.vendor !== "campbell") throw new Error("wrong vendor");
    expect(config.currentCacheTtlSeconds).toBe(15);
    const tuned = parseStationConfig({ ...base, currentCacheTtlSeconds: 3 });
    if (tuned.vendor !== "campbell") throw new Error("wrong vendor");
    expect(tuned.currentCacheTtlSeconds).toBe(3);
    expect(() => parseStationConfig({ ...base, currentCacheTtlSeconds: 1 })).toThrow();
  });

  it("rejects a campbell base URL that is not http(s)", () => {
    expect(() =>
      parseStationConfig({
        vendor: "campbell",
        id: "summit",
        name: "Summit Logger",
        baseUrl: "ftp://logger.example/.",
        source: "LOGGER01:Wind Station",
        timeZone: "America/Vancouver",
      }),
    ).toThrow();
  });
});
