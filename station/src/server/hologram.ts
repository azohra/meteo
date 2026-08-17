import { z } from "zod";
import { UpstreamError } from "@azohra/meteo.core";
import type { ConnectivityServiceState, StationConnectivity } from "../connectivity.js";
import { fetchUpstreamText, resolveEnvironment, type ServerEnvironment } from "./environment.js";

export const HOLOGRAM_API_BASE = "https://dashboard.hologram.io/api/1";

/* TRIAL: caller-movable. Hologram devices report in hourly-ish sessions,
 * so five minutes keeps an admin view current without leaning on the API. */
export const TRIAL_HOLOGRAM_CACHE_TTL_SECONDS = 300;

export const hologramConnectivityConfigSchema = z.strictObject({
  apiKey: z.string().min(1),
  deviceId: z.number().int().positive(),
});
export type HologramConnectivityConfig = z.output<typeof hologramConnectivityConfigSchema>;

export type HologramConnectivityOptions = {
  environment?: ServerEnvironment;
  cacheTtlSeconds?: number;
  apiBase?: string;
};

/* Hologram stamps timestamps as naive UTC ("2026-08-17 18:01:28") and marks
 * an open session's end with an all-zeros sentinel. */
export function hologramTimeToIso(value: string | null | undefined): string | null {
  if (!value || value.startsWith("0000-00-00")) return null;
  const iso = `${value.replace(" ", "T")}Z`;
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}

const nonEmpty = (value: string | null | undefined) => (value ? value : null);

/* Only the fields this module consumes; Hologram's envelope carries many
 * more and unknown keys pass through unread. The lastsession object and the
 * link's billing/plan fields are served today but documented only in the
 * legacy API blueprint, so every one of them stays optional — absence
 * normalizes to null, never to an invented value. */
const hologramLastSessionSchema = z.object({
  active: z.boolean().nullish(),
  /* Numeric in usage records, stringified here — Hologram is inconsistent. */
  bytes: z.coerce.number().int().min(0).nullish(),
  network_name: z.string().nullish(),
  radio_access_technology: z.string().nullish(),
  session_begin: z.string().nullish(),
  session_end: z.string().nullish(),
});

const hologramPlanSchema = z.object({
  name: z.string().nullish(),
  /* 0 means the plan declares no allotment (flat rate), not a zero cap. */
  data: z.coerce.number().int().min(0).nullish(),
});

const hologramLinkSchema = z.object({
  state: z.string().nullish(),
  cur_billing_data_used: z.number().int().min(0).nullish(),
  last_billing_data_used: z.number().int().min(0).nullish(),
  last_connect_time: z.string().nullish(),
  last_network_used: z.string().nullish(),
  /* -1 means uncapped. */
  overagelimit: z.number().int().nullish(),
  plan: hologramPlanSchema.nullish(),
  whenexpires: z.string().nullish(),
});

const hologramDeviceSchema = z.object({
  id: z.number().int(),
  name: z.string().nullish(),
  lastsession: hologramLastSessionSchema.nullish(),
  links: z.object({ cellular: z.array(hologramLinkSchema) }).nullish(),
});

const hologramEnvelopeSchema = z.object({
  success: z.boolean(),
  data: z.unknown().nullish(),
  error: z.string().nullish(),
});

/* Hologram's lifecycle words (LIVE, PAUSED-USER, DEAD-PENDING, …) reduce by
 * prefix; TEST and FACTORY states are pre-activation, so they read inactive. */
export function hologramServiceState(state: string | null | undefined): ConnectivityServiceState {
  if (!state) return "unknown";
  if (state.startsWith("LIVE")) return "active";
  if (state.startsWith("PAUSED")) return "paused";
  if (state.startsWith("DEAD")) return "retired";
  if (state.startsWith("INACTIVE") || state.startsWith("FACTORY") || state.startsWith("TEST")) {
    return "inactive";
  }
  return "unknown";
}

export function parseHologramConnectivity(
  value: string,
  expectedDeviceId: number,
  checkedAt: string,
): StationConnectivity {
  let json: unknown;
  try {
    json = JSON.parse(value);
  } catch {
    throw new UpstreamError("Hologram returned malformed JSON");
  }
  const envelope = hologramEnvelopeSchema.safeParse(json);
  if (!envelope.success) throw new UpstreamError("Hologram returned an unrecognized envelope");
  if (!envelope.data.success) {
    throw new UpstreamError(`Hologram refused the request: ${envelope.data.error ?? "no reason"}`);
  }
  const device = hologramDeviceSchema.safeParse(envelope.data.data);
  if (!device.success || device.data.id !== expectedDeviceId) {
    throw new UpstreamError("Hologram returned the wrong device");
  }

  const session = device.data.lastsession ?? null;
  const link = device.data.links?.cellular[0] ?? null;
  const sessionBeganAt = hologramTimeToIso(session?.session_begin);
  const planIncludedBytes = link?.plan?.data || null;
  const overageLimitBytes =
    link?.overagelimit != null && link.overagelimit > 0 ? link.overagelimit : null;

  return {
    sourceLabel: "Hologram",
    checkedAt,
    deviceName: nonEmpty(device.data.name),
    online: session?.active ?? null,
    lastConnectedAt: hologramTimeToIso(link?.last_connect_time) ?? sessionBeganAt,
    carrier: nonEmpty(link?.last_network_used) ?? nonEmpty(session?.network_name),
    radioTechnology: nonEmpty(session?.radio_access_technology),
    sim: {
      service: hologramServiceState(link?.state),
      vendorState: link?.state ?? null,
      expiresAt: hologramTimeToIso(link?.whenexpires),
    },
    usage: {
      currentPeriodBytes: link?.cur_billing_data_used ?? null,
      previousPeriodBytes: link?.last_billing_data_used ?? null,
      planName: nonEmpty(link?.plan?.name),
      planIncludedBytes,
      overageLimitBytes,
    },
    lastSession: sessionBeganAt
      ? {
          beganAt: sessionBeganAt,
          endedAt: hologramTimeToIso(session?.session_end),
          bytes: session?.bytes ?? null,
        }
      : null,
  };
}

export async function loadHologramConnectivity(
  config: HologramConnectivityConfig,
  options: HologramConnectivityOptions = {},
): Promise<StationConnectivity> {
  const environment = resolveEnvironment(options.environment);
  const base = options.apiBase ?? HOLOGRAM_API_BASE;
  const text = await fetchUpstreamText(environment, {
    url: `${base}/devices/${config.deviceId}`,
    /* Keyed without the credential: an API key must never leak into a shared cache. */
    cacheKey: `hologram/device/${config.deviceId}`,
    cacheTtlSeconds: options.cacheTtlSeconds ?? TRIAL_HOLOGRAM_CACHE_TTL_SECONDS,
    subject: `Hologram device ${config.deviceId}`,
    headers: { Authorization: `Basic ${btoa(`apikey:${config.apiKey}`)}` },
  });
  return parseHologramConnectivity(text, config.deviceId, environment.now().toISOString());
}
