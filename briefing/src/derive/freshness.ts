const HOUR_MS = 3_600_000;

export type RunFreshness = "current" | "delayed" | "stale";

/** The consumer-owned tolerance: both counts are run intervals of age beyond the model's typical publication lag, and there are no defaults — lateness policy is the caller's. */
export interface RunFreshnessThresholds {
  /** Intervals a run may trail `now` (beyond the lag) and read "current" — 1 means "the successor run may simply not exist yet". */
  currentIntervals: number;
  /** Intervals past which the run reads "stale" instead of "delayed". */
  staleAfterIntervals: number;
}

/**
 * Judges how fresh a published run is at `now` against the model's
 * declared interval and publication lag: "current", "delayed" (the
 * successor is late but this is still the newest forecast), or "stale".
 * Age is `now − referenceTime` — a republish never makes the forecast
 * younger — and an unparseable instant throws a `RangeError`.
 */
export function runFreshness(
  runsEntry: { referenceTime: string; generatedAt?: string },
  model: { runIntervalHours: number; typicalPublicationLagHours: number },
  now: string,
  thresholds: RunFreshnessThresholds,
): RunFreshness {
  const referenceMs = Date.parse(runsEntry.referenceTime);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(referenceMs)) {
    throw new RangeError(`runFreshness: unparseable referenceTime ${runsEntry.referenceTime}`);
  }
  if (!Number.isFinite(nowMs)) {
    throw new RangeError(`runFreshness: unparseable now ${now}`);
  }

  const ageMs = Math.max(0, nowMs - referenceMs);
  const intervalMs = model.runIntervalHours * HOUR_MS;
  const lagMs = model.typicalPublicationLagHours * HOUR_MS;
  if (ageMs <= thresholds.currentIntervals * intervalMs + lagMs) return "current";
  if (ageMs <= thresholds.staleAfterIntervals * intervalMs + lagMs) return "delayed";
  return "stale";
}
