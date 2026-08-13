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
