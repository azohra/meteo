import { requireResolved } from "../../index.js";
import { stationTableRowScene, stationTableScene } from "../../scene/index.js";
import type { FormatTime, SpeedUnit, Station, StationStrings } from "../../index.js";
import { ELEMENTS_AMBIENT_HINT } from "../lib/ambient.js";
import { MeteoStationElement } from "../lib/base.js";
import { directionCellNodes, freshnessBadgeSpan, stationNameNode } from "../lib/fragments.js";
import { h } from "../lib/h.js";

export type StationMetaRenderer = (station: Station) => string | Node | null;

export class StationTableElement extends MeteoStationElement {
  static readonly observedAttributes = ["received-at-ms", "served-at", "unit"];

  #stations: readonly Station[] | undefined;
  #stationMeta: StationMetaRenderer | undefined;

  constructor() {
    super();
    for (const name of ["stations", "stationMeta"]) this.upgradeProperty(name);
  }

  get stations(): readonly Station[] | undefined {
    return this.#stations;
  }
  set stations(value: readonly Station[] | undefined) {
    this.#stations = value;
    this.requestRender();
  }

  get stationMeta(): StationMetaRenderer | undefined {
    return this.#stationMeta;
  }
  set stationMeta(value: StationMetaRenderer | undefined) {
    this.#stationMeta = value;
    this.requestRender();
  }

  protected override connected(): void {
    this.watchFreshness();
  }

  protected override render(): void {
    const stations = requireResolved(
      "meteo-station-table",
      "stations",
      this.#stations ?? this.ambient()?.feed?.stations,
      ELEMENTS_AMBIENT_HINT,
    );
    const { formatTime, unit, words } = this.display();
    const scene = stationTableScene(stations, words);

    this.replaceChildren(
      h(
        "div",
        { "aria-label": scene.root.ariaLabel, class: scene.root.className, role: "table" },
        h(
          "div",
          { class: scene.head.className, role: "row" },
          scene.head.columns.map((column) => h("span", { role: "columnheader" }, column)),
        ),
        h(
          "div",
          { class: scene.bodyClassName, role: "rowgroup" },
          stations.map((station) => this.#row(station, unit, words, formatTime)),
        ),
      ),
    );
  }

  #row(
    station: Station,
    unit: SpeedUnit,
    words: StationStrings,
    formatTime: FormatTime,
  ): HTMLElement {
    const status = this.freshnessOf(station);
    const meta = this.#stationMeta ? this.#stationMeta(station) : station.sourceLabel;
    const row = stationTableRowScene({ formatTime, station, unit, words });
    const { cells } = row;
    return h(
      "div",
      { class: row.className, "data-status": row.status, role: "row" },
      h(
        "span",
        { class: row.stationCellClassName, role: "cell" },
        h("strong", null, stationNameNode(station)),
        h("small", null, meta),
      ),
      cells.kind === "reading"
        ? [
            h(
              "span",
              { class: cells.wind.className, role: "cell" },
              h("strong", null, cells.wind.value),
              h("small", null, cells.wind.unitLabel),
            ),
            h("span", { class: cells.lull.className, role: "cell" }, cells.lull.value),
            h("span", { class: cells.gust.className, role: "cell" }, cells.gust.value),
            h(
              "span",
              { class: cells.from.className, role: "cell" },
              ...directionCellNodes(cells.from.windAvgMps, cells.from.windDirectionDeg, words),
            ),
            h(
              "span",
              { class: cells.temperature.className, role: "cell" },
              cells.temperature.value,
            ),
            h(
              "span",
              { class: cells.updated.className, role: "cell" },
              h("span", { class: cells.updated.time.className }, cells.updated.time.text),
              status != null && freshnessBadgeSpan(status, words),
            ),
          ]
        : h("span", { class: cells.className, role: "cell" }, cells.text),
    );
  }
}
