import { stationStripScene } from "../../scene/index.js";
import { MeteoStationElement } from "../lib/base.js";
import { directionCellNodes, freshnessBadgeSpan, stationNameNode } from "../lib/fragments.js";
import { h } from "../lib/h.js";
import type { ElementChild } from "../lib/h.js";

export class StationStripElement extends MeteoStationElement {
  static readonly observedAttributes = ["received-at-ms", "served-at", "station-id", "unit"];

  protected override connected(): void {
    this.watchFreshness();
  }

  protected override render(): void {
    const station = this.requiredStation("meteo-station-strip");
    const { formatTime, unit, words } = this.display();
    const status = this.freshnessOf(station);
    const scene = stationStripScene({ formatTime, station, unit, words });
    const { body } = scene;

    const cells: ElementChild[] =
      body.kind === "reading"
        ? [
            h(
              "span",
              { class: body.wind.className },
              h("strong", null, body.wind.value),
              h("small", null, body.wind.unitLabel),
            ),
            body.gustLull != null && [
              h(
                "span",
                { class: body.gustLull.lull.className },
                h("small", { class: body.gustLull.lull.labelClassName }, body.gustLull.lull.label),
                body.gustLull.lull.value,
              ),
              h(
                "span",
                { class: body.gustLull.gust.className },
                h("small", { class: body.gustLull.gust.labelClassName }, body.gustLull.gust.label),
                body.gustLull.gust.value,
              ),
            ],
            h(
              "span",
              { class: body.from.className },
              ...directionCellNodes(body.from.windAvgMps, body.from.windDirectionDeg, words),
            ),
            body.temperature != null &&
              h("span", { class: body.temperature.className }, body.temperature.text),
            h(
              "span",
              { class: body.updated.className },
              h("span", { class: body.updated.time.className }, body.updated.time.text),
              status != null && freshnessBadgeSpan(status, words),
            ),
          ]
        : [h("span", { class: body.className }, body.text)];

    this.replaceChildren(
      h(
        "div",
        {
          "aria-label": scene.root.ariaLabel,
          class: scene.root.className,
          "data-status": scene.root.status,
          role: "group",
        },
        h("span", { class: scene.stationClassName }, stationNameNode(station)),
        ...cells,
      ),
    );
  }
}
