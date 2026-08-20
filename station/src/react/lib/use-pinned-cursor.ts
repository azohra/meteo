"use client";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useState,
} from "react";
import { activeChartIndex, chartIndexAtClient, togglePinnedAt } from "../../scene/index.js";
import type { ChartFrame, ChartScales } from "../../geometry.js";

/* The pin/preview cursor shell every inspectable chart shares: hover
 * previews (touch never does — a tap pins), click toggles the pin, and
 * leaving clears the preview. Internal — the element bindings carry the
 * same shell in elements/lib/pinned-cursor.ts. */
export function usePinnedCursor(scene: {
  points: ReadonlyArray<{ observedAt: string }>;
  frame: ChartFrame;
  scales: ChartScales;
}): {
  activeIndex: number | null;
  previewIndex: number | null;
  handleClick: (event: ReactMouseEvent<SVGRectElement>) => void;
  handlePointerLeave: () => void;
  handlePointerMove: (event: ReactPointerEvent<SVGRectElement>) => void;
} {
  const [pinnedAt, setPinnedAt] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const indexAtPoint = (clientX: number, hit: SVGRectElement): number | null => {
    const svg = hit.ownerSVGElement;
    if (!svg) return null;
    return chartIndexAtClient(
      scene.points,
      scene.frame,
      scene.scales,
      clientX,
      svg.getBoundingClientRect(),
    );
  };

  return {
    activeIndex: activeChartIndex(scene.points, pinnedAt, previewIndex),
    previewIndex,
    handleClick: (event) => {
      const index = indexAtPoint(event.clientX, event.currentTarget);
      if (index == null) return;
      const observedAt = scene.points[index]?.observedAt;
      if (observedAt == null) return;
      setPinnedAt((current) => togglePinnedAt(current, observedAt));
      setPreviewIndex(null);
    },
    handlePointerLeave: () => setPreviewIndex(null),
    handlePointerMove: (event) => {
      if (event.pointerType === "touch") return;
      setPreviewIndex(indexAtPoint(event.clientX, event.currentTarget));
    },
  };
}
