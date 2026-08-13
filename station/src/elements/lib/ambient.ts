import type { SpeedThresholds, SpeedUnit, StationFeed } from "../../index.js";
import type { FormatTime, StationStringOverrides } from "../../index.js";

export const STATION_FEED_CONTEXT_KEY = "station-feed";

export const ELEMENTS_AMBIENT_HINT = "render inside <meteo-station-feed> with a feed";

export type AmbientStationFeed = {
  feed: StationFeed | null;
  receivedAtMs: number | null;
  strings: StationStringOverrides | undefined;
  unit: SpeedUnit | undefined;
  formatTime: FormatTime | undefined;
  thresholds: SpeedThresholds | undefined;
};
