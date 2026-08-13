import { FRESHNESS_REEVALUATE_MS } from "./poll.js";

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

export function subscribeTicker(listener: () => void): () => void {
  listeners.add(listener);
  timer ??= setInterval(() => {
    for (const entry of [...listeners]) entry();
  }, FRESHNESS_REEVALUATE_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer != null) {
      clearInterval(timer);
      timer = null;
    }
  };
}
