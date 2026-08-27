import { currentConditionsScene } from "../../scene/index.js";
import { MeteoStationElement } from "../lib/base.js";
import { renderScene } from "../lib/render.js";

let bezelCounter = 0;

export class CurrentConditionsElement extends MeteoStationElement {
  static readonly observedAttributes = [
    "received-at-ms",
    "served-at",
    "station-id",
    "thresholds",
    "unit",
  ];

  protected override connected(): void {
    this.watchFreshness();
  }

  protected override render(): void {
    const station = this.requiredStation("meteo-current-conditions");
    const { formatTime, thresholds, unit, words } = this.display();
    const status = this.freshnessOf(station);

    this.replaceChildren(
      renderScene(
        currentConditionsScene({
          bezelId: `meteo-bezel-e${++bezelCounter}`,
          formatTime,
          freshness: status,
          station,
          thresholds,
          unit,
          words,
        }),
      ),
    );
  }
}
