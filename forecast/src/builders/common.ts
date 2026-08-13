import { dewPointDepression } from "../moisture.js";

export const KELVIN = 273.15;

const LEVEL_FIELDS = [
  "pressureHpa",
  "heightM",
  "temperatureC",
  "dewPointDepressionC",
  "windDirectionDeg",
  "windSpeedMps",
] as const;

export type BuilderLevel = Record<string, number>;

export interface BuilderHour {
  [field: string]: unknown;
  cloudCoverPercent: number;
  dewPointDepressionC: number;
  latentHeatFluxWm2: number;
  levels: Record<number, BuilderLevel>;
  precipitationMm: number;
  seaLevelPressureHpa: number;
  sensibleHeatFluxWm2: number;
  temperatureC: number;
  validAt: string;
  windDirectionDeg: number;
  windSpeedMps: number;
}

export function isCompleteLevel(level: BuilderLevel): boolean {
  return LEVEL_FIELDS.every((field) => field in level);
}

export function emptyHour(validAt: string): BuilderHour {
  return {
    cloudCoverPercent: Number.NaN,
    dewPointDepressionC: Number.NaN,
    latentHeatFluxWm2: Number.NaN,
    levels: {},
    precipitationMm: Number.NaN,
    seaLevelPressureHpa: Number.NaN,
    sensibleHeatFluxWm2: Number.NaN,
    temperatureC: Number.NaN,
    validAt,
    windDirectionDeg: Number.NaN,
    windSpeedMps: Number.NaN,
  };
}

export interface NamedSite {
  name: string;
}

export function requiredValue(
  provider: string,
  value: number | null | undefined,
  fieldName: string,
  site: NamedSite,
): number {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    throw new Error(`${provider} returned no ${fieldName} for ${site.name}`);
  }
  return value;
}

export function memberRequiredValue(
  value: number | null | undefined,
  field: string,
  site: NamedSite,
  member: number,
): number {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    throw new Error(`No ${field} for ${site.name} (member ${member})`);
  }
  return value;
}

export function withDewPointDepression(level: BuilderLevel): BuilderLevel {
  const { relativeHumidityPercent, ...rest } = level;
  return {
    ...rest,
    dewPointDepressionC: dewPointDepression(level["temperatureC"]!, relativeHumidityPercent!),
  };
}

export function maxSteps(): number | undefined {
  const raw = process.env["METEO_MAX_STEPS"];
  return raw ? Number.parseInt(raw, 10) : undefined;
}

export function validTime(referenceTime: string, forecastHour: number): string {
  const instantMs = Date.parse(referenceTime) + forecastHour * 3_600_000;
  return new Date(instantMs).toISOString().slice(0, 19) + "Z";
}

export function manifestInstant(): string {
  return new Date().toISOString().slice(0, 23) + "Z";
}

export function profileInstant(): string {
  return new Date().toISOString().slice(0, 19) + "Z";
}

export async function runConcurrent(
  tasks: ReadonlyArray<() => Promise<unknown>>,
  maxWorkers: number,
): Promise<void> {
  let next = 0;
  let failure: unknown;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < tasks.length) {
      const task = tasks[next]!;
      next += 1;
      try {
        await task();
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(maxWorkers, tasks.length) }, () => worker()));
  if (failed) {
    throw failure;
  }
}
