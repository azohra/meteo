"use client";
import { resolveDisplay } from "../../index.js";
import { freshnessBadgeSpec } from "../../scene/index.js";
import type { FreshnessStatus } from "../../index.js";
import type { StationStringOverrides } from "../../index.js";
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
  const spec = freshnessBadgeSpec(status, words);
  return (
    <span className={spec.className} data-freshness={spec.status}>
      <span aria-hidden="true" className={spec.dot.className} />
      {spec.text}
    </span>
  );
}
