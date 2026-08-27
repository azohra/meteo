import { resolveStation } from "../../index.js";
import { favorableShareScene, favorableShareSource } from "../../scene/index.js";
import type { HistoryPoint } from "../../index.js";
import { MeteoStationElement } from "../lib/base.js";
import { renderOptional } from "../lib/render.js";

export class FavorableShareElement extends MeteoStationElement {
  static readonly observedAttributes = ["favorable-directions", "station-id"];

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
    const { favorableDirections, words } = this.display();
    this.replaceChildren(
      ...renderOptional(
        favorableShareScene({
          favorableDirections,
          source: favorableShareSource(this.#points, station),
          stationName: station?.name,
          words,
        }),
      ),
    );
  }
}
