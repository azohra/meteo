import { climatologyRoseGate, climatologyRoseScene } from "../../scene/index.js";
import type { ClimatologyFilters, StationClimatology } from "../../index.js";
import { MeteoStationElement } from "../lib/base.js";
import { h } from "../lib/h.js";
import { parseMonthsAttribute, parseSlotsAttribute } from "../lib/attributes.js";
import { windRoseSceneDom } from "./WindRoseElement.js";

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
    const gate = climatologyRoseGate(this.#document, words);
    if (gate.kind === "note") {
      this.replaceChildren(h("div", { class: gate.className, role: "note" }, gate.text));
      return;
    }
    const filters: ClimatologyFilters = {
      months: parseMonthsAttribute(this.getAttribute("months")),
      slots: parseSlotsAttribute(this.getAttribute("slots")),
    };
    const scene = climatologyRoseScene({
      document: gate.document,
      favorableDirections,
      filters,
      stationName: this.getAttribute("station-name") ?? undefined,
      words,
    });
    this.replaceChildren(
      h(
        "div",
        { class: scene.className },
        windRoseSceneDom(
          scene.rose,
          ...scene.captions.map((caption) => h("p", { class: caption.className }, caption.text)),
        ),
      ),
    );
  }
}
