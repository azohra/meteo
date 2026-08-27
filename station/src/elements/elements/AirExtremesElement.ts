import { resolveStation } from "../../index.js";
import { airExtremesScene } from "../../scene/index.js";
import { MeteoStationElement } from "../lib/base.js";
import { renderOptional } from "../lib/render.js";

export class AirExtremesElement extends MeteoStationElement {
  static readonly observedAttributes = ["now-ms", "station-id"];

  protected override render(): void {
    const station =
      this.station ??
      resolveStation(this.ambient()?.feed ?? null, this.getAttribute("station-id") ?? undefined) ??
      undefined;
    const { words } = this.display();
    const nowAttribute = Number(this.getAttribute("now-ms"));
    this.replaceChildren(
      ...renderOptional(
        airExtremesScene({
          nowMs: Number.isFinite(nowAttribute) && nowAttribute > 0 ? nowAttribute : Date.now(),
          station,
          words,
        }),
      ),
    );
  }
}
