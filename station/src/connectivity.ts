import { z } from "zod";

const isoTime = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), {
    message: "not an ISO timestamp",
  })
  .meta({ format: "date-time" });

const dataBytes = z.number().int().min(0);

export const CONNECTIVITY_SERVICE_STATES = [
  "active",
  "paused",
  "inactive",
  "retired",
  "unknown",
] as const;
export type ConnectivityServiceState = (typeof CONNECTIVITY_SERVICE_STATES)[number];

export const connectivitySessionSchema = z
  .object({
    beganAt: isoTime,
    endedAt: isoTime
      .nullable()
      .describe("null exactly while the session is still open — an open session has no end."),
    bytes: dataBytes
      .nullable()
      .describe("Bytes moved in this session. null means 'not reported', never zero traffic."),
  })
  .meta({ id: "ConnectivitySession" });
export type ConnectivitySession = z.infer<typeof connectivitySessionSchema>;

/* Connectivity is backhaul health, not weather and not device power — a
 * third sibling next to Reading and StationTelemetry. It never rides the
 * public station feed: data usage and carrier identity are operational
 * facts for the station's operator, served on the operator's own routes. */
export const stationConnectivitySchema = z
  .object({
    sourceLabel: z.string().describe("The backhaul provider, e.g. 'Hologram'."),
    checkedAt: isoTime.describe(
      "When this snapshot was taken from the provider, to within the " +
        "loader's cache lifetime — never when the device last answered.",
    ),
    deviceName: z.string().nullable(),
    online: z
      .boolean()
      .nullable()
      .describe(
        "In a data session right now. null when the provider does not say — " +
          "never inferred from usage recency.",
      ),
    lastConnectedAt: isoTime
      .nullable()
      .describe("When the current or most recent data session began."),
    carrier: z
      .string()
      .nullable()
      .describe("Network name the device last attached to, as the provider spells it."),
    radioTechnology: z
      .string()
      .nullable()
      .describe(
        "Radio access technology of the last session, e.g. 'LTE'. Cellular " +
          "providers do not expose signal strength through their clouds — " +
          "RSSI lives modem-side — so technology plus session recency is the " +
          "honest connection-quality signal, and this contract carries no " +
          "signal field that would have to be invented.",
      ),
    sim: z.object({
      service: z
        .enum(CONNECTIVITY_SERVICE_STATES)
        .describe("The SIM lifecycle, normalized across providers."),
      vendorState: z
        .string()
        .nullable()
        .describe("The provider's own lifecycle word, e.g. 'LIVE' or 'PAUSED-USER'."),
      expiresAt: isoTime
        .nullable()
        .describe(
          "When the SIM's current term ends, in the provider's meaning of " +
            "expiry — rolling plans renew through this boundary.",
        ),
    }),
    usage: z.object({
      currentPeriodBytes: dataBytes
        .nullable()
        .describe("Data used in the current billing period. null means 'not reported'."),
      previousPeriodBytes: dataBytes.nullable(),
      planName: z.string().nullable(),
      planIncludedBytes: dataBytes
        .min(1)
        .nullable()
        .describe(
          "Bytes the plan includes per period. null when the plan declares " +
            "no allotment (flat-rate or pay-per-byte) — never zero.",
        ),
      overageLimitBytes: dataBytes
        .min(1)
        .nullable()
        .describe("The operator-set usage cap. null means uncapped — never zero."),
    }),
    lastSession: connectivitySessionSchema.nullable(),
  })
  .meta({ id: "StationConnectivity" });
export type StationConnectivity = z.infer<typeof stationConnectivitySchema>;

export function parseStationConnectivity(value: unknown): StationConnectivity | null {
  const result = stationConnectivitySchema.safeParse(value);
  return result.success ? result.data : null;
}
