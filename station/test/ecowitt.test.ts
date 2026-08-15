import { describe, expect, it } from "vitest";
import {
  ecowittStationConfigSchema,
  loadEcowittStation,
  parseEcowittRealTime,
} from "../src/server/index.js";
import { seaLevelPressureHpa } from "../src/derive.js";
import { ecowittPayload, stubEnvironment, timeoutError } from "./support.js";

const config = ecowittStationConfigSchema.parse({
  vendor: "ecowitt",
  id: "yard",
  name: "Home Yard",
  applicationKey: "app-key",
  apiKey: "api-key",
  mac: "34:94:54:aa:bb:cc",
  elevationM: 1000,
});

describe("parseEcowittRealTime", () => {
  it("keeps the requested m/s on the wire and stamps the wind field's own time", () => {
    const { reading } = parseEcowittRealTime(ecowittPayload(), config);
    expect(reading.windAvgMps).toBe(2.5);
    expect(reading.windGustMps).toBe(4.2);
    expect(reading.windDirectionDeg).toBe(273);
    expect(reading.observedAt).toBe(new Date(1754431980 * 1000).toISOString());
    expect(reading.temperatureC).toBe(21.5);
  });

  it("never reports a lull or a wind chill — the hardware carries neither", () => {
    const { reading } = parseEcowittRealTime(ecowittPayload(), config);
    expect(reading.windLullMps).toBeNull();
    expect(reading.windChillC).toBeNull();
  });

  it("fills the conditions the sensors carry and reduces pressure itself", () => {
    const { reading } = parseEcowittRealTime(ecowittPayload(), config);
    expect(reading.conditions).toEqual({
      dewPointC: 7.5,
      lastLightningStrikeAt: null,
      lastLightningStrikeDistanceKm: null,
      lightningStrikeCountLastHour: null,
      precipitationMinutesToday: null,
      precipitationRateMmPerHour: 1.2,
      precipitationTodayMm: 3.4,
      pressureTrend: null,
      relativeHumidityPercent: 40,
      seaLevelPressureHpa: seaLevelPressureHpa(903.1, 1000, 21.5),
      solarRadiationWm2: 645,
      uvIndex: 5.8,
    });
  });

  it("reads WS90 battery volts as telemetry", () => {
    const { telemetry } = parseEcowittRealTime(ecowittPayload(), config);
    expect(telemetry).toEqual({ batteryVoltage: 2.78 });
  });

  it("keeps absent groups null rather than zero", () => {
    const { reading, telemetry } = parseEcowittRealTime(
      ecowittPayload({
        outdoor: {},
        pressure: {},
        rainfall_piezo: {},
        solar_and_uvi: {},
        battery: {},
      }),
      config,
    );
    expect(reading.temperatureC).toBeNull();
    expect(reading.conditions).toEqual({
      dewPointC: null,
      lastLightningStrikeAt: null,
      lastLightningStrikeDistanceKm: null,
      lightningStrikeCountLastHour: null,
      precipitationMinutesToday: null,
      precipitationRateMmPerHour: null,
      precipitationTodayMm: null,
      pressureTrend: null,
      relativeHumidityPercent: null,
      seaLevelPressureHpa: null,
      solarRadiationWm2: null,
      uvIndex: null,
    });
    expect(telemetry).toBeNull();
  });

  it("prefers the piezo rain group and falls back to a tipping bucket", () => {
    const bucket = {
      rain_rate: { time: "1754431980", unit: "mm/hr", value: "9.9" },
      daily: { time: "1754431980", unit: "mm", value: "8.8" },
    };
    const both = parseEcowittRealTime(ecowittPayload({ rainfall: bucket }), config);
    expect(both.reading.conditions?.precipitationRateMmPerHour).toBe(1.2);

    const bucketOnly = parseEcowittRealTime(
      ecowittPayload({ rainfall: bucket, rainfall_piezo: {} }),
      config,
    );
    expect(bucketOnly.reading.conditions?.precipitationRateMmPerHour).toBe(9.9);
    expect(bucketOnly.reading.conditions?.precipitationTodayMm).toBe(8.8);
  });

  it("gives calm no direction, below the WMO threshold and not only at zero", () => {
    const drifting = parseEcowittRealTime(
      ecowittPayload({
        wind: {
          wind_speed: { time: "1754431980", unit: "m/s", value: "0.4" },
          wind_gust: { time: "1754431980", unit: "m/s", value: "0.9" },
          wind_direction: { time: "1754431980", unit: "º", value: "273" },
        },
      }),
      config,
    );
    expect(drifting.reading.windAvgMps).toBe(0.4);
    expect(drifting.reading.windDirectionDeg).toBeNull();
  });

  it("rejects implausible wind, a direction off the compass, and non-numeric values", () => {
    const wind = (value: Record<string, string>) => ({
      wind: {
        wind_speed: { time: "1754431980", unit: "m/s", value: "2.5", ...value },
        wind_gust: { time: "1754431980", unit: "m/s", value: "4.2" },
        wind_direction: { time: "1754431980", unit: "º", value: value.direction ?? "273" },
      },
    });
    expect(() => parseEcowittRealTime(ecowittPayload(wind({ value: "150" })), config)).toThrow(
      "invalid wind speed",
    );
    expect(() => parseEcowittRealTime(ecowittPayload(wind({ direction: "361" })), config)).toThrow(
      "invalid wind direction",
    );
    expect(() => parseEcowittRealTime(ecowittPayload(wind({ value: "brisk" })), config)).toThrow(
      "non-numeric wind_speed.value",
    );
  });

  it("treats a fresh-but-windless payload as the device gone quiet", () => {
    expect(() => parseEcowittRealTime(ecowittPayload({ wind: {} }), config)).toThrow(
      "has not reported recently",
    );
  });

  it("maps the cloud's busy and over-limit codes to rate limiting", () => {
    for (const code of [-1, 45001]) {
      try {
        parseEcowittRealTime(ecowittPayload({}, { code, msg: "busy", data: [] }), config);
        throw new Error("expected a throw");
      } catch (error) {
        expect(error).toMatchObject({ name: "UpstreamError", reason: "rate_limited" });
      }
    }
  });

  it("surfaces a refusal with Ecowitt's own code and message", () => {
    try {
      parseEcowittRealTime(
        ecowittPayload({}, { code: 40012, msg: "Illegal Mac/Imei", data: [] }),
        config,
      );
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toMatchObject({ name: "UpstreamError", reason: "upstream_error" });
      expect((error as Error).message).toContain("Illegal Mac/Imei");
      expect((error as Error).message).toContain("40012");
    }
  });
});

describe("loadEcowittStation", () => {
  it("serves the official endpoint with credentials, the MAC, and pinned SI units", async () => {
    const { environment, requests } = stubEnvironment(() => ecowittPayload());
    const station = await loadEcowittStation(config, { environment });

    expect(station.status).toBe("ok");
    if (station.status !== "ok") return;
    expect(station.history).toBeNull();
    expect(station.capabilities).toEqual({
      gustLull: true,
      temperature: true,
      conditions: true,
      history: false,
      battery: true,
    });
    expect(station.telemetry).toEqual({ batteryVoltage: 2.78 });
    expect(station.samplingWindowSeconds).toBeNull();
    expect(station.recommendedPollSeconds).toBe(60);
    expect(station.pageUrl).toBeNull();

    const url = requests[0];
    expect(url?.origin).toBe("https://api.ecowitt.net");
    expect(url?.pathname).toBe("/api/v3/device/real_time");
    expect(url?.searchParams.get("application_key")).toBe("app-key");
    expect(url?.searchParams.get("api_key")).toBe("api-key");
    expect(url?.searchParams.get("mac")).toBe("34:94:54:AA:BB:CC");
    expect(url?.searchParams.get("call_back")).toBe(
      "outdoor,wind,pressure,rainfall,rainfall_piezo,solar_and_uvi,battery",
    );
    expect(url?.searchParams.get("temp_unitid")).toBe("1");
    expect(url?.searchParams.get("pressure_unitid")).toBe("3");
    expect(url?.searchParams.get("wind_speed_unitid")).toBe("6");
    expect(url?.searchParams.get("rainfall_unitid")).toBe("12");
    expect(url?.searchParams.get("solar_irradiance_unitid")).toBe("16");
  });

  it("keeps telemetry and the battery capability off when configured battery-less", async () => {
    const { environment } = stubEnvironment(() => ecowittPayload());
    const batteryless = ecowittStationConfigSchema.parse({
      vendor: "ecowitt",
      id: "yard",
      name: "Home Yard",
      applicationKey: "app-key",
      apiKey: "api-key",
      mac: "34:94:54:AA:BB:CC",
      elevationM: 1000,
      hasBattery: false,
    });
    const station = await loadEcowittStation(batteryless, { environment });
    if (station.status !== "ok") throw new Error("expected ok");
    expect(station.capabilities.battery).toBe(false);
    expect(station.telemetry).toBeNull();
  });

  it("degrades with a reason on failure", async () => {
    const upstream = await loadEcowittStation(config, {
      environment: stubEnvironment(() => new Response("nope", { status: 500 })).environment,
    });
    if (upstream.status !== "unavailable") throw new Error("expected unavailable");
    expect(upstream.reason).toBe("upstream_error");

    const timeout = await loadEcowittStation(config, {
      environment: stubEnvironment(() => timeoutError()).environment,
    });
    if (timeout.status !== "unavailable") throw new Error("expected unavailable");
    expect(timeout.reason).toBe("timeout");

    const busy = await loadEcowittStation(config, {
      environment: stubEnvironment(() => ecowittPayload({}, { code: 45001, msg: "Over the limit" }))
        .environment,
    });
    if (busy.status !== "unavailable") throw new Error("expected unavailable");
    expect(busy.reason).toBe("rate_limited");

    const broken = await loadEcowittStation(config, {
      environment: stubEnvironment(() => "not json").environment,
    });
    if (broken.status !== "unavailable") throw new Error("expected unavailable");
    expect(broken.reason).toBe("contract_break");
  });
});
