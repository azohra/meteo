import { sparklineScene } from "../../scene/index.js";
import type { SpeedThresholds, Station, StationStrings } from "../../index.js";
import { numberAttribute } from "../lib/attributes.js";
import { MeteoStationElement } from "../lib/base.js";
import { renderScene } from "../lib/render.js";

function sparklineNode(options: {
  station: Station;
  thresholds: SpeedThresholds | undefined;
  words: StationStrings;
  width?: number;
  height?: number;
  showBand?: boolean;
}): Element {
  const { station, thresholds, words, width = 120, height = 32, showBand = true } = options;
  return renderScene(sparklineScene({ height, showBand, station, thresholds, width, words }));
}

export class SparklineElement extends MeteoStationElement {
  static readonly observedAttributes = ["height", "no-band", "station-id", "thresholds", "width"];

  protected override render(): void {
    const station = this.requiredStation("meteo-sparkline");
    const { thresholds, words } = this.display();
    this.replaceChildren(
      sparklineNode({
        station,
        thresholds,
        words,
        width: numberAttribute(this.getAttribute("width")) ?? 120,
        height: numberAttribute(this.getAttribute("height")) ?? 32,
        showBand: !this.hasAttribute("no-band"),
      }),
    );
  }
}
