import {
  STATION_SCHEMA_VERSION,
  type Station,
  type StationLiveFrame,
  type UnavailableReason,
} from "../../contract.js";
import { sseEvents, type SseEvent } from "../../sse.js";
import type { WindnerdStationConfig } from "../config.js";
import {
  fetchUpstreamStream,
  logUpstreamFailure,
  resolveEnvironment,
  unavailableReasonForError,
  UpstreamError,
  type ResolvedEnvironment,
  type ServerEnvironment,
} from "../environment.js";
import {
  parseWindnerdLiveDigest,
  parseWindnerdLiveInit,
  parseWindnerdLiveSampleRecords,
  WINDNERD_LIVE_INIT_TIMEOUT_MS,
  WINDNERD_LIVE_RECOMMENDED_POLL_SECONDS,
  windnerdEnrichedMeta,
  windnerdLiveReading,
  windnerdLiveSamples,
  windnerdLiveStreamUrl,
  windnerdStationMeta,
} from "./windnerd.js";

/* Three missed 20-second upstream pings before the stream is declared quiet. */
const LIVE_IDLE_TIMEOUT_MS = 75_000;

export type WindnerdLiveOptions = {
  environment?: ServerEnvironment;
  signal?: AbortSignal;
  liveUrl?: string;
  idleTimeoutMs?: number;
};

/**
 * Opens the station's live stream and returns our frames: one init, then
 * samples/reading/ping as the upstream serves them. The connect phase —
 * headers plus the upstream init frame — rejects on failure; once resolved,
 * failures degrade to a terminal unavailable frame instead of throwing.
 * One call is one upstream connection: reconnect and fan-out belong to the
 * caller, and a reconnect's fresh init frame is the resume story.
 */
export async function openWindnerdLive(
  config: WindnerdStationConfig,
  options: WindnerdLiveOptions = {},
): Promise<ReadableStream<StationLiveFrame>> {
  const environment = resolveEnvironment(options.environment);
  const subject = `WindNerd location ${config.locationId} live stream`;
  const upstream = new AbortController();
  const abortFromCaller = () => upstream.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (options.signal?.aborted) upstream.abort();
  const releaseCaller = () => options.signal?.removeEventListener("abort", abortFromCaller);

  let events: AsyncGenerator<SseEvent>;
  let initFrame: StationLiveFrame;
  try {
    const response = await fetchUpstreamStream(environment, {
      url: windnerdLiveStreamUrl(config, options.liveUrl),
      subject,
      signal: upstream.signal,
    });
    events = sseEvents(response.body as ReadableStream<Uint8Array>, {
      signal: upstream.signal,
    });
    initFrame = await readInitFrame(events, config, environment, upstream, options, subject);
  } catch (error) {
    upstream.abort();
    releaseCaller();
    throw error;
  }

  let closed = false;
  let watchdogFired = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  return new ReadableStream<StationLiveFrame>({
    start: (controller) => {
      const enqueue = (frame: StationLiveFrame) => {
        if (closed) return;
        try {
          controller.enqueue(frame);
        } catch {
          closed = true;
        }
      };
      const finish = (reason?: UnavailableReason) => {
        if (reason) enqueue({ type: "unavailable", stationId: config.id, reason });
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already errored or cancelled */
          }
        }
      };
      const resetIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          watchdogFired = true;
          upstream.abort();
        }, options.idleTimeoutMs ?? LIVE_IDLE_TIMEOUT_MS);
      };

      enqueue(initFrame);
      void (async () => {
        resetIdle();
        try {
          for await (const event of events) {
            resetIdle();
            const frame = mapLiveEvent(event, config, environment);
            if (frame) enqueue(frame);
          }
          /* The upstream hung up mid-stream; the client reconnects for a
           * fresh init frame. */
          finish("upstream_error");
        } catch (error) {
          if (options.signal?.aborted || closed) {
            finish(); /* the client walked away — nothing to report */
          } else if (watchdogFired) {
            logUpstreamFailure(environment, `${config.name} live stream went quiet`, error, {
              station: config.id,
            });
            finish("timeout");
          } else {
            logUpstreamFailure(environment, `${config.name} live stream failed`, error, {
              station: config.id,
            });
            finish(unavailableReasonForError(error));
          }
        } finally {
          if (idleTimer) clearTimeout(idleTimer);
          upstream.abort();
          releaseCaller();
        }
      })();
    },
    cancel: () => {
      closed = true;
      upstream.abort();
    },
  });
}

async function readInitFrame(
  events: AsyncGenerator<SseEvent>,
  config: WindnerdStationConfig,
  environment: ResolvedEnvironment,
  upstream: AbortController,
  options: WindnerdLiveOptions,
  subject: string,
): Promise<StationLiveFrame> {
  const timer = setTimeout(() => upstream.abort(), WINDNERD_LIVE_INIT_TIMEOUT_MS);
  try {
    /* Manual iteration: a `for await` early exit would call the generator's
     * return() and close it under the pump that reads the rest of the stream. */
    while (true) {
      const result = await events.next();
      if (result.done) {
        throw new UpstreamError(`${subject} ended before its init frame`);
      }
      const event = result.value;
      if (event.event !== "message") continue;
      let type: unknown;
      try {
        const frame: unknown = JSON.parse(event.data);
        type = isRecord(frame) ? frame.type : undefined;
      } catch {
        continue; /* pre-init noise is upstream's business; the init frame is ours */
      }
      if (type !== "INIT") continue;
      const init = parseWindnerdLiveInit(event.data, config.locationId);
      const { reading, telemetry } = windnerdLiveReading(init.digest, config);
      const station: Station = {
        ...windnerdStationMeta(config),
        ...windnerdEnrichedMeta(config, init.location, init.broadcastDelaySeconds),
        recommendedPollSeconds: WINDNERD_LIVE_RECOMMENDED_POLL_SECONDS,
        status: "ok",
        reading,
        history: null,
        telemetry,
        samples: windnerdLiveSamples(init.samples),
      };
      return {
        type: "init",
        schemaVersion: STATION_SCHEMA_VERSION,
        servedAt: environment.now().toISOString(),
        station,
      };
    }
  } catch (error) {
    if (
      upstream.signal.aborted &&
      options.signal?.aborted !== true &&
      !(error instanceof UpstreamError)
    ) {
      throw new UpstreamError(`${subject} timed out`, "timeout");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function mapLiveEvent(
  event: SseEvent,
  config: WindnerdStationConfig,
  environment: ResolvedEnvironment,
): StationLiveFrame | null {
  if (event.event === "ping") {
    return { type: "ping", servedAt: environment.now().toISOString() };
  }
  if (event.event !== "message") return null;
  let frame: unknown;
  try {
    frame = JSON.parse(event.data);
  } catch {
    throw new Error(`WindNerd location ${config.locationId} sent an unparseable live frame`);
  }
  if (!isRecord(frame)) {
    throw new Error(`WindNerd location ${config.locationId} sent an invalid live frame`);
  }
  switch (frame.type) {
    case "WIND_SAMPLES":
      return {
        type: "samples",
        stationId: config.id,
        samples: windnerdLiveSamples(
          parseWindnerdLiveSampleRecords(frame.samples, config.locationId),
        ),
      };
    case "LAST_DIGEST": {
      const { reading, telemetry } = windnerdLiveReading(
        parseWindnerdLiveDigest(frame, config.locationId),
        config,
      );
      return {
        type: "reading",
        stationId: config.id,
        servedAt: environment.now().toISOString(),
        reading,
        telemetry,
      };
    }
    default:
      /* Unknown frame types are the vendor's future, not our contract break. */
      return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
