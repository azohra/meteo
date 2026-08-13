import type { SiteForecast } from "../../contract.js";
import type { AnalyzeThresholds, WindCeilings } from "../vocabulary.js";

/** An instant a finding cites: the document's own UTC `validAt` plus its local clock reading in the analysis timezone. */
export interface CitedInstant {
  validAt: string;
  /** The full local timestamp, ISO-shaped, h23, minute precision — a data value, not display copy; voice formatting is deliberately downstream. */
  local: string;
}

/** Local calendar date key ("2026-08-09") in the analysis `timeZone`; pairing findings with a consumer's own day tabs requires both sides to compute the key in the same zone. */
export type LocalDayKey = string;

/** The per-analysis context every extractor reads from. */
export interface Context {
  profile: SiteForecast;
  timeZone: string;
  deterministic: boolean;
  /** The leading cadence (the first two hours' gap) — a display fact only: live documents switch cadence mid-horizon, so spacing arithmetic reads `steps`. */
  stepHours: number;
  /** Per-hour spacing facts at the document's actual (varying) cadence. */
  steps: HourSteps;
  /** The caller-supplied launch elevation; null when none was supplied. */
  launchElevationM: number | null;
  /** launchElevationM, falling back to the model's own ground. */
  launchReferenceM: number;
  cite: (validAt: string) => CitedInstant;
  thresholds: AnalyzeThresholds;
  /** The caller's wind ceilings; absent means windExceedance emits nothing — no defaults exist anywhere. */
  windCeilings?: WindCeilings;
}

/**
 * Per-hour spacing at the document's actual cadence, aligned with
 * `profile.hours`. The covered-span convention: a published step covers
 * the hours from its own instant to the next published sample, so
 * `after[i]` is hour i's covered span and the horizon's last sample
 * mirrors its arriving gap; at constant cadence every span equals the
 * cadence.
 */
export interface HourSteps {
  /** Hours from the previous published sample to hour i; the first hour mirrors its forward gap (1 for single-hour documents). */
  before: number[];
  /** Hours from hour i to the next published sample — hour i's covered span; the last hour mirrors its arriving gap (1 for single-hour documents). */
  after: number[];
  /** The document's widest adjacent gap; 1 for documents under two hours. */
  maxStepHours: number;
  /** Document hour index by validAt, for extractors holding cited hours. */
  indexOf: Map<string, number>;
}

export function hourStepsOf(profile: SiteForecast): HourSteps {
  const n = profile.hours.length;
  const indexOf = new Map(profile.hours.map((hour, index) => [hour.validAt, index]));
  if (n < 2) {
    return { before: n ? [1] : [], after: n ? [1] : [], maxStepHours: 1, indexOf };
  }
  const times = profile.hours.map((hour) => Date.parse(hour.validAt));
  const gaps: number[] = [];
  for (let i = 1; i < n; i += 1) {
    gaps.push(Math.max(1, Math.round((times[i] - times[i - 1]) / 3_600_000)));
  }
  const before = [gaps[0], ...gaps];
  const after = [...gaps, gaps[gaps.length - 1]];
  return { before, after, maxStepHours: Math.max(...gaps), indexOf };
}

/** Forecast lead in hours from the run's referenceTime to a cited instant, rounded to one decimal — the one home for lead so every day-keyed kind states it the same way. */
export function leadHoursTo(referenceTime: string, validAt: string): number {
  return round1((Date.parse(validAt) - Date.parse(referenceTime)) / 3_600_000);
}

/** The leading cadence — see `Context.stepHours` for what it may and may not be used for. */
export function stepHoursOf(profile: SiteForecast): number {
  if (profile.hours.length < 2) return 1;
  const first = Date.parse(profile.hours[0].validAt);
  const second = Date.parse(profile.hours[1].validAt);
  return Math.max(1, Math.round((second - first) / 3_600_000));
}

const localClockFormatters = new Map<string, Intl.DateTimeFormat>();

export function citedInstantFactory(timeZone: string): (validAt: string) => CitedInstant {
  let formatter = localClockFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
    });
    localClockFormatters.set(timeZone, formatter);
  }
  const format = formatter;
  return (validAt: string) => {
    const parts = Object.fromEntries(
      format.formatToParts(new Date(validAt)).map(({ type, value }) => [type, value]),
    );
    return {
      validAt,
      local: `${parts["year"]}-${parts["month"]}-${parts["day"]}T${parts["hour"]}:${parts["minute"]}`,
    };
  };
}

/** One decimal — contract precision for metre magnitudes; coarser would let a finding contradict its own evidence. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Two decimals — contract precision for m/s magnitudes. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
