import { currentConditionsScene } from "../../scene/index.js";
import { MeteoStationElement } from "../lib/base.js";
import { freshnessBadgeSpan, windArrowSvg } from "../lib/fragments.js";
import { h } from "../lib/h.js";
import type { ElementChild } from "../lib/h.js";
import { dialSvg } from "./DialElement.js";

export class CurrentConditionsElement extends MeteoStationElement {
  static readonly observedAttributes = [
    "received-at-ms",
    "served-at",
    "station-id",
    "thresholds",
    "unit",
  ];

  protected override connected(): void {
    this.watchFreshness();
  }

  protected override render(): void {
    const station = this.requiredStation("meteo-current-conditions");
    const { formatTime, thresholds, unit, words } = this.display();
    const status = this.freshnessOf(station);

    const scene = currentConditionsScene({ formatTime, station, unit, words });
    const { direction, temperature, footer } = scene;

    const directionChildren: ElementChild[] =
      direction.content.kind === "text"
        ? [direction.content.text]
        : [
            h("span", { class: direction.content.labelClassName }, direction.content.label),
            " ",
            windArrowSvg(direction.content.deg),
            " ",
            h("strong", null, direction.content.compass),
            direction.content.tail,
          ];

    this.replaceChildren(
      h(
        "div",
        {
          "aria-label": scene.root.ariaLabel,
          class: scene.root.className,
          "data-status": scene.root.status,
          role: "group",
        },
        h(
          "div",
          { class: scene.instrumentClassName },
          scene.flanks != null &&
            h(
              "div",
              { class: scene.flanks.lull.className },
              h("small", { class: scene.flanks.lull.labelClassName }, scene.flanks.lull.label),
              h("strong", null, scene.flanks.lull.value),
            ),
          dialSvg({ station, thresholds, unit, words, calmWord: false }),
          scene.flanks != null &&
            h(
              "div",
              { class: scene.flanks.gust.className },
              h("small", { class: scene.flanks.gust.labelClassName }, scene.flanks.gust.label),
              h("strong", null, scene.flanks.gust.value),
            ),
        ),
        h("p", { class: direction.className }, ...directionChildren),
        temperature != null &&
          h(
            "p",
            { class: temperature.className },
            temperature.text,
            temperature.chill != null &&
              h("span", { class: temperature.chill.className }, temperature.chill.text),
          ),
        h(
          "p",
          { class: footer.className },
          status != null && freshnessBadgeSpan(status, words),
          h("span", { class: footer.observed.className }, footer.observed.text),
        ),
      ),
    );
  }
}
