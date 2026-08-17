import { afterEach, beforeEach } from "vitest";
import type { TransportFetch, TransportInit } from "../../src/providers/transport.js";

export interface StubResponse {
  status: number;
  body?: Uint8Array | string;
  headers?: Record<string, string>;
}

export interface StubbedWire {
  fetch: TransportFetch;
  requests: Array<{ url: string; init: TransportInit | undefined }>;
}

export function stubFetch(answers: ReadonlyArray<StubResponse | Error>): StubbedWire {
  const remaining = [...answers];
  const requests: StubbedWire["requests"] = [];
  const fetch: TransportFetch = async (url, init) => {
    requests.push({ url, init });
    const answer = remaining.shift();
    if (answer === undefined) {
      throw new Error(`unscripted request to ${url}`);
    }
    if (answer instanceof Error) {
      throw answer;
    }
    const bytes =
      typeof answer.body === "string"
        ? new TextEncoder().encode(answer.body)
        : (answer.body ?? new Uint8Array(0));
    return {
      status: answer.status,
      headers: new Headers(answer.headers ?? {}),
      arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
    };
  };
  return { fetch, requests };
}

export const noSleep = async (_ms: number): Promise<void> => {};

// Deleted before each test so a developer's shell cannot bleed into URL
// assertions or flip dataset reads into S3 mode.
const WIRE_ENV = [
  "METEO_DATAMART_BASE",
  "METEO_RRFS_BASE",
  "METEO_DATA_BASE",
  "METEO_S3_ENDPOINT",
  "R2_ENDPOINT",
  "METEO_R2_BUCKET",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
] as const;

export const TEST_DATA_BASE = "https://data.test";

export function useCleanWireEnv({
  dataBase = TEST_DATA_BASE,
}: { dataBase?: string | null } = {}): void {
  let saved: Partial<Record<string, string | undefined>> = {};
  beforeEach(() => {
    saved = {};
    for (const name of WIRE_ENV) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
    if (dataBase !== null) {
      process.env["METEO_DATA_BASE"] = dataBase;
    }
  });
  afterEach(() => {
    for (const name of WIRE_ENV) {
      const value = saved[name];
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });
}
