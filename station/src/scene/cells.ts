import { directionCell } from "../format.js";
import type { Station } from "../contract.js";
import { EM_DASH } from "../strings.js";
import type { StationStrings } from "../strings.js";
import { windArrowNode } from "./glyphs.js";
import { el, type SceneChild, type SceneNode } from "./node.js";
import { bandChipScene, directionAtomScene, updatedAtScene, type ValueAtomScene } from "./atoms.js";
import type { FavorableDirection } from "../instruments.js";

/** The direction reading: an arrow plus its compass point, or the word for
 * calm, or a dash — one spelling for both display bindings. */
export function directionCellNodes(
  windAvgMps: number,
  windDirectionDeg: number | null,
  words: StationStrings,
): SceneChild[] {
  const cell = directionCell(windAvgMps, windDirectionDeg);
  if (cell.kind === "calm") return [words.calm];
  if (cell.kind === "dash") return [EM_DASH];
  return [windArrowNode(cell.deg), ` ${cell.compass} ${cell.rounded}°`];
}

export function stationNameNode(station: Station): SceneChild {
  if (station.pageUrl == null) return station.name;
  return el("a", { href: station.pageUrl, rel: "noreferrer", target: "_blank" }, station.name);
}

export function valueAtomNode(scene: ValueAtomScene) {
  return el(
    "data",
    { class: scene.className, value: scene.value },
    scene.content.kind === "dash"
      ? scene.content.text
      : [
          scene.content.text,
          el("span", { class: scene.content.unit.className }, scene.content.unit.text),
        ],
  );
}

export function directionAtomNode(
  station: Station,
  words: StationStrings,
  favorableDirections?: ReadonlyArray<FavorableDirection>,
): SceneNode {
  const scene = directionAtomScene(station, words, favorableDirections);
  if (scene.cell == null) return el("span", { class: scene.className }, scene.dashText);
  return el(
    "span",
    { "aria-label": scene.ariaLabel, class: scene.className },
    directionCellNodes(scene.cell.windAvgMps, scene.cell.windDirectionDeg, words),
  );
}

export function updatedAtNode(input: Parameters<typeof updatedAtScene>[0]): SceneNode {
  const scene = updatedAtScene(input);
  return scene.kind === "dash"
    ? el("span", { class: scene.className }, scene.text)
    : el("time", { class: scene.className, datetime: scene.dateTime }, scene.text);
}

export function bandChipNode(input: Parameters<typeof bandChipScene>[0]): SceneNode {
  const scene = bandChipScene(input);
  return el("span", { class: scene.className, "data-band": scene.band }, scene.text);
}
