"use client";
import { useEffect, useState } from "react";
import { subscribeTicker } from "../../client/index.js";
import { freshness } from "../../index.js";
import type { FreshnessStatus, FreshnessThresholds } from "../../index.js";

export function useFreshness(
  observedAt: string | null | undefined,
  servedAt: string | null | undefined,
  receivedAtMs: number | null | undefined,
  thresholds?: FreshnessThresholds,
): FreshnessStatus | null {
  const [nowMs, setNowMs] = useState(() => receivedAtMs ?? Date.now());
  useEffect(() => {
    setNowMs(Date.now());
    return subscribeTicker(() => setNowMs(Date.now()));
  }, []);
  if (observedAt == null || servedAt == null || receivedAtMs == null) return null;
  return freshness({ observedAt, servedAt, receivedAtMs, nowMs }, thresholds);
}
