import { requireResolved } from "../../index.js";
import {
  TABLE_BODY_CLASS,
  TABLE_ROW_CLASS,
  TABLE_STATION_CELL_CLASS,
  stationTableHeadNode,
  stationTableRootAttrs,
  stationTableRowCells,
} from "../../scene/index.js";
import type { FormatTime, SpeedUnit, Station, StationStrings } from "../../index.js";
import { ELEMENTS_AMBIENT_HINT } from "../lib/ambient.js";
import { MeteoStationElement } from "../lib/base.js";
import { stationNameNode } from "../lib/fragments.js";
import { h } from "../lib/h.js";
import { renderScene } from "../lib/render.js";

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
    this.replaceChildren(
      h(
        "div",
        stationTableRootAttrs(stations, words),
        renderScene(stationTableHeadNode(words)),
        h(
          "div",
          { class: TABLE_BODY_CLASS, role: "rowgroup" },
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
    return h(
      "div",
      { class: TABLE_ROW_CLASS, "data-status": station.status, role: "row" },
      h(
        "span",
        { class: TABLE_STATION_CELL_CLASS, role: "cell" },
        h("strong", null, stationNameNode(station)),
        h("small", null, meta),
      ),
      stationTableRowCells({ formatTime, freshness: status, station, unit, words }).map((child) =>
        typeof child === "object" && child !== null ? renderScene(child) : child,
      ),
    );
  }
}
