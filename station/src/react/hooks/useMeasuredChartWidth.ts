"use client";
import { useEffect, useState } from "react";
import { CHART_FALLBACK_WIDTH, measuredChartWidth } from "../../geometry.js";

/* The measure-before-framing discipline as a hook: observe the container,
 * frame at its measured pixel width, and hold rendering (null) until a
 * width exists. Without a ResizeObserver (SSR, old runtimes) the fallback
 * width applies immediately. `enabled: false` skips observing entirely —
 * for callers whose container only exists in some states. */
export function useMeasuredChartWidth(
  ref: { readonly current: Element | null },
  { enabled = true }: { enabled?: boolean } = {},
): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!enabled || element == null) return;
    if (typeof ResizeObserver === "undefined") {
      setWidth(CHART_FALLBACK_WIDTH);
      return;
    }
    const observer = new ResizeObserver((entries) => {
      setWidth(measuredChartWidth(entries[0]?.contentRect.width ?? 0));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, enabled]);
  return width;
}
