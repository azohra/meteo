import { climatologyRoseScene } from "../../scene/index.js";
import type { ClimatologyFilters, StationClimatology } from "../../index.js";
import { MeteoStationElement } from "../lib/base.js";
import { parseMonthsAttribute, parseSlotsAttribute } from "../lib/attributes.js";
import { renderScene } from "../lib/render.js";

export class ClimatologyRoseElement extends MeteoStationElement {
  static readonly observedAttributes = ["favorable-directions", "months", "slots", "station-name"];

  #document: StationClimatology | null | undefined;

  constructor() {
    super();
    for (const name of ["document"]) this.upgradeProperty(name);
  }

  get document(): StationClimatology | null | undefined {
    return this.#document;
  }
  set document(value: StationClimatology | null | undefined) {
    this.#document = value;
    this.requestRender();
  }

  protected override render(): void {
    const { favorableDirections, words } = this.display();
    const filters: ClimatologyFilters = {
      months: parseMonthsAttribute(this.getAttribute("months")),
      slots: parseSlotsAttribute(this.getAttribute("slots")),
    };
    this.replaceChildren(
      renderScene(
        climatologyRoseScene({
          document: this.#document,
          favorableDirections,
          filters,
          stationName: this.getAttribute("station-name") ?? undefined,
          words,
        }),
      ),
    );
  }
}
