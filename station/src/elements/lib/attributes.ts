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

function parseIntegerListAttribute(
  value: string | null,
  name: string,
  minimum: number,
  maximum: number,
): number[] | undefined {
  if (value == null || value.trim() === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.every(
        (entry) =>
          typeof entry === "number" &&
          Number.isInteger(entry) &&
          entry >= minimum &&
          entry <= maximum,
      )
    ) {
      return parsed as number[];
    }
  } catch {}
  console.warn(
    `meteo: invalid ${name} attribute ${JSON.stringify(value)} — expected a JSON list of ` +
      `integers in [${minimum}, ${maximum}]; treating as absent.`,
  );
  return undefined;
}

export function parseMonthsAttribute(value: string | null): number[] | undefined {
  return parseIntegerListAttribute(value, "months", 1, 12);
}

export function parseSlotsAttribute(value: string | null): number[] | undefined {
  return parseIntegerListAttribute(value, "slots", 0, 1439);
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
