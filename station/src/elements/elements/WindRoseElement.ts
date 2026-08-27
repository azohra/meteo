import { resolveStation } from "../../index.js";
import { windRoseScene, windRoseSource } from "../../scene/index.js";
import type { HistoryPoint } from "../../index.js";
import { numberAttribute } from "../lib/attributes.js";
import { MeteoStationElement } from "../lib/base.js";
import { renderScene } from "../lib/render.js";

export class WindRoseElement extends MeteoStationElement {
  static readonly observedAttributes = [
    "favorable-directions",
    "sector-count",
    "station-id",
    "thresholds",
  ];

  #points: HistoryPoint[] | undefined;

  constructor() {
    super();
    for (const name of ["points"]) this.upgradeProperty(name);
  }

  get points(): HistoryPoint[] | undefined {
    return this.#points;
  }
  set points(value: HistoryPoint[] | undefined) {
    this.#points = value;
    this.requestRender();
  }

  protected override render(): void {
    const station =
      this.station ??
      (this.#points == null
        ? (resolveStation(
            this.ambient()?.feed ?? null,
            this.getAttribute("station-id") ?? undefined,
          ) ?? undefined)
        : undefined);
    const { favorableDirections, thresholds, words } = this.display();
    this.replaceChildren(
      renderScene(
        windRoseScene({
          favorableDirections,
          sectorCount: numberAttribute(this.getAttribute("sector-count")) ?? 16,
          source: windRoseSource(this.#points, station),
          stationName: station?.name,
          thresholds,
          words,
        }),
      ),
    );
  }
}
