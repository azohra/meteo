import { nearestIndex } from "../geometry.js";
import type { ChartFrame, ChartScales } from "../geometry.js";

export { measuredChartWidth, tickAnchor } from "../geometry.js";
export type { TickAnchor } from "../geometry.js";

export type ReadoutPart = { kind: "text"; text: string } | { kind: "arrow"; deg: number };

/* Typed on the instant alone, like nearestIndex: history points and live
 * samples pin, preview, and inspect through the same cursor math. */
export function pinnedIndexOf(
  points: ReadonlyArray<{ observedAt: string }>,
  pinnedAt: string | null,
): number | null {
  if (pinnedAt == null) return null;
  const found = points.findIndex((point) => point.observedAt === pinnedAt);
  return found === -1 ? null : found;
}

export function activeChartIndex(
  points: ReadonlyArray<{ observedAt: string }>,
  pinnedAt: string | null,
  previewIndex: number | null,
): number | null {
  return previewIndex ?? pinnedIndexOf(points, pinnedAt);
}

export function chartIndexAtClient(
  points: ReadonlyArray<{ observedAt: string }>,
  frame: ChartFrame,
  scales: ChartScales,
  clientX: number,
  bounds: { left: number; width: number },
): number | null {
  if (bounds.width === 0) return null;
  const chartX = ((clientX - bounds.left) / bounds.width) * frame.width;
  return nearestIndex(points, chartX, frame, scales);
}

export function togglePinnedAt(current: string | null, observedAt: string): string | null {
  return current === observedAt ? null : observedAt;
}

export function readoutAriaLive(previewIndex: number | null): "off" | "polite" {
  return previewIndex == null ? "polite" : "off";
}
