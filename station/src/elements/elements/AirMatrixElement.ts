import { requireResolved } from "../../index.js";
import { airMatrixScene } from "../../scene/index.js";
import type { Station } from "../../index.js";
import { ELEMENTS_AMBIENT_HINT } from "../lib/ambient.js";
import { MeteoStationElement } from "../lib/base.js";
import { h } from "../lib/h.js";
import { renderScene } from "../lib/render.js";

let panelCounter = 0;

export class AirMatrixElement extends MeteoStationElement {
  static readonly observedAttributes = ["received-at-ms", "served-at"];

  #stations: readonly Station[] | undefined;
  #expanded = false;
  readonly #panelId = `meteo-air-e${++panelCounter}`;

  constructor() {
    super();
    this.upgradeProperty("stations");
  }

  get stations(): readonly Station[] | undefined {
    return this.#stations;
  }
  set stations(value: readonly Station[] | undefined) {
    this.#stations = value;
    this.requestRender();
  }

  protected override render(): void {
    const stations = requireResolved(
      "meteo-air-matrix",
      "stations",
      this.#stations ?? this.ambient()?.feed?.stations,
      ELEMENTS_AMBIENT_HINT,
    );
    const { formatTime, words } = this.display();
    const expanded = this.#expanded;

    const scene = airMatrixScene({ formatTime, stations, words });
    if (scene == null) {
      this.replaceChildren();
      return;
    }

    this.replaceChildren(
      h(
        "section",
        { class: "meteo-air", "data-expanded": String(expanded) },
        h(
          "button",
          {
            "aria-controls": this.#panelId,
            "aria-expanded": String(expanded),
            class: "meteo-air-trigger",
            onclick: () => {
              this.#expanded = !this.#expanded;
              this.requestRender();
            },
            type: "button",
          },
          h("strong", { class: "meteo-air-title" }, scene.title),
          h("span", { class: "meteo-air-summary" }, scene.summary),
        ),
        h(
          "div",
          { class: "meteo-air-panel", hidden: !expanded, id: this.#panelId },
          scene.panel.map((child) =>
            typeof child === "object" && child !== null ? renderScene(child) : child,
          ),
        ),
      ),
    );
  }
}
