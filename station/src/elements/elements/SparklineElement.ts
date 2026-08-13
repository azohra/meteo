import { sparklineScene } from "../../scene/index.js";
import type { SpeedThresholds, Station, StationStrings } from "../../index.js";
import { numberAttribute } from "../lib/attributes.js";
import { MeteoStationElement } from "../lib/base.js";
import { h, hs } from "../lib/h.js";

export function sparklineNode(options: {
  station: Station;
  thresholds: SpeedThresholds | undefined;
  words: StationStrings;
  width?: number;
  height?: number;
  showBand?: boolean;
}): Element {
  const { station, thresholds, words, width = 120, height = 32, showBand = true } = options;
  const scene = sparklineScene({ height, showBand, station, thresholds, width, words });

  if (scene.kind === "placeholder") {
    const placeholder = h(
      "span",
      { "aria-label": scene.ariaLabel, class: scene.className, role: "img" },
      scene.text,
    );
    placeholder.style.height = `${scene.height}px`;
    placeholder.style.width = `${scene.width}px`;
    return placeholder;
  }

  return hs(
    "svg",
    {
      "aria-label": scene.svg.ariaLabel,
      class: scene.svg.className,
      height: scene.svg.height,
      role: "img",
      viewBox: scene.svg.viewBox,
      width: scene.svg.width,
    },
    scene.bands.map((band) => hs("polygon", { class: band.className, points: band.points })),
    scene.trace.map((part) =>
      part.kind === "dot"
        ? hs("circle", { class: part.className, cx: part.cx, cy: part.cy, r: part.r })
        : part.kind === "polyline"
          ? hs("polyline", { class: part.className, points: part.points })
          : hs("line", {
              class: part.className,
              x1: part.x1,
              x2: part.x2,
              y1: part.y1,
              y2: part.y2,
            }),
    ),
  );
}

export class SparklineElement extends MeteoStationElement {
  static readonly observedAttributes = ["height", "no-band", "station-id", "thresholds", "width"];

  protected override render(): void {
    const station = this.requiredStation("meteo-sparkline");
    const { thresholds, words } = this.display();
    this.replaceChildren(
      sparklineNode({
        station,
        thresholds,
        words,
        width: numberAttribute(this.getAttribute("width")) ?? 120,
        height: numberAttribute(this.getAttribute("height")) ?? 32,
        showBand: !this.hasAttribute("no-band"),
      }),
    );
  }
}
