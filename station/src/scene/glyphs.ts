import type { FreshnessStatus } from "../derive.js";
import type { StationStrings } from "../strings.js";

export type WindArrowSpec = {
  className: string;
  height: number;
  width: number;
  viewBox: string;
  transform: string;
  path: { d: string; fill: string };
};

export function windArrowSpec(deg: number, size = 12): WindArrowSpec {
  return {
    className: "meteo-wind-arrow",
    height: size,
    width: size,
    viewBox: "0 0 16 16",
    transform: `rotate(${deg + 180}deg)`,
    path: { d: "M8 1 L13 14 L8 10.6 L3 14 Z", fill: "currentColor" },
  };
}

export type FreshnessBadgeSpec = {
  className: string;
  status: FreshnessStatus;
  dot: { className: string };
  text: string;
};

export function freshnessBadgeSpec(
  status: FreshnessStatus,
  words: StationStrings,
): FreshnessBadgeSpec {
  return {
    className: "meteo-freshness",
    status,
    dot: { className: "meteo-freshness-dot" },
    text: words.freshness[status],
  };
}
