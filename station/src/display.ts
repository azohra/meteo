import type { Station, StationFeed } from "./contract.js";
import type { SpeedThresholds, SpeedUnit } from "./derive.js";
import { defaultFormatTime, mergeStringOverrides, resolveStrings } from "./strings.js";
import type { FormatTime, StationStringOverrides, StationStrings } from "./strings.js";

export type DisplayDefaults = {
  strings?: StationStringOverrides | undefined;
  unit?: SpeedUnit | undefined;
  formatTime?: FormatTime | undefined;
  thresholds?: SpeedThresholds | undefined;
};

export type DisplayProps = {
  strings?: StationStringOverrides | undefined;
  unit?: SpeedUnit | undefined;
  formatTime?: FormatTime | undefined;
  thresholds?: SpeedThresholds | null | undefined;
};

export type ResolvedDisplay = {
  strings: StationStringOverrides | undefined;
  words: StationStrings;
  unit: SpeedUnit;
  formatTime: FormatTime;
  thresholds: SpeedThresholds | undefined;
};

export function resolveDisplay(
  defaults: DisplayDefaults | null | undefined,
  props: DisplayProps,
): ResolvedDisplay {
  const strings = mergeStringOverrides(defaults?.strings, props.strings);
  return {
    strings,
    words: resolveStrings(strings),
    unit: props.unit ?? defaults?.unit ?? "kmh",
    formatTime: props.formatTime ?? defaults?.formatTime ?? defaultFormatTime,
    thresholds:
      props.thresholds === undefined ? defaults?.thresholds : (props.thresholds ?? undefined),
  };
}

export function resolveStation(
  feed: StationFeed | null | undefined,
  stationId: string | undefined,
): Station | null {
  if (feed == null) return null;
  if (stationId != null) {
    return feed.stations.find((station) => station.id === stationId) ?? null;
  }
  if (feed.primaryStationId != null) {
    const primary = feed.stations.find((station) => station.id === feed.primaryStationId);
    if (primary != null) return primary;
  }
  return feed.stations[0] ?? null;
}

export function requireResolved<T>(
  component: string,
  what: string,
  value: T | null | undefined,
  ambientHint: string,
): T {
  if (value == null) {
    throw new Error(
      `<${component}> resolved no ${what} — pass the prop explicitly or ${ambientHint}.`,
    );
  }
  return value;
}
