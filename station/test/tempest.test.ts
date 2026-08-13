import { describe, expect, it } from "vitest";
import {
  loadTempestStation,
  parseTempestWind,
  tempestStationConfigSchema,
} from "../src/server/index.js";
import { stubEnvironment, tempestPayload, timeoutError } from "./support.js";

const config = tempestStationConfigSchema.parse({
  vendor: "tempest",
  id: "base",
  name: "Ridge Meadow",
  stationId: 12345,
  token: "secret-token",
  elevationM: 1100,
});

describe("parseTempestWind", () => {
  it("keeps the observation's native m/s on the wire", () => {
    const { reading } = parseTempestWind(tempestPayload(), 12345);
    expect(reading.windAvgMps).toBe(2.5);
    expect(reading.windGustMps).toBe(4.2);
    expect(reading.windLullMps).toBe(1.1);
    expect(reading.windDirectionDeg).toBe(273);
    expect(reading.observedAt).toBe(new Date(1754431980 * 1000).toISOString());
    expect(reading.temperatureC).toBe(21.5);
    expect(reading.windChillC).toBe(20.9);
  });

  it("fills the whole air conditions block", () => {
    const { reading } = parseTempestWind(tempestPayload(), 12345);
    expect(reading.conditions).toEqual({
      dewPointC: 7.5,
      lastLightningStrikeAt: new Date(1754429000 * 1000).toISOString(),
      lastLightningStrikeDistanceKm: 12,
      lightningStrikeCountLastHour: 2,
      precipitationMinutesToday: 15,
      precipitationRateMmPerHour: 1.2,
      precipitationTodayMm: 1.2,
      pressureTrend: "steady",
      relativeHumidityPercent: 40,
      seaLevelPressureHpa: 1014.2,
      solarRadiationWm2: 645,
      uvIndex: 5.8,
    });
  });

  it("keeps absent conditions null rather than zero", () => {
    const { reading } = parseTempestWind(
      tempestPayload({
        dew_point: null,
        lightning_strike_last_epoch: null,
        lightning_strike_last_distance: null,
        lightning_strike_count_last_1hr: null,
        precip: null,
        precip_accum_local_day: null,
        precip_minutes_local_day: null,
        pressure_trend: null,
        relative_humidity: null,
        sea_level_pressure: null,
        solar_radiation: null,
        wind_lull: null,
        wind_chill: null,
        uv: null,
      }),
      12345,
    );
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
    expect(reading.windLullMps).toBeNull();
    expect(reading.windChillC).toBeNull();
  });

  it("parses the UV index and rejects a negative one", () => {
    expect(parseTempestWind(tempestPayload(), 12345).reading.conditions?.uvIndex).toBe(5.8);
    expect(() => parseTempestWind(tempestPayload({ uv: -0.5 }), 12345)).toThrow("negative value");
  });

  it("reports the station's own position", () => {
    const observation = parseTempestWind(tempestPayload(), 12345);
    expect(observation.latitude).toBe(49.08);
    expect(observation.longitude).toBe(-117.81);
  });

  it("rejects a position outside the globe", () => {
    expect(() => parseTempestWind(tempestPayload({}, { latitude: 91 }), 12345)).toThrow(
      "invalid latitude",
    );
    expect(() => parseTempestWind(tempestPayload({}, { longitude: -200 }), 12345)).toThrow(
      "invalid longitude",
    );
  });

  it("gives calm no direction, below the WMO threshold and not only at zero", () => {
    const dead = parseTempestWind(tempestPayload({ wind_avg: 0 }), 12345);
    expect(dead.reading.windAvgMps).toBe(0);
    expect(dead.reading.windDirectionDeg).toBeNull();

    const drifting = parseTempestWind(tempestPayload({ wind_avg: 0.4 }), 12345);
    expect(drifting.reading.windAvgMps).toBe(0.4);
    expect(drifting.reading.windDirectionDeg).toBeNull();

    const light = parseTempestWind(tempestPayload({ wind_avg: 0.6 }), 12345);
    expect(light.reading.windDirectionDeg).toBe(273);
  });

  it("rejects a wind speed beyond the adapter's 0-140 m/s bounds", () => {
    expect(() => parseTempestWind(tempestPayload({ wind_avg: 150 }), 12345)).toThrow(
      "invalid wind speed",
    );
    expect(() => parseTempestWind(tempestPayload({ wind_gust: -1 }), 12345)).toThrow(
      "invalid wind speed",
    );
  });

  it("reports the station's own elevation", () => {
    expect(parseTempestWind(tempestPayload(), 12345).elevationM).toBe(1023.5);
  });

  it("rejects the wrong station and a missing observation", () => {
    expect(() => parseTempestWind(tempestPayload(), 67890)).toThrow(
      "Tempest returned the wrong station",
    );
    expect(() => parseTempestWind(tempestPayload({}, { obs: [] }), 12345)).toThrow(
      "Tempest returned no observation",
    );
  });

  it("rejects a direction outside the compass and an invalid trend", () => {
    expect(() => parseTempestWind(tempestPayload({ wind_direction: 361 }), 12345)).toThrow(
      "invalid wind direction",
    );
    expect(() => parseTempestWind(tempestPayload({ pressure_trend: "sideways" }), 12345)).toThrow(
      "invalid pressure trend",
    );
  });
});

describe("loadTempestStation", () => {
  it("serves the official endpoint with the configured token", async () => {
    const { environment, requests } = stubEnvironment(() => tempestPayload());
    const station = await loadTempestStation(config, { environment });

    expect(station.status).toBe("ok");
    if (station.status !== "ok") return;
    expect(station.history).toBeNull();
    expect(station.capabilities).toEqual({
      gustLull: true,
      temperature: true,
      conditions: true,
      history: false,
    });
    expect(station.samplingWindowSeconds).toBe(60);
    expect(station.recommendedPollSeconds).toBe(60);
    expect(station.pageUrl).toBe("https://tempestwx.com/station/12345");
    expect(station.elevationM).toBe(1023.5);
    expect(station.latitude).toBe(49.08);
    expect(station.longitude).toBe(-117.81);
    expect(station.timeZone).toBeNull();

    const url = requests[0];
    expect(url?.origin).toBe("https://swd.weatherflow.com");
    expect(url?.pathname).toBe("/swd/rest/observations/station/12345");
    expect(url?.searchParams.get("token")).toBe("secret-token");
  });

  it("falls back to the configured elevation and position when the API omits them", async () => {
    const { environment } = stubEnvironment(() =>
      tempestPayload({}, { elevation: null, latitude: null, longitude: null }),
    );
    const positioned = tempestStationConfigSchema.parse({
      vendor: "tempest",
      id: "base",
      name: "Ridge Meadow",
      stationId: 12345,
      token: "secret-token",
      elevationM: 1100,
      latitude: 49.1,
      longitude: -117.8,
      timeZone: "America/Vancouver",
    });
    const station = await loadTempestStation(positioned, { environment });
    if (station.status !== "ok") throw new Error("expected ok");
    expect(station.elevationM).toBe(1100);
    expect(station.latitude).toBe(49.1);
    expect(station.longitude).toBe(-117.8);
    expect(station.timeZone).toBe("America/Vancouver");
  });

  it("prefers the API's position over a configured one", async () => {
    const { environment } = stubEnvironment(() => tempestPayload());
    const positioned = tempestStationConfigSchema.parse({
      vendor: "tempest",
      id: "base",
      name: "Ridge Meadow",
      stationId: 12345,
      token: "secret-token",
      latitude: 0,
      longitude: 0,
    });
    const station = await loadTempestStation(positioned, { environment });
    if (station.status !== "ok") throw new Error("expected ok");
    expect(station.latitude).toBe(49.08);
    expect(station.longitude).toBe(-117.81);
  });

  it("degrades with a reason on failure", async () => {
    const upstream = await loadTempestStation(config, {
      environment: stubEnvironment(() => new Response("nope", { status: 500 })).environment,
    });
    if (upstream.status !== "unavailable") throw new Error("expected unavailable");
    expect(upstream.reason).toBe("upstream_error");

    const timeout = await loadTempestStation(config, {
      environment: stubEnvironment(() => timeoutError()).environment,
    });
    if (timeout.status !== "unavailable") throw new Error("expected unavailable");
    expect(timeout.reason).toBe("timeout");

    const broken = await loadTempestStation(config, {
      environment: stubEnvironment(() => tempestPayload({ wind_avg: "brisk" })).environment,
    });
    if (broken.status !== "unavailable") throw new Error("expected unavailable");
    expect(broken.reason).toBe("contract_break");
  });
});
