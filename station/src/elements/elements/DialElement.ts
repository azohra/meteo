import { DIAL_SIZE } from "../../index.js";
import { dialScene } from "../../scene/index.js";
import type {
  FavorableDirection,
  SpeedThresholds,
  SpeedUnit,
  Station,
  StationStrings,
} from "../../index.js";
import { numberAttribute } from "../lib/attributes.js";
import { MeteoStationElement } from "../lib/base.js";
import { hs } from "../lib/h.js";

let bezelCounter = 0;

export function dialSvg(options: {
  station: Station;
  thresholds: SpeedThresholds | undefined;
  favorableDirections?: FavorableDirection[] | undefined;
  unit: SpeedUnit;
  words: StationStrings;
  size?: number;
  calmWord?: boolean;
}): SVGElement {
  const {
    station,
    thresholds,
    favorableDirections,
    unit,
    words,
    size = DIAL_SIZE,
    calmWord = true,
  } = options;
  const scene = dialScene({
    bezelId: `meteo-bezel-e${++bezelCounter}`,
    calmWord,
    favorableDirections,
    size,
    station,
    thresholds,
    unit,
    words,
  });
  const { gradient, centre } = scene;

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
    hs(
      "defs",
      null,
      hs(
        "radialGradient",
        { cx: gradient.cx, cy: gradient.cy, id: gradient.id, r: gradient.r },
        gradient.stops.map((stop) => hs("stop", { class: stop.className, offset: stop.offset })),
      ),
    ),
    hs("circle", {
      class: scene.face.className,
      cx: scene.face.cx,
      cy: scene.face.cy,
      r: scene.face.r,
    }),
    hs("circle", {
      class: scene.bezel.className,
      cx: scene.bezel.cx,
      cy: scene.bezel.cy,
      fill: scene.bezel.fill,
      r: scene.bezel.r,
    }),
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
          scene.verdictRing.favorable.map((arc) => hs("path", { class: arc.className, d: arc.d })),
        ]
      : null,
    scene.arc != null && hs("path", { class: scene.arc.className, d: scene.arc.d }),
    scene.ticks.map((tick) =>
      hs("line", { class: tick.className, x1: tick.x1, x2: tick.x2, y1: tick.y1, y2: tick.y2 }),
    ),
    scene.letters.map((letter) =>
      hs(
        "text",
        { class: letter.className, "text-anchor": letter.anchor, x: letter.x, y: letter.y },
        letter.text,
      ),
    ),
    scene.needle != null &&
      hs(
        "g",
        { class: scene.needle.className },
        hs("polygon", { class: scene.needle.blade.className, points: scene.needle.blade.points }),
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
    centre.kind === "reason"
      ? hs(
          "text",
          {
            class: centre.text.className,
            "text-anchor": centre.text.anchor,
            x: centre.text.x,
            y: centre.text.y,
          },
          centre.text.text,
        )
      : [
          centre.calmWord != null
            ? hs(
                "text",
                {
                  class: centre.calmWord.className,
                  "text-anchor": centre.calmWord.anchor,
                  x: centre.calmWord.x,
                  y: centre.calmWord.y,
                },
                centre.calmWord.text,
              )
            : null,
          hs(
            "text",
            {
              class: centre.speed.className,
              "text-anchor": centre.speed.anchor,
              x: centre.speed.x,
              y: centre.speed.y,
            },
            centre.speed.text,
          ),
          hs(
            "text",
            {
              class: centre.unit.className,
              "text-anchor": centre.unit.anchor,
              x: centre.unit.x,
              y: centre.unit.y,
            },
            centre.unit.text,
          ),
        ],
  );
}

export class DialElement extends MeteoStationElement {
  static readonly observedAttributes = [
    "favorable-directions",
    "no-calm-word",
    "received-at-ms",
    "served-at",
    "size",
    "station-id",
    "thresholds",
    "unit",
  ];

  protected override render(): void {
    const station = this.requiredStation("meteo-dial");
    const { favorableDirections, thresholds, unit, words } = this.display();
    this.replaceChildren(
      dialSvg({
        station,
        thresholds,
        favorableDirections,
        unit,
        words,
        size: numberAttribute(this.getAttribute("size")) ?? DIAL_SIZE,
        calmWord: !this.hasAttribute("no-calm-word"),
      }),
    );
  }
}
