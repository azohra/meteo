import {
  REQUEST_TIMEOUT_S,
  USER_AGENT,
  keepAliveFetch,
  type DownloadCounters,
  type TransportFetch,
  type TransportResponse,
} from "./transport.js";

export const DD_URL = "https://dd.weather.gc.ca";

export function datamartBase(): string {
  return (process.env["METEO_DATAMART_BASE"] ?? DD_URL).replace(/\/+$/, "");
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export interface FetchBytesOptions {
  stats?: DownloadCounters;
  fetch?: TransportFetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export async function fetchBytes(
  url: string,
  options: FetchBytesOptions = {},
): Promise<Uint8Array> {
  // Keep-alive is required: undici's default fetch reconnects per request
  // because the Datamart answers with `Connection: Upgrade`.
  const fetchImpl = options.fetch ?? keepAliveFetch;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    options.stats?.recordRequest(attempt > 0);
    const settle = options.stats?.timeRequest(url);
    let response: TransportResponse | null = null;
    let body: Uint8Array | null = null;
    try {
      response = await fetchImpl(url, {
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_S * 1000),
      });
      if (response.status === 200) {
        body = new Uint8Array(await response.arrayBuffer());
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      response = null;
    }
    if (response !== null) {
      if (response.status === 200) {
        const mismatch = contentLengthMismatch(response, body!);
        if (mismatch === null) {
          settle?.(body!.byteLength, true);
          options.stats?.recordBytes(body!.byteLength);
          return body!;
        }
        settle?.(0, false);
        lastError = new Error(`Datamart ${url} ${mismatch}`);
      } else if (response.status === 404) {
        settle?.(0, true);
        throw new NotFoundError(`Datamart ${url} returned 404`);
      } else if (response.status !== 429 && response.status < 500) {
        settle?.(0, false);
        throw new Error(`Datamart ${url} failed with ${response.status}`);
      } else {
        settle?.(0, false);
        lastError = new Error(`Datamart ${url} failed with ${response.status}`);
      }
    } else {
      settle?.(0, false);
    }
    if (attempt < 2) {
      await sleep(0.25 * 2 ** attempt * (0.75 + random() * 0.5) * 1000);
    }
  }
  throw lastError!;
}

function contentLengthMismatch(response: TransportResponse, body: Uint8Array): string | null {
  const declared = response.headers.get("content-length");
  if (declared === null || response.headers.get("content-encoding")) {
    return null;
  }
  if (body.byteLength === Number(declared)) {
    return null;
  }
  return `returned ${body.byteLength} bytes against Content-Length ${declared}`;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
