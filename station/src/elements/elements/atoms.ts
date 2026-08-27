import {
  bandChipNode,
  directionAtomNode,
  pressureAtomScene,
  speedAtomScene,
  temperatureAtomScene,
  updatedAtNode,
  valueAtomNode,
} from "../../scene/index.js";
import type { SpeedKind } from "../../format.js";
import { MeteoStationElement } from "../lib/base.js";
import { renderScene } from "../lib/render.js";

const STATION_ATTRIBUTES = ["station-id", "unit"] as const;

abstract class SpeedAtomElement extends MeteoStationElement {
  static readonly observedAttributes = [...STATION_ATTRIBUTES];
  protected abstract readonly kind: SpeedKind;
  protected abstract readonly component: string;

  protected override render(): void {
    const station = this.requiredStation(this.component);
    const { unit, words } = this.display();
    this.replaceChildren(
      renderScene(valueAtomNode(speedAtomScene(station, this.kind, unit, words))),
    );
  }
}

export class SpeedElement extends SpeedAtomElement {
  protected override readonly kind = "average";
  protected override readonly component = "meteo-speed";
}

export class GustElement extends SpeedAtomElement {
  protected override readonly kind = "gust";
  protected override readonly component = "meteo-gust";
}

export class LullElement extends SpeedAtomElement {
  protected override readonly kind = "lull";
  protected override readonly component = "meteo-lull";
}

export class TemperatureElement extends MeteoStationElement {
  static readonly observedAttributes = ["station-id"];

  protected override render(): void {
    const station = this.requiredStation("meteo-temperature");
    const { words } = this.display();
    this.replaceChildren(renderScene(valueAtomNode(temperatureAtomScene(station, words))));
  }
}

export class PressureElement extends MeteoStationElement {
  static readonly observedAttributes = ["station-id"];

  protected override render(): void {
    const station = this.requiredStation("meteo-pressure");
    const { words } = this.display();
    this.replaceChildren(renderScene(valueAtomNode(pressureAtomScene(station, words))));
  }
}

export class DirectionElement extends MeteoStationElement {
  static readonly observedAttributes = ["favorable-directions", "station-id"];

  protected override render(): void {
    const station = this.requiredStation("meteo-direction");
    const { favorableDirections, words } = this.display();
    this.replaceChildren(renderScene(directionAtomNode(station, words, favorableDirections)));
  }
}

export class UpdatedAtElement extends MeteoStationElement {
  static readonly observedAttributes = ["received-at-ms", "served-at", "station-id"];

  protected override connected(): void {
    this.watchFreshness();
  }

  protected override render(): void {
    const station = this.requiredStation("meteo-updated-at");
    const { formatTime, words } = this.display();
    this.replaceChildren(
      renderScene(
        updatedAtNode({
          formatTime,
          nowMs: Date.now(),
          receivedAtMs: this.receivedAtMsValue(),
          servedAt: this.servedAtValue(),
          station,
          words,
        }),
      ),
    );
  }
}

export class BandChipElement extends MeteoStationElement {
  static readonly observedAttributes = ["station-id", "thresholds", "unit"];

  #labels: readonly string[] | undefined;

  constructor() {
    super();
    this.upgradeProperty("labels");
  }

  get labels(): readonly string[] | undefined {
    return this.#labels;
  }
  set labels(value: readonly string[] | undefined) {
    this.#labels = value;
    this.requestRender();
  }

  protected override render(): void {
    const station = this.requiredStation("meteo-band-chip");
    const { thresholds, unit, words } = this.display();
    this.replaceChildren(
      renderScene(bandChipNode({ labels: this.#labels, station, thresholds, unit, words })),
    );
  }
}
