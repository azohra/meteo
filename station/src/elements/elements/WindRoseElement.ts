import { resolveStation } from "../../index.js";
import { windRoseGate, windRoseScene, windRoseSource } from "../../scene/index.js";
import type { FavorableDirection, HistoryPoint } from "../../index.js";
import { numberAttribute } from "../lib/attributes.js";
import { MeteoStationElement } from "../lib/base.js";
import { h, hs } from "../lib/h.js";

export class WindRoseElement extends MeteoStationElement {
  static readonly observedAttributes = ["sector-count", "station-id", "thresholds"];

  #points: HistoryPoint[] | undefined;
  #favorableDirections: FavorableDirection[] | undefined;

  constructor() {
    super();
    for (const name of ["points", "favorableDirections"]) this.upgradeProperty(name);
  }

  get points(): HistoryPoint[] | undefined {
    return this.#points;
  }
  set points(value: HistoryPoint[] | undefined) {
    this.#points = value;
    this.requestRender();
  }

  get favorableDirections(): FavorableDirection[] | undefined {
    return this.#favorableDirections;
  }
  set favorableDirections(value: FavorableDirection[] | undefined) {
    this.#favorableDirections = value;
    this.requestRender();
  }

  protected override render(): void {
    const station =
      this.station ??
      (this.#points == null
        ? (resolveStation(
            this.ambient()?.feed ?? null,
            this.getAttribute("station-id") ?? undefined,
          ) ?? undefined)
        : undefined);
    const { thresholds, words } = this.display();
    const source = windRoseSource(this.#points, station);
    const gate = windRoseGate(source, words);
    if (gate.kind === "note") {
      this.replaceChildren(h("div", { class: gate.className, role: "note" }, gate.text));
      return;
    }

    const scene = windRoseScene({
      favorableDirections: this.#favorableDirections,
      sectorCount: numberAttribute(this.getAttribute("sector-count")) ?? 16,
      source,
      stationName: station?.name,
      thresholds,
      words,
    });

    this.replaceChildren(
      h(
        "div",
        { class: scene.className },
        hs(
          "svg",
          {
            "aria-label": scene.svg.ariaLabel,
            class: scene.svg.className,
            height: scene.svg.height,
            role: "img",
            viewBox: scene.svg.viewBox,
            width: scene.svg.width,
          },
          scene.gridCircles.map((circle) =>
            hs("circle", { class: circle.className, cx: circle.cx, cy: circle.cy, r: circle.r }),
          ),
          scene.ring != null
            ? [
                hs("circle", {
                  class: scene.ring.unfavorable.className,
                  cx: scene.ring.unfavorable.cx,
                  cy: scene.ring.unfavorable.cy,
                  r: scene.ring.unfavorable.r,
                }),
                scene.ring.favorable.map((arc) => hs("path", { class: arc.className, d: arc.d })),
              ]
            : null,
          scene.ticks.map((tick) =>
            hs("line", {
              class: tick.className,
              x1: tick.x1,
              x2: tick.x2,
              y1: tick.y1,
              y2: tick.y2,
            }),
          ),
          scene.letters.map((letter) =>
            hs(
              "text",
              { class: letter.className, "text-anchor": letter.anchor, x: letter.x, y: letter.y },
              letter.text,
            ),
          ),
          scene.petals.map((petal) => hs("path", { class: petal.className, d: petal.d })),
          scene.ringLabel != null &&
            hs(
              "text",
              {
                class: scene.ringLabel.className,
                "text-anchor": scene.ringLabel.anchor,
                x: scene.ringLabel.x,
                y: scene.ringLabel.y,
              },
              scene.ringLabel.text,
            ),
          hs("circle", {
            class: scene.hub.className,
            cx: scene.hub.cx,
            cy: scene.hub.cy,
            r: scene.hub.r,
          }),
          hs("circle", {
            class: scene.dot.className,
            cx: scene.dot.cx,
            cy: scene.dot.cy,
            r: scene.dot.r,
          }),
        ),
        scene.calmCaption != null
          ? h("p", { class: scene.calmCaption.className }, scene.calmCaption.text)
          : null,
      ),
    );
  }
}
