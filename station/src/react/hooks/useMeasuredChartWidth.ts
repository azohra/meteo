"use client";
import { useEffect, useLayoutEffect, useState } from "react";
import { CHART_FALLBACK_WIDTH, measuredChartWidth } from "../../geometry.js";

/* Before paint: a width read in useEffect lands a frame late and the chart
 * visibly rescales; on the server there is no layout to read, so it degrades
 * to useEffect (React warns on useLayoutEffect during server rendering). */
const useMeasureEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/* The measure-before-framing discipline as a hook: read the container's
 * width before first paint, keep it fresh on resize, and hold rendering
 * (null) until a width exists. Zero-width measurements are ignored — a
 * container hidden at measure time (an inactive tab) reports zero, and the
 * hook stays held until it becomes visible and reports a real width.
 * Without a ResizeObserver (old runtimes) the fallback width applies
 * immediately. `enabled: false` skips observing entirely — for callers
 * whose container only exists in some states. */
export function useMeasuredChartWidth(
  ref: { readonly current: Element | null },
  { enabled = true }: { enabled?: boolean } = {},
): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useMeasureEffect(() => {
    const element = ref.current;
    if (!enabled || element == null) return;
    if (typeof ResizeObserver === "undefined") {
      setWidth(CHART_FALLBACK_WIDTH);
      return;
    }
    /* The synchronous read is the one React flushes before paint; the
     * observer's initial delivery lands a task later, and from then on it
     * owns resizes. */
    if (element.clientWidth > 0) setWidth(measuredChartWidth(element.clientWidth));
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0;
      if (measured > 0) setWidth(measuredChartWidth(measured));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, enabled]);
  return width;
}
