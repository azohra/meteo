"use client";
import { resolveDisplay } from "../../index.js";
import { freshnessBadgeNode } from "../../scene/index.js";
import type { FreshnessStatus } from "../../index.js";
import type { StationStringOverrides } from "../../index.js";
import { renderScene } from "./SceneTree.js";
import { useStationFeedContext } from "./StationFeedProvider.js";

export function FreshnessBadge({
  status,
  strings,
}: {
  status: FreshnessStatus;
  strings?: StationStringOverrides;
}) {
  const context = useStationFeedContext();
  const { words } = resolveDisplay(context, { strings });
  return renderScene(freshnessBadgeNode(status, words));
}
