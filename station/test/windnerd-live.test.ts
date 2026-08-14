import { describe, expect, it } from "vitest";
import type { StationLiveFrame } from "../src/index.js";
import {
  openStationLive,
  openWindnerdLive,
  StationLiveUnsupportedError,
  UnknownStationError,
  UpstreamError,
  windnerdStationConfigSchema,
  type StationConfigInput,
} from "../src/server/index.js";
import {
  sseResponse,
  stubEnvironment,
  timeoutError,
  windnerdLiveDigestPayload,
  windnerdLiveInitPayload,
} from "./support.js";

const config = windnerdStationConfigSchema.parse({
  vendor: "windnerd",
  id: "dundee",
  name: "Dundee Launch",
  stationKey: "dundee",
  locationId: 240,
  elevationM: 1485,
  hasBattery: true,
});

function windSamplesFrame(
  samples: unknown[] = [{ ts: "2026-08-05T22:13:03.000Z", sp: 12, dir: 100 }],
) {
  return JSON.stringify({ type: "WIND_SAMPLES", location_id: 240, samples });
}

function lastDigestFrame(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ type: "LAST_DIGEST", ...windnerdLiveDigestPayload(overrides) });
}

async function collectFrames(
  stream: ReadableStream<StationLiveFrame>,
): Promise<StationLiveFrame[]> {
  const reader = stream.getReader();
  const frames: StationLiveFrame[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) return frames;
    frames.push(value);
  }
}

function pushSse() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    response: new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }),
    push(entry: { event?: string; data: string }) {
      const name = entry.event ? `event: ${entry.event}\n` : "";
      controller.enqueue(encoder.encode(`${name}data: ${entry.data}\n\n`));
    },
    close() {
      controller.close();
    },
    wasCancelled: () => cancelled,
  };
}

describe("openWindnerdLive", () => {
  it("serves init, ping, samples, and reading frames, then closes honestly on upstream end", async () => {
    const { environment, requests } = stubEnvironment(() =>
      sseResponse(
        { data: windnerdLiveInitPayload() },
        { event: "ping", data: "{}" },
        { data: windSamplesFrame() },
        { data: lastDigestFrame() },
        { data: JSON.stringify({ type: "SOMETHING_NEW", shiny: true }) },
      ),
    );
    const stream = await openWindnerdLive(config, { environment });
    const frames = await collectFrames(stream);

    expect(requests[0]?.pathname).toBe("/api/live-url/dundee");
    expect(frames.map((frame) => frame.type)).toEqual([
      "init",
      "ping",
      "samples",
      "reading",
      "unavailable",
    ]);

    const init = frames[0];
    if (init?.type !== "init") throw new Error("expected init");
    if (init.station.status !== "ok") throw new Error("expected ok station");
    expect(init.station.id).toBe("dundee");
    expect(init.station.recommendedPollSeconds).toBe(15);
    expect(init.station.telemetry).toEqual({ batteryVoltage: 4.15 });
    expect(init.station.samples?.points).toHaveLength(3);
    expect(init.station.history).toBeNull();

    const samples = frames[2];
    if (samples?.type !== "samples") throw new Error("expected samples");
    expect(samples.stationId).toBe("dundee");
    expect(samples.samples.intervalSeconds).toBe(3);
    expect(samples.samples.points[0]?.windMps).toBe(12);

    const reading = frames[3];
    if (reading?.type !== "reading") throw new Error("expected reading");
    expect(reading.stationId).toBe("dundee");
    expect(reading.reading.windAvgMps).toBe(9);
    expect(reading.telemetry).toEqual({ batteryVoltage: 4.15 });

    const terminal = frames[4];
    if (terminal?.type !== "unavailable") throw new Error("expected unavailable");
    expect(terminal.reason).toBe("upstream_error");
  });

  it("rejects the connect phase with the mapped upstream failure", async () => {
    const down = stubEnvironment(() => new Response("down", { status: 502 }));
    await expect(openWindnerdLive(config, { environment: down.environment })).rejects.toThrow(
      "returned 502",
    );

    const limited = stubEnvironment(() => new Response("whoa", { status: 429 }));
    const rateError: unknown = await openWindnerdLive(config, {
      environment: limited.environment,
    }).catch((thrown: unknown) => thrown);
    expect(rateError).toBeInstanceOf(UpstreamError);
    if (rateError instanceof UpstreamError) expect(rateError.reason).toBe("rate_limited");

    const timedOut = stubEnvironment(() => timeoutError());
    const timeout: unknown = await openWindnerdLive(config, {
      environment: timedOut.environment,
    }).catch((thrown: unknown) => thrown);
    expect(timeout).toBeInstanceOf(UpstreamError);
    if (timeout instanceof UpstreamError) expect(timeout.reason).toBe("timeout");
  });

  it("rejects when the stream ends before its init frame", async () => {
    const { environment } = stubEnvironment(() => sseResponse({ event: "ping", data: "{}" }));
    await expect(openWindnerdLive(config, { environment })).rejects.toThrow(
      "ended before its init frame",
    );
  });

  it("degrades to a terminal contract_break frame on a malformed mid-stream frame", async () => {
    const { environment, logs } = stubEnvironment(() =>
      sseResponse(
        { data: windnerdLiveInitPayload() },
        { data: windSamplesFrame([{ ts: "2026-08-05T22:13:03.000Z", sp: 600, dir: 100 }]) },
      ),
    );
    const frames = await collectFrames(await openWindnerdLive(config, { environment }));
    expect(frames.map((frame) => frame.type)).toEqual(["init", "unavailable"]);
    const terminal = frames[1];
    if (terminal?.type !== "unavailable") throw new Error("expected unavailable");
    expect(terminal.reason).toBe("contract_break");
    expect(logs.some((event) => event.message.includes("live stream failed"))).toBe(true);
  });

  it("degrades to contract_break on unparseable mid-stream data", async () => {
    const { environment } = stubEnvironment(() =>
      sseResponse({ data: windnerdLiveInitPayload() }, { data: "not json" }),
    );
    const frames = await collectFrames(await openWindnerdLive(config, { environment }));
    expect(frames.map((frame) => frame.type)).toEqual(["init", "unavailable"]);
    const terminal = frames[1];
    if (terminal?.type !== "unavailable") throw new Error("expected unavailable");
    expect(terminal.reason).toBe("contract_break");
  });

  it("declares a quiet stream unavailable through the idle watchdog", async () => {
    const upstream = pushSse();
    const { environment, logs } = stubEnvironment(() => upstream.response);
    const opening = openWindnerdLive(config, { environment, idleTimeoutMs: 40 });
    upstream.push({ data: windnerdLiveInitPayload() });
    const stream = await opening;

    const frames = await collectFrames(stream);
    expect(frames.map((frame) => frame.type)).toEqual(["init", "unavailable"]);
    const terminal = frames[1];
    if (terminal?.type !== "unavailable") throw new Error("expected unavailable");
    expect(terminal.reason).toBe("timeout");
    expect(logs.some((event) => event.message.includes("went quiet"))).toBe(true);
    expect(upstream.wasCancelled()).toBe(true);
  });

  it("tears down the upstream connection when the consumer cancels", async () => {
    const upstream = pushSse();
    const { environment } = stubEnvironment(() => upstream.response);
    const opening = openWindnerdLive(config, { environment });
    upstream.push({ data: windnerdLiveInitPayload() });
    const stream = await opening;

    const reader = stream.getReader();
    const first = await reader.read();
    expect(first.value?.type).toBe("init");
    await reader.cancel();

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(upstream.wasCancelled()).toBe(true);
  });

  it("closes cleanly, with no unavailable frame, when the caller's signal aborts", async () => {
    const upstream = pushSse();
    const { environment } = stubEnvironment(() => upstream.response);
    const caller = new AbortController();
    const opening = openWindnerdLive(config, { environment, signal: caller.signal });
    upstream.push({ data: windnerdLiveInitPayload() });
    const stream = await opening;

    const collecting = collectFrames(stream);
    caller.abort();
    const frames = await collecting;
    expect(frames.map((frame) => frame.type)).toEqual(["init"]);
    expect(upstream.wasCancelled()).toBe(true);
  });
});

describe("openStationLive", () => {
  const stations: StationConfigInput[] = [
    {
      vendor: "windnerd",
      id: "dundee",
      name: "Dundee Launch",
      stationKey: "dundee",
      locationId: 240,
      hasBattery: true,
    },
    {
      vendor: "campbell",
      id: "granite",
      name: "Granite Logger",
      baseUrl: "https://logger.example",
      source: "granite",
      timeZone: "America/Vancouver",
    },
  ];

  it("opens the live stream for a windnerd station", async () => {
    const { environment, requests } = stubEnvironment(() =>
      sseResponse({ data: windnerdLiveInitPayload() }),
    );
    const stream = await openStationLive({ stations, stationId: "dundee", environment });
    const frames = await collectFrames(stream);
    expect(requests[0]?.pathname).toBe("/api/live-url/dundee");
    expect(frames[0]?.type).toBe("init");
  });

  it("throws UnknownStationError for an id nobody configured", async () => {
    const { environment } = stubEnvironment(() => new Error("no requests expected"));
    await expect(
      openStationLive({ stations, stationId: "nowhere", environment }),
    ).rejects.toBeInstanceOf(UnknownStationError);
  });

  it("throws StationLiveUnsupportedError for a vendor without a live arm", async () => {
    const { environment } = stubEnvironment(() => new Error("no requests expected"));
    await expect(
      openStationLive({ stations, stationId: "granite", environment }),
    ).rejects.toBeInstanceOf(StationLiveUnsupportedError);
  });

  it("throws StationLiveUnsupportedError for a station whose config failed validation", async () => {
    const { environment } = stubEnvironment(() => new Error("no requests expected"));
    await expect(
      openStationLive({
        stations: [{ vendor: "windnerd", id: "broken", name: "Broken" } as StationConfigInput],
        stationId: "broken",
        environment,
      }),
    ).rejects.toBeInstanceOf(StationLiveUnsupportedError);
  });
});
