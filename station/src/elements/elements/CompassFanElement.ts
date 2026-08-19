import { resolveStation } from "../../index.js";
import { compassFanGate, compassFanScene, compassFanSource } from "../../scene/index.js";
import type { LiveSamples } from "../../index.js";
import { MeteoStationElement } from "../lib/base.js";
import { h, hs } from "../lib/h.js";

export class CompassFanElement extends MeteoStationElement {
  static readonly observedAttributes = ["favorable-directions", "station-id"];

  #samples: LiveSamples | null | undefined;

  constructor() {
    super();
    for (const name of ["samples"]) this.upgradeProperty(name);
  }

  get samples(): LiveSamples | null | undefined {
    return this.#samples;
  }
  set samples(value: LiveSamples | null | undefined) {
    this.#samples = value;
    this.requestRender();
  }

  protected override render(): void {
    const station =
      this.station ??
      (this.#samples == null
        ? (resolveStation(
            this.ambient()?.feed ?? null,
            this.getAttribute("station-id") ?? undefined,
          ) ?? undefined)
        : undefined);
    const { favorableDirections, words } = this.display();
    const source = compassFanSource(this.#samples, station);
    const gate = compassFanGate(source, station, words);
    if (gate.kind === "hidden") {
      this.replaceChildren();
      return;
    }
    if (gate.kind === "note") {
      this.replaceChildren(h("div", { class: gate.className, role: "note" }, gate.text));
      return;
    }

    const scene = compassFanScene({
      favorableDirections,
      samples: gate.samples,
      stationName: station?.name,
      words,
    });
    this.replaceChildren(
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
        hs("circle", {
          class: scene.ring.className,
          cx: scene.ring.cx,
          cy: scene.ring.cy,
          r: scene.ring.r,
        }),
        scene.verdictRing != null
          ? [
              hs("circle", {
                class: scene.verdictRing.unfavorable.className,
                cx: scene.verdictRing.unfavorable.cx,
                cy: scene.verdictRing.unfavorable.cy,
                r: scene.verdictRing.unfavorable.r,
              }),
              scene.verdictRing.favorable.map((arc) =>
                hs("path", { class: arc.className, d: arc.d }),
              ),
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
        scene.ghosts.map((ghost) => hs("path", { class: ghost.className, d: ghost.d })),
        scene.needle != null &&
          hs(
            "g",
            { class: scene.needle.className },
            hs("polygon", {
              class: scene.needle.blade.className,
              points: scene.needle.blade.points,
            }),
            hs("circle", {
              class: scene.needle.counterweight.className,
              cx: scene.needle.counterweight.cx,
              cy: scene.needle.counterweight.cy,
              r: scene.needle.counterweight.r,
            }),
          ),
        hs("circle", {
          class: scene.hub.className,
          cx: scene.hub.cx,
          cy: scene.hub.cy,
          r: scene.hub.r,
        }),
      ),
    );
  }
}
