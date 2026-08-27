import { resolveStation } from "../../index.js";
import { compassFanScene, compassFanSource } from "../../scene/index.js";
import type { LiveSamples } from "../../index.js";
import { MeteoStationElement } from "../lib/base.js";
import { renderOptional } from "../lib/render.js";

export class CompassFanElement extends MeteoStationElement {
  static readonly observedAttributes = ["favorable-directions", "station-id"];

  #samples: LiveSamples | null | undefined;

  constructor() {
    super();
    for (const name of ["samples"]) this.upgradeProperty(name);
  }

  get samples(): LiveSamples | null | undefined {
    return this.#samples;
  }
  set samples(value: LiveSamples | null | undefined) {
    this.#samples = value;
    this.requestRender();
  }

  protected override render(): void {
    const station =
      this.station ??
      (this.#samples == null
        ? (resolveStation(
            this.ambient()?.feed ?? null,
            this.getAttribute("station-id") ?? undefined,
          ) ?? undefined)
        : undefined);
    const { favorableDirections, words } = this.display();
    this.replaceChildren(
      ...renderOptional(
        compassFanScene({
          favorableDirections,
          samples: compassFanSource(this.#samples, station),
          station,
          stationName: station?.name,
          words,
        }),
      ),
    );
  }
}
