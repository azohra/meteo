import { requireResolved } from "../../index.js";
import { airMatrixScene } from "../../scene/index.js";
import type { Station } from "../../index.js";
import { ELEMENTS_AMBIENT_HINT } from "../lib/ambient.js";
import { MeteoStationElement } from "../lib/base.js";
import { h } from "../lib/h.js";

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

    const rowStyled = (element: HTMLElement): HTMLElement => {
      element.style.gridTemplateColumns = scene.matrix.gridTemplateColumns;
      return element;
    };

    this.replaceChildren(
      h(
        "section",
        { class: scene.className, "data-expanded": String(expanded) },
        h(
          "button",
          {
            "aria-controls": this.#panelId,
            "aria-expanded": String(expanded),
            class: scene.trigger.className,
            onclick: () => {
              this.#expanded = !this.#expanded;
              this.requestRender();
            },
            type: "button",
          },
          h("strong", { class: scene.trigger.title.className }, scene.trigger.title.text),
          h("span", { class: scene.trigger.summary.className }, scene.trigger.summary.text),
        ),
        h(
          "div",
          { class: scene.panelClassName, hidden: !expanded, id: this.#panelId },
          h(
            "div",
            { "aria-label": scene.matrix.ariaLabel, class: scene.matrix.className, role: "table" },
            rowStyled(
              h(
                "div",
                { class: scene.matrix.head.className, role: "row" },
                h("span", { class: scene.matrix.head.corner.className, role: "columnheader" }),
                scene.matrix.head.columns.map((column) =>
                  h(
                    "span",
                    { class: scene.matrix.head.columnClassName, role: "columnheader" },
                    column.text,
                  ),
                ),
              ),
            ),
            scene.matrix.rows.map((row) =>
              rowStyled(
                h(
                  "div",
                  { class: row.className, role: "row" },
                  h(
                    "span",
                    { class: row.labelClassName, role: "rowheader" },
                    row.label,
                    h("small", null, row.unit),
                  ),
                  row.cells.map((cell) =>
                    h("span", { class: cell.className, role: "cell" }, cell.text),
                  ),
                ),
              ),
            ),
          ),
          h("p", { class: scene.note.className }, scene.note.text),
        ),
      ),
    );
  }
}
