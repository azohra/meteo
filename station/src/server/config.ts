import { z } from "zod";
import { httpUrl, ianaTimeZone, positionFields } from "@azohra/meteo.core";
import type { Station } from "../contract.js";
import { normalizeWindnerdStationKey, windnerdStationUrl } from "../windnerd.js";
import type { ResolvedEnvironment } from "./environment.js";

export { normalizeWindnerdStationKey, windnerdStationUrl };

const windnerdStationKey = z
  .string()
  .refine((value) => normalizeWindnerdStationKey(value) != null, {
    message: "not a WindNerd station key or windnerd.net station URL",
  })
  .transform((value) => normalizeWindnerdStationKey(value) as string);

const stationIdentity = {
  id: z.string().min(1),
  name: z.string().min(1),
  ...positionFields,
  timeZone: ianaTimeZone.nullish(),
  pageUrl: httpUrl.nullish(),
};

export const windnerdStationConfigSchema = z
  .strictObject({
    vendor: z.literal("windnerd"),
    ...stationIdentity,
    stationKey: windnerdStationKey,
    locationId: z.number().int().positive(),
    hasTemperature: z.boolean().default(true),
    hasPressure: z.boolean().default(false),
    hasBattery: z.boolean().default(false),
  })
  .refine((config) => !config.hasPressure || config.elevationM != null, {
    message:
      "pressure needs the sensor's elevation to reduce to sea level — " +
      "set elevationM to the sensor's elevation, not the launch's",
    path: ["elevationM"],
  });
export type WindnerdStationConfig = z.output<typeof windnerdStationConfigSchema>;

export const tempestStationConfigSchema = z.strictObject({
  vendor: z.literal("tempest"),
  ...stationIdentity,
  stationId: z.number().int().positive(),
  token: z.string().min(1),
});
export type TempestStationConfig = z.output<typeof tempestStationConfigSchema>;

const ecowittMac = z
  .string()
  .regex(/^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/, {
    message: "not a colon-separated MAC address (FF:FF:FF:FF:FF:FF)",
  })
  .transform((value) => value.toUpperCase());

export const ecowittStationConfigSchema = z
  .strictObject({
    vendor: z.literal("ecowitt"),
    ...stationIdentity,
    applicationKey: z.string().min(1),
    apiKey: z.string().min(1),
    mac: ecowittMac,
    hasBattery: z.boolean().default(true),
  })
  .refine((config) => config.elevationM != null, {
    message:
      "pressure needs the barometer's elevation to reduce to sea level — " +
      "set elevationM to the gateway's elevation (the barometer lives in " +
      "the gateway, not the outdoor array)",
    path: ["elevationM"],
  });
export type EcowittStationConfig = z.output<typeof ecowittStationConfigSchema>;

export const campbellStationConfigSchema = z.strictObject({
  vendor: z.literal("campbell"),
  ...stationIdentity,
  baseUrl: httpUrl,
  source: z.string().min(1),
  timeZone: ianaTimeZone,
  currentTable: z.string().min(1).default("I3Sec"),
  historyTable: z.string().min(1).default("I5Min"),
  currentIntervalSeconds: z.number().finite().positive().default(3),
  historyPeriodMinutes: z.number().finite().positive().default(5),
  currentCacheTtlSeconds: z.number().finite().min(3).default(15),
});
export type CampbellStationConfig = z.output<typeof campbellStationConfigSchema>;

export type CustomStationIdentity = {
  readonly id: string;
  readonly name: string;
  readonly elevationM: number | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly timeZone: string | null;
  readonly pageUrl: string | null;
};

export type CustomStationContext = {
  environment: ResolvedEnvironment;
  historyHours: number;
  mode: "full" | "current";
  station: CustomStationIdentity;
};

export type CustomStationLoader = (context: CustomStationContext) => Promise<Station>;

export const customStationConfigSchema = z.strictObject({
  vendor: z.literal("custom"),
  ...stationIdentity,
  load: z.custom<CustomStationLoader>((value) => typeof value === "function", {
    message: "load must be a function returning Promise<Station>",
  }),
});
export type CustomStationConfig = z.output<typeof customStationConfigSchema>;

export const stationConfigSchema = z.discriminatedUnion("vendor", [
  windnerdStationConfigSchema,
  tempestStationConfigSchema,
  campbellStationConfigSchema,
  ecowittStationConfigSchema,
  customStationConfigSchema,
]);
export type StationConfig = z.output<typeof stationConfigSchema>;
export type StationConfigInput = z.input<typeof stationConfigSchema>;

export function parseStationConfig(value: unknown): StationConfig {
  return stationConfigSchema.parse(value);
}
