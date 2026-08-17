import { describe, expect, it } from "vitest";
import { UpstreamError } from "@azohra/meteo.core";
import { parseStationConnectivity, stationConnectivitySchema } from "../src/index.js";
import {
  HOLOGRAM_API_BASE,
  hologramConnectivityConfigSchema,
  hologramServiceState,
  hologramTimeToIso,
  loadHologramConnectivity,
  parseHologramConnectivity,
} from "../src/server/index.js";
import { hologramDevicePayload, stubEnvironment } from "./support.js";

const CHECKED_AT = "2026-08-17T20:00:00.000Z";

const config = hologramConnectivityConfigSchema.parse({
  apiKey: "test-key",
  deviceId: 4200001,
});

describe("hologramTimeToIso", () => {
  it("reads Hologram's naive UTC stamps as UTC", () => {
    expect(hologramTimeToIso("2026-08-17 18:01:28")).toBe("2026-08-17T18:01:28Z");
  });

  it("reads the all-zeros sentinel and absence as null, never a date", () => {
    expect(hologramTimeToIso("0000-00-00 00:00:00")).toBeNull();
    expect(hologramTimeToIso("")).toBeNull();
    expect(hologramTimeToIso(undefined)).toBeNull();
    expect(hologramTimeToIso("not a time")).toBeNull();
  });
});

describe("hologramServiceState", () => {
  it("reduces the vendor lifecycle by prefix", () => {
    expect(hologramServiceState("LIVE")).toBe("active");
    expect(hologramServiceState("LIVE-PENDING")).toBe("active");
    expect(hologramServiceState("PAUSED-USER")).toBe("paused");
    expect(hologramServiceState("DEAD-PENDING")).toBe("retired");
    expect(hologramServiceState("INACTIVE-TESTED")).toBe("inactive");
    expect(hologramServiceState("FACTORY")).toBe("inactive");
    expect(hologramServiceState("TEST-ACTIVATE")).toBe("inactive");
    expect(hologramServiceState("SOMETHING-NEW")).toBe("unknown");
    expect(hologramServiceState(null)).toBe("unknown");
  });
});

describe("parseHologramConnectivity", () => {
  it("maps a live device onto the connectivity contract", () => {
    const connectivity = parseHologramConnectivity(hologramDevicePayload(), 4200001, CHECKED_AT);
    expect(connectivity).toEqual({
      sourceLabel: "Hologram",
      checkedAt: CHECKED_AT,
      deviceName: "Bluff (12001)",
      online: true,
      lastConnectedAt: "2026-08-17T18:01:28Z",
      carrier: "Rogers Communication Partnership",
      radioTechnology: "LTE",
      sim: {
        service: "active",
        vendorState: "LIVE",
        expiresAt: "2026-08-23T20:40:55Z",
      },
      usage: {
        currentPeriodBytes: 12148067,
        previousPeriodBytes: 0,
        planName: "Global G3 Standard Flat Rate",
        planIncludedBytes: null,
        overageLimitBytes: 10_000_000_000,
      },
      lastSession: {
        beganAt: "2026-08-17T18:01:28Z",
        endedAt: null,
        bytes: 161832,
      },
    });
  });

  it("round-trips through the contract schema", () => {
    const connectivity = parseHologramConnectivity(hologramDevicePayload(), 4200001, CHECKED_AT);
    expect(parseStationConnectivity(connectivity)).toEqual(connectivity);
    expect(stationConnectivitySchema.safeParse(connectivity).success).toBe(true);
  });

  it("closes the last session when the end stamp is real", () => {
    const payload = hologramDevicePayload({
      active: false,
      session_end: "2026-08-17 18:31:02",
    });
    const connectivity = parseHologramConnectivity(payload, 4200001, CHECKED_AT);
    expect(connectivity.online).toBe(false);
    expect(connectivity.lastSession).toEqual({
      beganAt: "2026-08-17T18:01:28Z",
      endedAt: "2026-08-17T18:31:02Z",
      bytes: 161832,
    });
  });

  it("reads a flat-rate plan's data: 0 as no allotment, never a zero cap", () => {
    const connectivity = parseHologramConnectivity(hologramDevicePayload(), 4200001, CHECKED_AT);
    expect(connectivity.usage.planIncludedBytes).toBeNull();

    const metered = parseHologramConnectivity(
      hologramDevicePayload({}, { plan: { name: "Metered", data: 500_000_000 } }),
      4200001,
      CHECKED_AT,
    );
    expect(metered.usage.planIncludedBytes).toBe(500_000_000);
  });

  it("reads overagelimit -1 as uncapped", () => {
    const connectivity = parseHologramConnectivity(
      hologramDevicePayload({}, { overagelimit: -1 }),
      4200001,
      CHECKED_AT,
    );
    expect(connectivity.usage.overageLimitBytes).toBeNull();
  });

  it("keeps a never-connected device honest: absent facts are null, not zero", () => {
    const payload = hologramDevicePayload(null, {
      last_connect_time: "0000-00-00 00:00:00",
      last_network_used: "",
      cur_billing_data_used: undefined,
      last_billing_data_used: undefined,
    });
    const connectivity = parseHologramConnectivity(payload, 4200001, CHECKED_AT);
    expect(connectivity.online).toBeNull();
    expect(connectivity.lastConnectedAt).toBeNull();
    expect(connectivity.carrier).toBeNull();
    expect(connectivity.radioTechnology).toBeNull();
    expect(connectivity.lastSession).toBeNull();
    expect(connectivity.usage.currentPeriodBytes).toBeNull();
    expect(stationConnectivitySchema.safeParse(connectivity).success).toBe(true);
  });

  it("falls back to the session start when the link omits last_connect_time", () => {
    const payload = hologramDevicePayload({}, { last_connect_time: undefined });
    const connectivity = parseHologramConnectivity(payload, 4200001, CHECKED_AT);
    expect(connectivity.lastConnectedAt).toBe("2026-08-17T18:01:28Z");
  });

  it("refuses the wrong device", () => {
    expect(() => parseHologramConnectivity(hologramDevicePayload(), 999, CHECKED_AT)).toThrow(
      UpstreamError,
    );
  });

  it("surfaces Hologram's own refusal", () => {
    const refused = JSON.stringify({ success: false, error: "Not logged in" });
    expect(() => parseHologramConnectivity(refused, 4200001, CHECKED_AT)).toThrow(/Not logged in/);
  });

  it("refuses malformed JSON", () => {
    expect(() => parseHologramConnectivity("<html>", 4200001, CHECKED_AT)).toThrow(UpstreamError);
  });
});

describe("loadHologramConnectivity", () => {
  it("asks for the one device and stamps checkedAt from the environment clock", async () => {
    const stub = stubEnvironment(() => hologramDevicePayload(), "2026-08-17T20:00:00Z");
    const connectivity = await loadHologramConnectivity(config, {
      environment: stub.environment,
    });
    expect(stub.requests.map(String)).toEqual([`${HOLOGRAM_API_BASE}/devices/4200001`]);
    expect(connectivity.checkedAt).toBe(new Date("2026-08-17T20:00:00Z").toISOString());
    expect(connectivity.online).toBe(true);
  });

  it("sends the API key as basic auth and keeps it out of the cache key", async () => {
    const seen: Array<Record<string, string>> = [];
    const stub = stubEnvironment(() => hologramDevicePayload());
    const recordingFetch: typeof fetch = async (input, init) => {
      seen.push({ ...((init?.headers ?? {}) as Record<string, string>) });
      return stub.environment.fetch!(input, init);
    };
    await loadHologramConnectivity(config, {
      environment: { ...stub.environment, fetch: recordingFetch },
    });
    expect(seen[0]?.Authorization).toBe(`Basic ${btoa("apikey:test-key")}`);
    expect(await stub.environment.cache!.get("hologram/device/4200001")).not.toBeNull();
  });
});
