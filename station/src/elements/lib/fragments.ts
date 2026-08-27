import {
  directionCellNodes as directionCellSceneNodes,
  freshnessBadgeNode,
  stationNameNode as stationNameSceneNode,
  windArrowNode,
} from "../../scene/index.js";
import type { FreshnessStatus, Station, StationStrings } from "../../index.js";
import type { ElementChild } from "./h.js";
import { renderScene } from "./render.js";

export function windArrowSvg(deg: number, size = 12): Element {
  return renderScene(windArrowNode(deg, size));
}

export function directionCellNodes(
  windAvgMps: number,
  windDirectionDeg: number | null,
  words: StationStrings,
): ElementChild[] {
  return directionCellSceneNodes(windAvgMps, windDirectionDeg, words).map((child) =>
    typeof child === "object" && child !== null ? renderScene(child) : (child as ElementChild),
  );
}

export function stationNameNode(station: Station): ElementChild {
  const node = stationNameSceneNode(station);
  return typeof node === "object" && node !== null ? renderScene(node) : (node as ElementChild);
}

export function freshnessBadgeSpan(status: FreshnessStatus, words: StationStrings): Element {
  return renderScene(freshnessBadgeNode(status, words));
}
