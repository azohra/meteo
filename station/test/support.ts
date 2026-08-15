import { memoryCache, type LogEvent, type ServerEnvironment } from "../src/server/index.js";

export type StubRoute = (url: URL) => Response | string | Error;

export type StubEnvironment = {
  environment: ServerEnvironment;
  requests: URL[];
  logs: LogEvent[];
};

export function stubEnvironment(
  route: StubRoute,
  nowIso = "2026-08-05T22:13:00Z",
): StubEnvironment {
  const requests: URL[] = [];
  const logs: LogEvent[] = [];
  const environment: ServerEnvironment = {
    fetch: (async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push(url);
      const result = route(url);
      if (result instanceof Error) throw result;
      return typeof result === "string" ? new Response(result, { status: 200 }) : result;
    }) as typeof fetch,
    cache: memoryCache(),
    logger: (event) => logs.push(event),
    now: () => new Date(nowIso),
  };
  return { environment, requests, logs };
}

export function timeoutError(): Error {
  return Object.assign(new Error("The operation was aborted due to timeout"), {
    name: "TimeoutError",
  });
}

export function windnerdPayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    records: {
      date_utc: ["2026-08-05T22:10:45Z", "2026-08-05T22:11:45Z", "2026-08-05T22:12:45Z"],
      pressure_hpa_avg: [947.7, 947.4, 947.2],
      temperature_avg: [20.2, null, 22.6],
      wind_avg_1D: [6, 12, 9],
      wind_avg_2D: [5.5, 11, 8],
      wind_dir: [300, 310, 290],
      wind_max: [8, 21, 14],
      wind_min: [4, 7, 6],
      ...overrides,
    },
  });
}

export function windnerdLiveDigestPayload(
  overrides: Record<string, unknown> = {},
  recent: Record<string, unknown> = {},
): Record<string, unknown> {
  const minute = { wind_avg_2D: 8, wind_avg_1D: 9, wind_min: 6, wind_max: 14, wind_dir: 290 };
  return {
    recent: {
      wind_avg_2D: 8,
      wind_dir: 290,
      date_utc: "2026-08-05T22:12:45Z",
      temperature: 22.6,
      pressure_hpa: 947.2,
      voltage: 4.15,
      ...recent,
    },
    last_10mn: { ...minute },
    last_60mn: { ...minute },
    last_10mn_by_1mn: [{ ...minute, wind_avg_1D: 7 }, { ...minute }],
    last_60mn_by_5mn: [{ ...minute }],
    yesterday_last_10mn: null,
    yesterday_last_60mn: null,
    ...overrides,
  };
}

export function windnerdLiveInitPayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "INIT",
    delay: 60,
    location: { id: 8675, name: "Bluff Launch", url: "bluff-launch" },
    samples: [
      { ts: "2026-08-05T22:12:39.000Z", sp: 8.1, dir: 288 },
      null,
      { ts: "2026-08-05T22:12:42.000Z", sp: 9.7, dir: 291 },
      { ts: "2026-08-05T22:12:45.000Z", sp: 0.3, dir: 290 },
    ],
    digest: windnerdLiveDigestPayload(),
    ...overrides,
  });
}

export function sseResponse(...events: Array<{ event?: string; data: string }>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const entry of events) {
        const name = entry.event ? `event: ${entry.event}\n` : "";
        controller.enqueue(encoder.encode(`${name}data: ${entry.data}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

export function tempestPayload(
  observation: Record<string, unknown> = {},
  station: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    station_id: 12345,
    station_name: "Test Ridge",
    elevation: 1023.5,
    latitude: 49.08,
    longitude: -117.81,
    obs: [
      {
        timestamp: 1754431980,
        uv: 5.8,
        air_temperature: 21.5,
        barometric_pressure: 903.1,
        sea_level_pressure: 1014.2,
        relative_humidity: 40,
        precip: 0.02,
        precip_accum_local_day: 1.2,
        precip_minutes_local_day: 15,
        wind_avg: 2.5,
        wind_direction: 273,
        wind_gust: 4.2,
        wind_lull: 1.1,
        wind_chill: 20.9,
        dew_point: 7.5,
        solar_radiation: 645,
        pressure_trend: "steady",
        lightning_strike_count_last_1hr: 2,
        lightning_strike_last_epoch: 1754429000,
        lightning_strike_last_distance: 12,
        ...observation,
      },
    ],
    ...station,
  });
}

function ecowittLeaf(unit: string, value: string): Record<string, unknown> {
  return { time: "1754431980", unit, value };
}

export function ecowittPayload(
  sections: Record<string, unknown> = {},
  envelope: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    code: 0,
    msg: "success",
    time: "1754431985",
    data: {
      outdoor: {
        temperature: ecowittLeaf("℃", "21.5"),
        feels_like: ecowittLeaf("℃", "20.9"),
        app_temp: ecowittLeaf("℃", "20.7"),
        dew_point: ecowittLeaf("℃", "7.5"),
        vpd: ecowittLeaf("inHg", "0.442"),
        humidity: ecowittLeaf("%", "40"),
      },
      wind: {
        wind_speed: ecowittLeaf("m/s", "2.5"),
        wind_gust: ecowittLeaf("m/s", "4.2"),
        wind_direction: ecowittLeaf("º", "273"),
        "10_minute_average_wind_direction": ecowittLeaf("º", "268"),
      },
      pressure: {
        relative: ecowittLeaf("hPa", "1014.2"),
        absolute: ecowittLeaf("hPa", "903.1"),
      },
      rainfall_piezo: {
        rain_rate: ecowittLeaf("mm/hr", "1.2"),
        daily: ecowittLeaf("mm", "3.4"),
        state: ecowittLeaf("", "0"),
        event: ecowittLeaf("mm", "3.4"),
        "1_hour": ecowittLeaf("mm", "0.8"),
        "24_hours": ecowittLeaf("mm", "3.4"),
      },
      solar_and_uvi: {
        solar: ecowittLeaf("W/m²", "645"),
        uvi: ecowittLeaf("", "5.8"),
      },
      battery: {
        haptic_array_battery: ecowittLeaf("V", "2.78"),
        haptic_array_capacitor: ecowittLeaf("V", "5.2"),
      },
      ...sections,
    },
    ...envelope,
  });
}

export function campbellCurrentPayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    head: {
      transaction: 0,
      signature: 33556,
      environment: {
        station_name: "Wind Station",
        table_name: "I3Sec",
        model: "CR6",
        serial_no: "1234",
        os_version: "CR6.Std.12",
        prog_name: "CPU:wind.CR6",
        interval: 3_000,
      },
      fields: [
        { name: "Wind_Speed", type: "xsd:float", units: "kilometers/hour", process: "Avg" },
        { name: "Wind_Lull", type: "xsd:float", units: "kilometers/hour", process: "Min" },
        { name: "Wind_Gust", type: "xsd:float", units: "kilometers/hour", process: "Max" },
        { name: "WindDir", type: "xsd:float", units: "degrees", process: "Smp" },
      ],
    },
    data: [{ time: "2026-08-05T15:12:57", no: 42, vals: [12.4, 8.2, 18.9, 245] }],
    more: false,
    ...overrides,
  });
}

export function campbellHistoryPayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    head: {
      transaction: 0,
      signature: 20997,
      environment: {
        station_name: "Wind Station",
        table_name: "I5Min",
        model: "CR6",
        serial_no: "1234",
        os_version: "CR6.Std.12",
        prog_name: "CPU:wind.CR6",
        interval: 300_000,
      },
      fields: [
        { name: "Temp", type: "xsd:float", units: "Deg C", process: "Smp" },
        { name: "Wind_Chill", type: "xsd:float", units: "Deg C", process: "Smp" },
        { name: "WindDir", type: "xsd:float", units: "degrees", process: "Smp" },
        { name: "WS_kph_Max", type: "xsd:float", units: "kilometers/hour", process: "Max" },
        { name: "WS_kph_Avg", type: "xsd:float", units: "kilometers/hour", process: "Avg" },
        { name: "WS_kph_Min", type: "xsd:float", units: "kilometers/hour", process: "Min" },
      ],
    },
    data: [
      { time: "2026-08-05T15:00:00", no: 1, vals: [21.5, 20.1, 250, 17.8, 11.9, 6.1] },
      { time: "2026-08-05T15:05:00", no: 2, vals: [21.8, 20.4, 255, 19.2, 12.1, 6.4] },
      { time: "2026-08-05T15:10:00", no: 3, vals: [22.1, 20.7, 248, 20.5, 12.6, 7.2] },
    ],
    more: false,
    ...overrides,
  });
}
