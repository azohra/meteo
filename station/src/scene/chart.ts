import type { HistoryPoint } from "../contract.js";
import { CHART_FALLBACK_WIDTH, nearestIndex } from "../geometry.js";
import type { ChartFrame, ChartScales } from "../geometry.js";

export type TickAnchor = "end" | "middle" | "start";

export type ReadoutPart = { kind: "text"; text: string } | { kind: "arrow"; deg: number };

export function tickAnchor(index: number, lastIndex: number): TickAnchor {
  return index === 0 ? "start" : index === lastIndex ? "end" : "middle";
}

export function measuredChartWidth(measured: number): number {
  return measured > 0 ? Math.round(measured) : CHART_FALLBACK_WIDTH;
}

export function pinnedIndexOf(
  points: ReadonlyArray<HistoryPoint>,
  pinnedAt: string | null,
): number | null {
  if (pinnedAt == null) return null;
  const found = points.findIndex((point) => point.observedAt === pinnedAt);
  return found === -1 ? null : found;
}

export function activeChartIndex(
  points: ReadonlyArray<HistoryPoint>,
  pinnedAt: string | null,
  previewIndex: number | null,
): number | null {
  return previewIndex ?? pinnedIndexOf(points, pinnedAt);
}

export function chartIndexAtClient(
  points: ReadonlyArray<HistoryPoint>,
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
