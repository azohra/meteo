"use client";
import { directionCellNodes, stationNameNode } from "../../scene/index.js";
import type { Station, StationStrings } from "../../index.js";
import { renderChildren, renderChild } from "../components/SceneTree.js";

export function DirectionCell({
  windAvgMps,
  windDirectionDeg,
  words,
}: {
  windAvgMps: number;
  windDirectionDeg: number | null;
  words: StationStrings;
}) {
  return renderChildren(directionCellNodes(windAvgMps, windDirectionDeg, words));
}

export function StationNameLink({ station }: { station: Station }) {
  return renderChild(stationNameNode(station), 0);
}
