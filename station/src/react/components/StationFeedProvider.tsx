"use client";
import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import {
  requireResolved as requireResolvedWith,
  resolveStation as resolveFeedStation,
} from "../../index.js";
import type { SpeedUnit, Station, StationFeed } from "../../index.js";
import { localeFormatTime } from "../../index.js";
import type { FormatTime, StationStringOverrides } from "../../index.js";
import type { SpeedThresholds } from "../../index.js";

export type StationFeedContextValue = {
  feed: StationFeed | null;
  receivedAtMs: number | null;
  strings: StationStringOverrides | undefined;
  unit: SpeedUnit | undefined;
  formatTime: FormatTime | undefined;
  thresholds: SpeedThresholds | undefined;
};

const StationFeedContext = createContext<StationFeedContextValue | null>(null);

export function StationFeedProvider({
  feed,
  receivedAtMs,
  strings,
  unit,
  formatTime,
  thresholds,
  locale,
  children,
}: {
  feed: StationFeed | null;
  receivedAtMs: number | null;
  strings?: StationStringOverrides;
  unit?: SpeedUnit;
  formatTime?: FormatTime;
  thresholds?: SpeedThresholds;
  locale?: string;
  children?: ReactNode;
}) {
  const resolvedFormatTime = formatTime ?? (locale == null ? undefined : localeFormatTime(locale));
  const value = useMemo<StationFeedContextValue>(
    () => ({ feed, receivedAtMs, strings, unit, formatTime: resolvedFormatTime, thresholds }),
    [feed, receivedAtMs, strings, unit, resolvedFormatTime, thresholds],
  );
  return <StationFeedContext.Provider value={value}>{children}</StationFeedContext.Provider>;
}

export function useStationFeedContext(): StationFeedContextValue | null {
  return useContext(StationFeedContext);
}

export function resolveStation(
  context: StationFeedContextValue | null,
  stationId: string | undefined,
): Station | null {
  return resolveFeedStation(context?.feed ?? null, stationId);
}

export function requireResolved<T>(
  component: string,
  what: string,
  value: T | null | undefined,
): T {
  return requireResolvedWith(
    component,
    what,
    value,
    "render inside <StationFeedProvider> with a feed",
  );
}
