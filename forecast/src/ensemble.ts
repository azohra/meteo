export const PERCENTILE_POINTS = [10, 25, 50, 75, 90] as const;
export const CEILING_TOLERANCE_M = 0.5;
export const LEVEL_SCALARS = ["heightM", "temperatureC", "dewPointC", "windSpeedMps"] as const;
export const DERIVED_SCALARS = [
  "boundaryLayerTopM",
  "thermalVelocityMps",
  "cloudBaseM",
  "usableLiftTopM",
] as const;
export const CENSORED_SCALARS = ["boundaryLayerTopM", "usableLiftTopM"] as const;

export interface PercentileBlock {
  members: number;
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  ceiledMembers?: number;
}

export interface MemberHour {
  validAt: string;
  surface: Record<string, number | null | undefined>;
  levels: Array<Record<string, number> & { pressureHpa: number; heightM: number }>;
  derived: Record<string, number | null>;
}

export interface MemberProfile {
  hours: MemberHour[];
}

export function percentile(sortedValues: readonly number[], point: number): number {
  if (sortedValues.length === 0) {
    throw new Error("percentile of no values");
  }
  const rank = ((sortedValues.length - 1) * point) / 100;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) {
    return sortedValues[low];
  }
  return sortedValues[low] + (rank - low) * (sortedValues[high] - sortedValues[low]);
}

export function circularMedian(bearings: readonly number[]): number {
  if (bearings.length === 0) {
    throw new Error("circular median of no bearings");
  }
  // Multiply by these constants; dividing by the inverse differs in the last ulp.
  const degToRad = Math.PI / 180;
  const radToDeg = 180 / Math.PI;
  let east = 0;
  let north = 0;
  for (const bearing of bearings) {
    east += Math.sin(bearing * degToRad);
    north += Math.cos(bearing * degToRad);
  }
  const anchor = Math.atan2(east, north) * radToDeg;
  const unwrapped = bearings
    .map((bearing) => anchor + nonNegativeModulo(bearing - anchor + 180, 360) - 180)
    .sort((a, b) => a - b);
  return nonNegativeModulo(percentile(unwrapped, 50), 360);
}

export function percentileBlock(values: ReadonlyArray<number | null | undefined>): PercentileBlock {
  const present = values
    .filter((value): value is number => value !== null && value !== undefined)
    .sort((a, b) => a - b);
  const block = { members: present.length } as PercentileBlock;
  for (const point of PERCENTILE_POINTS) {
    block[`p${point}`] = present.length > 0 ? percentile(present, point) : null;
  }
  return block;
}

export function aggregatePressureLevels(
  memberHours: readonly MemberHour[],
  { levelScalars }: { levelScalars: readonly string[] },
): Array<Record<string, unknown>> {
  const byPressure = new Map<number, MemberHour["levels"]>();
  for (const hour of memberHours) {
    for (const level of hour.levels) {
      const bucket = byPressure.get(level.pressureHpa);
      if (bucket === undefined) {
        byPressure.set(level.pressureHpa, [level]);
      } else {
        bucket.push(level);
      }
    }
  }

  const aggregated: Array<Record<string, unknown>> = [];
  for (const [pressureHpa, levels] of byPressure) {
    const block: Record<string, unknown> = { pressureHpa };
    for (const key of levelScalars) {
      block[key] = percentileBlock(levels.map((level) => level[key]));
    }
    block["windDirectionDeg"] = circularMedian(levels.map((level) => level["windDirectionDeg"]));
    aggregated.push(block);
  }
  aggregated.sort(
    (a, b) => (a["heightM"] as PercentileBlock).p50! - (b["heightM"] as PercentileBlock).p50!,
  );
  return aggregated;
}

export function countCeiledMembers(
  memberHours: readonly MemberHour[],
  key: string,
  { ceilingToleranceM = CEILING_TOLERANCE_M }: { ceilingToleranceM?: number } = {},
): number {
  let count = 0;
  for (const hour of memberHours) {
    const value = hour.derived[key];
    const levels = hour.levels;
    if (value === null || value === undefined || levels.length === 0) {
      continue;
    }
    if (value >= levels[levels.length - 1].heightM - ceilingToleranceM) {
      count += 1;
    }
  }
  return count;
}

export function aggregateDerivedHeight(
  memberHours: readonly MemberHour[],
  key: string,
  {
    censoredScalars,
    ceilingToleranceM = CEILING_TOLERANCE_M,
  }: { censoredScalars: readonly string[]; ceilingToleranceM?: number },
): PercentileBlock {
  const block = percentileBlock(memberHours.map((hour) => hour.derived[key]));
  if (censoredScalars.includes(key)) {
    return {
      ceiledMembers: countCeiledMembers(memberHours, key, { ceilingToleranceM }),
      ...block,
    };
  }
  return block;
}

export function aggregateMemberProfiles(
  memberProfiles: readonly MemberProfile[],
  {
    surfaceScalars,
    levelScalars = LEVEL_SCALARS,
    derivedScalars = DERIVED_SCALARS,
    censoredScalars = CENSORED_SCALARS,
    optionalSurfaceScalars = [],
    ceilingToleranceM = CEILING_TOLERANCE_M,
  }: {
    surfaceScalars: readonly string[];
    levelScalars?: readonly string[];
    derivedScalars?: readonly string[];
    censoredScalars?: readonly string[];
    optionalSurfaceScalars?: readonly string[];
    ceilingToleranceM?: number;
  },
): Array<Record<string, unknown>> {
  const aggregatedHours: Array<Record<string, unknown>> = [];
  for (let hourIndex = 0; hourIndex < memberProfiles[0].hours.length; hourIndex += 1) {
    const memberHours = memberProfiles.map((profile) => profile.hours[hourIndex]);
    const surface: Record<string, unknown> = {};
    for (const key of surfaceScalars) {
      if (key === "windDirectionDeg") {
        surface[key] = circularMedian(
          memberHours.map((hour) => requiredSurfaceValue(hour, key) as number),
        );
        continue;
      }
      const values = optionalSurfaceScalars.includes(key)
        ? memberHours.map((hour) => hour.surface[key])
        : memberHours.map((hour) => requiredSurfaceValue(hour, key));
      surface[key] = percentileBlock(values);
    }

    const derived: Record<string, unknown> = {};
    for (const key of derivedScalars) {
      derived[key] = aggregateDerivedHeight(memberHours, key, {
        censoredScalars,
        ceilingToleranceM,
      });
    }

    aggregatedHours.push({
      validAt: memberHours[0].validAt,
      surface,
      levels: aggregatePressureLevels(memberHours, { levelScalars }),
      derived,
    });
  }
  return aggregatedHours;
}

function requiredSurfaceValue(hour: MemberHour, key: string): number | null {
  if (!(key in hour.surface)) {
    throw new Error(`member surface is missing required field '${key}'`);
  }
  return hour.surface[key] as number | null;
}

function nonNegativeModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}
