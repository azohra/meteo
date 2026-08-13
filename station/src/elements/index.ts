import {
  BandChipElement,
  DirectionElement,
  GustElement,
  LullElement,
  PressureElement,
  SpeedElement,
  TemperatureElement,
  UpdatedAtElement,
} from "./elements/atoms.js";
import { AirMatrixElement } from "./elements/AirMatrixElement.js";
import { CurrentConditionsElement } from "./elements/CurrentConditionsElement.js";
import { DailyPatternElement } from "./elements/DailyPatternElement.js";
import { DialElement } from "./elements/DialElement.js";
import { FreshnessBadgeElement } from "./elements/FreshnessBadgeElement.js";
import { SparklineElement } from "./elements/SparklineElement.js";
import { StationFeedElement } from "./elements/StationFeedElement.js";
import { StationStripElement } from "./elements/StationStripElement.js";
import { StationTableElement } from "./elements/StationTableElement.js";
import { TrendChartElement } from "./elements/TrendChartElement.js";
import { WindArrowElement } from "./elements/WindArrowElement.js";
import { WindHistoryChartElement } from "./elements/WindHistoryChartElement.js";
import { WindRoseElement } from "./elements/WindRoseElement.js";
import {
  StationCardChartElement,
  StationCardElement,
  StationCardHeaderElement,
  StationCardInstrumentElement,
  StationCardSummaryElement,
} from "./elements/StationCardElement.js";

export {
  BandChipElement,
  DirectionElement,
  GustElement,
  LullElement,
  PressureElement,
  SpeedElement,
  TemperatureElement,
  UpdatedAtElement,
} from "./elements/atoms.js";
export { AirMatrixElement } from "./elements/AirMatrixElement.js";
export { CurrentConditionsElement } from "./elements/CurrentConditionsElement.js";
export { DailyPatternElement } from "./elements/DailyPatternElement.js";
export { DialElement } from "./elements/DialElement.js";
export { FreshnessBadgeElement } from "./elements/FreshnessBadgeElement.js";
export { SparklineElement } from "./elements/SparklineElement.js";
export { StationFeedElement } from "./elements/StationFeedElement.js";
export { StationStripElement } from "./elements/StationStripElement.js";
export { StationTableElement } from "./elements/StationTableElement.js";
export type { StationMetaRenderer } from "./elements/StationTableElement.js";
export { TrendChartElement } from "./elements/TrendChartElement.js";
export { WindArrowElement } from "./elements/WindArrowElement.js";
export { WindHistoryChartElement } from "./elements/WindHistoryChartElement.js";
export { WindRoseElement } from "./elements/WindRoseElement.js";
export {
  StationCardChartElement,
  StationCardElement,
  StationCardHeaderElement,
  StationCardInstrumentElement,
  StationCardSummaryElement,
} from "./elements/StationCardElement.js";
export type { AmbientStationFeed } from "./lib/ambient.js";

/* Providers first: an ancestor must be defined before its descendants for a
 * whole-document upgrade, so this object's order is load-bearing. */
export const meteoElementTags = {
  "meteo-station-feed": StationFeedElement,
  "meteo-station-card": StationCardElement,
  "meteo-air-matrix": AirMatrixElement,
  "meteo-band-chip": BandChipElement,
  "meteo-current-conditions": CurrentConditionsElement,
  "meteo-daily-pattern": DailyPatternElement,
  "meteo-dial": DialElement,
  "meteo-direction": DirectionElement,
  "meteo-freshness-badge": FreshnessBadgeElement,
  "meteo-gust": GustElement,
  "meteo-lull": LullElement,
  "meteo-pressure": PressureElement,
  "meteo-sparkline": SparklineElement,
  "meteo-speed": SpeedElement,
  "meteo-station-strip": StationStripElement,
  "meteo-station-table": StationTableElement,
  "meteo-temperature": TemperatureElement,
  "meteo-trend-chart": TrendChartElement,
  "meteo-updated-at": UpdatedAtElement,
  "meteo-wind-arrow": WindArrowElement,
  "meteo-wind-history-chart": WindHistoryChartElement,
  "meteo-wind-rose": WindRoseElement,
  "meteo-station-card-chart": StationCardChartElement,
  "meteo-station-card-header": StationCardHeaderElement,
  "meteo-station-card-instrument": StationCardInstrumentElement,
  "meteo-station-card-summary": StationCardSummaryElement,
} as const;

export function defineMeteoElements(registry: CustomElementRegistry = customElements): void {
  for (const [tag, constructor] of Object.entries(meteoElementTags)) {
    const existing = registry.get(tag);
    if (existing === constructor) continue;
    if (existing != null) {
      console.warn(`meteo: <${tag}> is already defined by a different constructor; skipping.`);
      continue;
    }
    registry.define(tag, constructor);
  }
}
