import { stationStripScene } from "../../scene/index.js";
import { MeteoStationElement } from "../lib/base.js";
import { renderScene } from "../lib/render.js";

export class StationStripElement extends MeteoStationElement {
  static readonly observedAttributes = ["received-at-ms", "served-at", "station-id", "unit"];

  protected override connected(): void {
    this.watchFreshness();
  }

  protected override render(): void {
    const station = this.requiredStation("meteo-station-strip");
    const { formatTime, unit, words } = this.display();
    const status = this.freshnessOf(station);
    this.replaceChildren(
      renderScene(stationStripScene({ formatTime, freshness: status, station, unit, words })),
    );
  }
}
