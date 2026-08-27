import { DIAL_SIZE } from "../../index.js";
import { dialScene } from "../../scene/index.js";
import type {
  FavorableDirection,
  SpeedThresholds,
  SpeedUnit,
  Station,
  StationStrings,
} from "../../index.js";
import { numberAttribute } from "../lib/attributes.js";
import { MeteoStationElement } from "../lib/base.js";
import { renderScene } from "../lib/render.js";

let bezelCounter = 0;

export function dialSvg(options: {
  station: Station;
  thresholds: SpeedThresholds | undefined;
  favorableDirections?: FavorableDirection[] | undefined;
  unit: SpeedUnit;
  words: StationStrings;
  size?: number;
  calmWord?: boolean;
}): Element {
  const {
    station,
    thresholds,
    favorableDirections,
    unit,
    words,
    size = DIAL_SIZE,
    calmWord = true,
  } = options;
  return renderScene(
    dialScene({
      bezelId: `meteo-bezel-e${++bezelCounter}`,
      calmWord,
      favorableDirections,
      size,
      station,
      thresholds,
      unit,
      words,
    }),
  );
}

export class DialElement extends MeteoStationElement {
  static readonly observedAttributes = [
    "favorable-directions",
    "no-calm-word",
    "received-at-ms",
    "served-at",
    "size",
    "station-id",
    "thresholds",
    "unit",
  ];

  protected override render(): void {
    const station = this.requiredStation("meteo-dial");
    const { favorableDirections, thresholds, unit, words } = this.display();
    this.replaceChildren(
      dialSvg({
        station,
        thresholds,
        favorableDirections,
        unit,
        words,
        size: numberAttribute(this.getAttribute("size")) ?? DIAL_SIZE,
        calmWord: !this.hasAttribute("no-calm-word"),
      }),
    );
  }
}
