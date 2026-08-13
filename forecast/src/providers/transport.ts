import { Agent as HttpAgent, request as httpRequest, type IncomingMessage } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { readFileSync } from "node:fs";
import { brotliDecompressSync, gunzipSync, inflateRawSync, inflateSync } from "node:zlib";

export type {
  BinaryTransportFetch as TransportFetch,
  BinaryTransportResponse as TransportResponse,
  TransportInit,
} from "@azohra/meteo.briefing/transport";
import type {
  BinaryTransportFetch as TransportFetch,
  BinaryTransportResponse as TransportResponse,
  TransportInit,
} from "@azohra/meteo.briefing/transport";

function packageVersion(): string {
  try {
    const manifest = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf-8"),
    ) as { version?: string };
    return manifest.version ?? "0.dev";
  } catch {
    return "0.dev";
  }
}

export const USER_AGENT = `azohra-meteo/${packageVersion()} (+https://github.com/azohra/meteo)`;

let httpAgent: HttpAgent | undefined;
let httpsAgent: HttpsAgent | undefined;

function agentFor(protocol: string): HttpAgent | HttpsAgent {
  if (protocol === "https:") {
    httpsAgent ??= new HttpsAgent({ keepAlive: true });
    return httpsAgent;
  }
  httpAgent ??= new HttpAgent({ keepAlive: true });
  return httpAgent;
}

function exactArrayBuffer(body: Buffer): ArrayBuffer {
  if (body.byteOffset === 0 && body.byteLength === body.buffer.byteLength) {
    return body.buffer as ArrayBuffer;
  }
  return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
}

function decodeBody(body: Buffer, contentEncoding: string | undefined): Buffer {
  if (contentEncoding === undefined || contentEncoding === "") return body;
  const codings = contentEncoding
    .split(",")
    .map((coding) => coding.trim().toLowerCase())
    .reverse();
  let decoded = body;
  for (const coding of codings) {
    if (coding === "gzip" || coding === "x-gzip") {
      decoded = gunzipSync(decoded);
    } else if (coding === "deflate") {
      try {
        decoded = inflateSync(decoded);
      } catch {
        decoded = inflateRawSync(decoded);
      }
    } else if (coding === "br") {
      decoded = brotliDecompressSync(decoded);
    } else if (coding !== "identity") {
      return body;
    }
  }
  return decoded;
}

function bufferBody(response: IncomingMessage, signal?: AbortSignal): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Buffer) => chunks.push(chunk));
    response.on("end", () => {
      try {
        const raw = Buffer.concat(chunks);
        const encoding = response.headers["content-encoding"];
        resolve(
          exactArrayBuffer(decodeBody(raw, Array.isArray(encoding) ? encoding[0] : encoding)),
        );
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    response.on("error", reject);
    response.on("close", () => {
      if (!response.complete) {
        reject(signal?.aborted ? abortError(signal) : new Error("connection closed mid-body"));
      }
    });
  });
}

function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new Error(String(reason ?? "request aborted"));
}

export function keepAliveFetch(url: string, init: TransportInit = {}): Promise<TransportResponse> {
  return new Promise<TransportResponse>((resolve, reject) => {
    const target = new URL(url);
    const signal = init.signal;
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const request = target.protocol === "https:" ? httpsRequest : httpRequest;
    const clientRequest = request(
      target,
      {
        method: init.method ?? "GET",
        headers: init.headers ?? {},
        agent: agentFor(target.protocol),
      },
      (response) => {
        const body = bufferBody(response, signal);
        body.catch(() => undefined);
        body.finally(cleanup).catch(() => undefined);
        resolve({
          status: response.statusCode ?? 0,
          headers: {
            get: (name: string): string | null => {
              const value = response.headers[name.toLowerCase()];
              return value === undefined ? null : Array.isArray(value) ? value.join(", ") : value;
            },
          },
          arrayBuffer: () => body,
        });
      },
    );
    const onAbort = (): void => {
      clientRequest.destroy(abortError(signal!));
    };
    const cleanup = (): void => {
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    clientRequest.on("error", (error) => {
      cleanup();
      reject(signal?.aborted ? abortError(signal) : error);
    });
    clientRequest.end();
  });
}

export const REQUEST_TIMEOUT_S = 60;

export class DownloadCounters {
  requests = 0;
  responseBytes = 0;
  retries = 0;

  recordRequest(retry: boolean): void {
    this.requests += 1;
    if (retry) {
      this.retries += 1;
    }
  }

  recordBytes(count: number): void {
    this.responseBytes += count;
  }
}

export async function exists(
  url: string,
  fetchImpl: TransportFetch = keepAliveFetch,
): Promise<boolean> {
  const response = await fetchImpl(url, {
    method: "HEAD",
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_S * 1000),
  });
  return response.status === 200;
}
