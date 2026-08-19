import { resolveStation } from "../../index.js";
import {
  favorableShareGate,
  favorableShareScene,
  favorableShareSource,
} from "../../scene/index.js";
import type { HistoryPoint } from "../../index.js";
import { MeteoStationElement } from "../lib/base.js";
import { h } from "../lib/h.js";

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
    const source = favorableShareSource(this.#points, station);
    const gate = favorableShareGate(source, favorableDirections, words);
    if (gate.kind === "hidden") {
      this.replaceChildren();
      return;
    }
    if (gate.kind === "note") {
      this.replaceChildren(h("div", { class: gate.className, role: "note" }, gate.text));
      return;
    }

    const scene = favorableShareScene({ share: gate.share, stationName: station?.name, words });
    this.replaceChildren(
      h(
        "div",
        { "aria-label": scene.ariaLabel, class: scene.className },
        h("span", { class: scene.label.className }, scene.label.text),
        " ",
        h("span", { class: scene.value.className }, scene.value.text),
      ),
    );
  }
}
