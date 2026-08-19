import { SPEED_UNITS } from "../../derive.js";
import type { SpeedThresholds, SpeedUnit } from "../../derive.js";
import type { FavorableDirection } from "../../instruments.js";

export function numberAttribute(value: string | null): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function unitAttribute(value: string | null): SpeedUnit | undefined {
  return value != null && (SPEED_UNITS as readonly string[]).includes(value)
    ? (value as SpeedUnit)
    : undefined;
}

export function parseThresholdsAttribute(value: string | null): SpeedThresholds | null | undefined {
  if (value == null) return undefined;
  if (value.trim() === "none") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === "object" &&
      parsed != null &&
      (SPEED_UNITS as readonly string[]).includes((parsed as { unit?: unknown }).unit as string) &&
      Array.isArray((parsed as { values?: unknown }).values) &&
      ((parsed as { values: unknown[] }).values as unknown[]).every(
        (bound) => typeof bound === "number" && Number.isFinite(bound),
      )
    ) {
      return parsed as SpeedThresholds;
    }
  } catch {}
  console.warn(
    `meteo: invalid thresholds attribute ${JSON.stringify(value)} — expected ` +
      `'{"unit":"kmh","values":[12,20,28]}' or "none"; treating as absent.`,
  );
  return undefined;
}

export function parseArcsAttribute(value: string | null): FavorableDirection[] | null | undefined {
  if (value == null) return undefined;
  if (value.trim() === "none") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.every(
        (arc) =>
          typeof arc === "object" &&
          arc != null &&
          typeof (arc as { fromDeg?: unknown }).fromDeg === "number" &&
          Number.isFinite((arc as { fromDeg: number }).fromDeg) &&
          typeof (arc as { toDeg?: unknown }).toDeg === "number" &&
          Number.isFinite((arc as { toDeg: number }).toDeg),
      )
    ) {
      return parsed as FavorableDirection[];
    }
  } catch {}
  console.warn(
    `meteo: invalid favorable-directions attribute ${JSON.stringify(value)} — expected ` +
      `'[{"fromDeg":260,"toDeg":340}]' or "none"; treating as absent.`,
  );
  return undefined;
}
