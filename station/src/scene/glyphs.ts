import type { FreshnessStatus } from "../derive.js";
import type { StationStrings } from "../strings.js";
import { el, type SceneNode } from "./node.js";

export function windArrowNode(deg: number, size = 12): SceneNode {
  return {
    ...el(
      "svg",
      {
        "aria-hidden": "true",
        class: "meteo-wind-arrow",
        height: size,
        viewBox: "0 0 16 16",
        width: size,
      },
      el("path", { d: "M8 1 L13 14 L8 10.6 L3 14 Z", fill: "currentColor" }),
    ),
    style: { transform: `rotate(${deg + 180}deg)` },
  };
}

export function freshnessBadgeNode(status: FreshnessStatus, words: StationStrings): SceneNode {
  return el(
    "span",
    { class: "meteo-freshness", "data-freshness": status },
    el("span", { "aria-hidden": "true", class: "meteo-freshness-dot" }),
    words.freshness[status],
  );
}
