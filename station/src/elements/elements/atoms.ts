import {
  bandChipScene,
  directionAtomScene,
  pressureAtomScene,
  speedAtomScene,
  temperatureAtomScene,
  updatedAtScene,
} from "../../scene/index.js";
import type { SpeedKind } from "../../format.js";
import type { ValueAtomScene } from "../../scene/index.js";
import { MeteoStationElement } from "../lib/base.js";
import { directionCellNodes } from "../lib/fragments.js";
import { h } from "../lib/h.js";
import type { ElementChild } from "../lib/h.js";

const STATION_ATTRIBUTES = ["station-id", "unit"] as const;

function valueAtomNode(scene: ValueAtomScene): HTMLElement {
  const children: ElementChild[] =
    scene.content.kind === "dash"
      ? [scene.content.text]
      : [
          scene.content.text,
          h("span", { class: scene.content.unit.className }, scene.content.unit.text),
        ];
  return h("data", { class: scene.className, value: scene.value }, ...children);
}

abstract class SpeedAtomElement extends MeteoStationElement {
  static readonly observedAttributes = [...STATION_ATTRIBUTES];
  protected abstract readonly kind: SpeedKind;
  protected abstract readonly component: string;

  protected override render(): void {
    const station = this.requiredStation(this.component);
    const { unit, words } = this.display();
    this.replaceChildren(valueAtomNode(speedAtomScene(station, this.kind, unit, words)));
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
    this.replaceChildren(valueAtomNode(temperatureAtomScene(station, words)));
  }
}

export class PressureElement extends MeteoStationElement {
  static readonly observedAttributes = ["station-id"];

  protected override render(): void {
    const station = this.requiredStation("meteo-pressure");
    const { words } = this.display();
    this.replaceChildren(valueAtomNode(pressureAtomScene(station, words)));
  }
}

export class DirectionElement extends MeteoStationElement {
  static readonly observedAttributes = ["favorable-directions", "station-id"];

  protected override render(): void {
    const station = this.requiredStation("meteo-direction");
    const { favorableDirections, words } = this.display();
    const scene = directionAtomScene(station, words, favorableDirections);
    if (scene.cell == null) {
      this.replaceChildren(h("span", { class: scene.className }, scene.dashText));
      return;
    }
    this.replaceChildren(
      h(
        "span",
        { "aria-label": scene.ariaLabel, class: scene.className },
        ...directionCellNodes(scene.cell.windAvgMps, scene.cell.windDirectionDeg, words),
      ),
    );
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
    const scene = updatedAtScene({
      formatTime,
      nowMs: Date.now(),
      receivedAtMs: this.receivedAtMsValue(),
      servedAt: this.servedAtValue(),
      station,
      words,
    });
    if (scene.kind === "dash") {
      this.replaceChildren(h("span", { class: scene.className }, scene.text));
      return;
    }
    this.replaceChildren(
      h("time", { class: scene.className, datetime: scene.dateTime }, scene.text),
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
    const scene = bandChipScene({ labels: this.#labels, station, thresholds, unit, words });
    this.replaceChildren(
      h("span", { class: scene.className, "data-band": scene.band }, scene.text),
    );
  }
}
