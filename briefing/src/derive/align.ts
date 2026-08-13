import type { ForecastHour, SiteForecast } from "../contract.js";

export interface AlignedHours {
  /** The shared forecast instant, UTC — every profile publishes an hour here. */
  validAt: string;
  /** Each model's own published hour at this instant, keyed by model slug. */
  byModel: Record<string, ForecastHour>;
}

/**
 * Intersects profiles on `validAt`: returns the instants every given profile
 * publishes, chronological, each row carrying the models' hours keyed by
 * slug. Give it one profile per model — a duplicate slug would silently
 * shadow, so it throws instead. Empty input yields no rows.
 */
export function alignByValidAt(profiles: readonly SiteForecast[]): AlignedHours[] {
  if (profiles.length === 0) return [];
  const hoursBySlug = new Map<string, Map<string, ForecastHour>>();
  for (const profile of profiles) {
    if (hoursBySlug.has(profile.model)) {
      throw new Error(`alignByValidAt: two profiles share the model slug "${profile.model}"`);
    }
    hoursBySlug.set(profile.model, new Map(profile.hours.map((hour) => [hour.validAt, hour])));
  }

  const [first, ...rest] = profiles;
  const aligned: AlignedHours[] = [];
  for (const hour of first.hours) {
    if (rest.some((profile) => !hoursBySlug.get(profile.model)!.has(hour.validAt))) continue;
    const byModel: Record<string, ForecastHour> = {};
    for (const profile of profiles) {
      byModel[profile.model] = hoursBySlug.get(profile.model)!.get(hour.validAt)!;
    }
    aligned.push({ validAt: hour.validAt, byModel });
  }
  return aligned;
}
