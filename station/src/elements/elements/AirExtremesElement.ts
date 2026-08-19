import { resolveStation } from "../../index.js";
import { airExtremesGate, airExtremesScene } from "../../scene/index.js";
import { MeteoStationElement } from "../lib/base.js";
import { h } from "../lib/h.js";

export class AirExtremesElement extends MeteoStationElement {
  static readonly observedAttributes = ["now-ms", "station-id"];

  protected override render(): void {
    const station =
      this.station ??
      resolveStation(this.ambient()?.feed ?? null, this.getAttribute("station-id") ?? undefined) ??
      undefined;
    const { words } = this.display();
    const gate = airExtremesGate(station);
    if (gate.kind === "hidden") {
      this.replaceChildren();
      return;
    }

    const nowAttribute = Number(this.getAttribute("now-ms"));
    const scene = airExtremesScene({
      nowMs: Number.isFinite(nowAttribute) && nowAttribute > 0 ? nowAttribute : Date.now(),
      station: gate.station,
      words,
    });
    if (scene == null) {
      this.replaceChildren();
      return;
    }
    this.replaceChildren(
      h(
        "dl",
        { "aria-label": scene.ariaLabel, class: scene.className },
        scene.tiles.map((tile) =>
          h(
            "div",
            { class: tile.className },
            h("dt", { class: "meteo-microlabel" }, tile.label),
            h("dd", { class: "meteo-air-extremes-value" }, tile.value),
          ),
        ),
      ),
    );
  }
}
