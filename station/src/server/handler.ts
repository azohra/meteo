import type { StationCurrent, StationFeed } from "../contract.js";
import {
  DEFAULT_HISTORY_HOURS,
  UnknownStationError,
  assembleStations,
  loadStationCurrent,
  loadStationFeed,
  type StationsInput,
} from "./feed.js";
import { resolveEnvironment, type ServerEnvironment } from "./environment.js";

export type StationFeedHandlerRoute = "feed" | "current";

const ALLOWED_METHODS = "GET, HEAD, OPTIONS";

export type StationFeedHandlerOptions = {
  stations: StationsInput;
  primaryStationId?: string;
  maxHistoryHours?: number;
  basePath?: string;
  cors?: boolean | string;
  cacheControl?: string | ((route: StationFeedHandlerRoute, maxAgeSeconds: number) => string);
  environment?: ServerEnvironment;
};

export type StationFeedHandler = (request: Request) => Promise<Response>;

export function createStationFeedHandler(options: StationFeedHandlerOptions): StationFeedHandler {
  const environment = resolveEnvironment(options.environment);
  if (Array.isArray(options.stations)) assembleStations(options.stations, environment);
  const maxHistoryHours = options.maxHistoryHours ?? DEFAULT_HISTORY_HOURS;
  const basePath = options.basePath?.endsWith("/")
    ? options.basePath.slice(0, -1)
    : options.basePath;
  const corsOrigin =
    options.cors === true ? "*" : typeof options.cors === "string" ? options.cors : null;

  const baseHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {};
    if (corsOrigin) {
      headers["Access-Control-Allow-Origin"] = corsOrigin;
      if (corsOrigin !== "*") headers["Vary"] = "Origin";
    }
    return headers;
  };

  const cacheControlFor = (route: StationFeedHandlerRoute, maxAgeSeconds: number): string =>
    typeof options.cacheControl === "function"
      ? options.cacheControl(route, maxAgeSeconds)
      : (options.cacheControl ?? `public, max-age=${Math.round(maxAgeSeconds)}`);

  const json = (body: unknown, status: number, extraHeaders: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        ...baseHeaders(),
        "Content-Type": "application/json; charset=utf-8",
        ...extraHeaders,
      },
    });

  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS" && corsOrigin) {
      return new Response(null, {
        status: 204,
        headers: {
          ...baseHeaders(),
          "Access-Control-Allow-Methods": ALLOWED_METHODS,
          "Access-Control-Allow-Headers": "Accept, Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }
    const isHead = request.method === "HEAD";
    if (request.method !== "GET" && !isHead) {
      return json({ error: "method not allowed" }, 405, { Allow: ALLOWED_METHODS });
    }
    const respond = (
      body: unknown,
      status: number,
      extraHeaders: Record<string, string> = {},
    ): Response => {
      const response = json(body, status, extraHeaders);
      return isHead
        ? new Response(null, { status: response.status, headers: response.headers })
        : response;
    };
    const notModified = (extraHeaders: Record<string, string>): Response =>
      new Response(null, { status: 304, headers: { ...baseHeaders(), ...extraHeaders } });

    const url = new URL(request.url);
    const pathname = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
    const route: StationFeedHandlerRoute | null =
      basePath != null
        ? pathname === `${basePath}/feed`
          ? "feed"
          : pathname === `${basePath}/current`
            ? "current"
            : null
        : pathname.endsWith("/feed")
          ? "feed"
          : pathname.endsWith("/current")
            ? "current"
            : null;
    if (!route) return respond({ error: "not found" }, 404);

    const hours = parseHoursParam(url, maxHistoryHours);
    if (hours == null) {
      return respond({ error: `invalid hours: expected a number in (0, ${maxHistoryHours}]` }, 400);
    }
    const loadOptions = {
      stations: options.stations,
      primaryStationId: options.primaryStationId,
      historyHours: hours,
      maxHistoryHours,
      environment: options.environment,
      request,
    };

    if (route === "feed") {
      const feed: StationFeed = await loadStationFeed(loadOptions);
      const maxAge =
        feed.stations.length === 0
          ? 60
          : feed.stations.reduce(
              (least, station) => Math.min(least, station.recommendedPollSeconds),
              Infinity,
            );
      const headers = {
        "Cache-Control": cacheControlFor("feed", maxAge),
        ETag: weakEtag({
          schemaVersion: feed.schemaVersion,
          primaryStationId: feed.primaryStationId,
          stations: feed.stations,
        }),
      };
      if (etagMatches(request.headers.get("If-None-Match"), headers.ETag)) {
        return notModified(headers);
      }
      return respond(feed, 200, headers);
    }

    const stationId = url.searchParams.get("station");
    if (!stationId) return respond({ error: "missing station parameter" }, 400);
    let current: StationCurrent;
    try {
      current = await loadStationCurrent({ ...loadOptions, stationId });
    } catch (error) {
      if (error instanceof UnknownStationError) {
        return respond({ error: "unknown station" }, 404);
      }
      throw error;
    }
    const headers = {
      "Cache-Control": cacheControlFor("current", current.station.recommendedPollSeconds),
      ETag: weakEtag({ schemaVersion: current.schemaVersion, station: current.station }),
    };
    if (etagMatches(request.headers.get("If-None-Match"), headers.ETag)) {
      return notModified(headers);
    }
    return respond(current, 200, headers);
  };
}

const HOURS_STEP = 0.25;

function parseHoursParam(url: URL, ceiling: number): number | null {
  const raw = url.searchParams.get("hours");
  if (raw == null) return ceiling;
  const value = Number(raw.trim() === "" ? Number.NaN : raw);
  if (!Number.isFinite(value) || value <= 0 || value > ceiling) return null;
  const quantized = Math.round(value / HOURS_STEP) * HOURS_STEP;
  return Math.min(ceiling, Math.max(HOURS_STEP, quantized));
}

function weakEtag(value: unknown): string {
  const text = JSON.stringify(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x01234567;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ code, 0x01000193) >>> 0;
  }
  const hex = (value32: number) => value32.toString(16).padStart(8, "0");
  return `W/"${hex(h1)}${hex(h2)}"`;
}

function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === "*") return true;
  const bare = (tag: string) => (tag.startsWith("W/") ? tag.slice(2) : tag);
  return ifNoneMatch.split(",").some((candidate) => bare(candidate.trim()) === bare(etag));
}
