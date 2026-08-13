import type { ForecastDerived, ForecastLevel, SiteForecast, ForecastSurface } from "../contract.js";
import { localDateKey } from "./day-window.js";

export interface ProjectForecastOptions {
  /** Local calendar day to window to, as a zero-padded date key ("2026-08-09"), judged in `timeZone` or the document's own `site.timeZone`; requesting a day when neither exists throws. */
  day?: string;
  /** IANA timezone override for `day`. Defaults to `profile.site.timeZone`. */
  timeZone?: string;
  /** Publish every hour's `levels` as `[]` — the single biggest subtraction. */
  dropLevels?: boolean;
  /** Field subsets to keep, per block; a block absent here keeps every field, `validAt` always survives, and the envelope is never touched. */
  fields?: {
    surface?: readonly (keyof ForecastSurface)[];
    levels?: readonly (keyof ForecastLevel)[];
    derived?: readonly (keyof ForecastDerived)[];
  };
}

/** An hour whose blocks may carry field subsets; without a `fields` option the blocks are complete. */
export interface ProjectedForecastHour {
  validAt: string;
  surface: Partial<ForecastSurface>;
  levels: Array<Partial<ForecastLevel>>;
  derived: Partial<ForecastDerived>;
}

export type ProjectedSiteForecast = Omit<SiteForecast, "hours"> & {
  hours: ProjectedForecastHour[];
};

/**
 * Projects a profile document down to the hours and fields a consumer's
 * budget wants — pure subtraction, the same document with parts removed
 * and the envelope intact; with no options it returns a structural copy.
 */
export function projectForecast(
  profile: SiteForecast,
  options: ProjectForecastOptions = {},
): ProjectedSiteForecast {
  let hours: readonly SiteForecast["hours"][number][] = profile.hours;
  if (options.day !== undefined) {
    const timeZone = options.timeZone ?? profile.site.timeZone;
    if (!timeZone) {
      throw new Error(
        "projectForecast: windowing to a local day needs a timezone — the document declares no site.timeZone, so pass options.timeZone",
      );
    }
    const day = options.day;
    hours = hours.filter((hour) => localDateKey(hour.validAt, timeZone) === day);
  }

  const { fields } = options;
  return {
    ...profile,
    site: { ...profile.site },
    run: { ...profile.run },
    ...(profile.semantics ? { semantics: { ...profile.semantics } } : {}),
    hours: hours.map((hour) => ({
      validAt: hour.validAt,
      surface: pickFields(hour.surface, fields?.surface),
      levels: options.dropLevels
        ? []
        : hour.levels.map((level) => pickFields(level, fields?.levels)),
      derived: pickFields(hour.derived, fields?.derived),
    })),
  };
}

function pickFields<T extends object>(block: T, keep?: readonly (keyof T)[]): Partial<T> {
  if (keep === undefined) return { ...block };
  const picked: Partial<T> = {};
  for (const key of keep) {
    if (key in block) picked[key] = block[key];
  }
  return picked;
}
