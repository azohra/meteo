import {
  DIAL_CARDINALS,
  DIAL_CARDINAL_TICK_INNER,
  DIAL_CENTRE,
  DIAL_COUNTERWEIGHT_RADIUS,
  DIAL_COUNTERWEIGHT_REACH,
  DIAL_HUB_RADIUS,
  DIAL_LETTER_RADIUS,
  DIAL_RING_RADIUS,
  DIAL_TICK_INNER,
  dialNeedlePoints,
  dialPolar,
  dialRingArcPath,
} from "../instruments.js";
import type { FavorableDirection } from "../instruments.js";
import { el, keyed, type SceneChild, type SceneNode } from "./node.js";

/* The dial face's furniture, drawn identically by the wind dial and the
   compass fan: one home so the two instruments cannot drift apart. */

export function dialRing(): SceneNode {
  return el("circle", {
    class: "meteo-wind-dial-ring",
    cx: DIAL_CENTRE,
    cy: DIAL_CENTRE,
    r: DIAL_RING_RADIUS,
  });
}

export function dialVerdictRing(arcs: FavorableDirection[] | undefined): SceneChild[] {
  if (arcs == null || arcs.length === 0) return [];
  return [
    el("circle", {
      class: "meteo-wind-dial-ring-unfavorable",
      cx: DIAL_CENTRE,
      cy: DIAL_CENTRE,
      r: DIAL_RING_RADIUS,
    }),
    ...arcs.map((sector) =>
      keyed(`${sector.fromDeg}-${sector.toDeg}`, "path", {
        class: "meteo-wind-dial-ring-favorable",
        d: dialRingArcPath(sector),
      }),
    ),
  ];
}

export function dialTicks(): SceneChild[] {
  return Array.from({ length: 16 }, (_, index) => {
    const bearing = index * 22.5;
    const cardinal = index % 4 === 0;
    const [x1, y1] = dialPolar(bearing, DIAL_RING_RADIUS);
    const [x2, y2] = dialPolar(bearing, cardinal ? DIAL_CARDINAL_TICK_INNER : DIAL_TICK_INNER);
    return keyed(String(bearing), "line", {
      class: cardinal
        ? "meteo-wind-dial-tick meteo-wind-dial-tick-cardinal"
        : "meteo-wind-dial-tick",
      x1,
      x2,
      y1,
      y2,
    });
  });
}

export function dialLetters(): SceneChild[] {
  return DIAL_CARDINALS.map(({ bearing, letter }) => {
    const [x, y] = dialPolar(bearing, DIAL_LETTER_RADIUS);
    return keyed(
      letter,
      "text",
      { class: "meteo-wind-dial-letter", "text-anchor": "middle", x, y: y + 3.5 },
      letter,
    );
  });
}

export function dialNeedle(directionDeg: number): SceneNode {
  return el(
    "g",
    { class: "meteo-wind-needle" },
    el("polygon", {
      class: "meteo-wind-needle-blade",
      points: dialNeedlePoints(directionDeg),
    }),
    el("circle", {
      class: "meteo-wind-needle-counterweight",
      cx: dialPolar(directionDeg, DIAL_COUNTERWEIGHT_REACH)[0],
      cy: dialPolar(directionDeg, DIAL_COUNTERWEIGHT_REACH)[1],
      r: DIAL_COUNTERWEIGHT_RADIUS,
    }),
  );
}

export function dialHub(): SceneNode {
  return el("circle", {
    class: "meteo-wind-dial-hub",
    cx: DIAL_CENTRE,
    cy: DIAL_CENTRE,
    r: DIAL_HUB_RADIUS,
  });
}
