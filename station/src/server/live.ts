import type { StationLiveFrame } from "../contract.js";

/* Response headers for a live frame stream. A live body is never cacheable
 * and must not sit in a proxy buffer waiting for more bytes. */
export const STATION_LIVE_SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-store",
  "X-Accel-Buffering": "no",
} as const;

/**
 * Encodes live frames as SSE bytes, one data event per frame. This plus a
 * vendor open call (openWindnerdLive) is the seam a host uses to serve live
 * data through its own route or fan-out infrastructure.
 */
export function encodeStationLiveSse(
  frames: ReadableStream<StationLiveFrame>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return frames.pipeThrough(
    new TransformStream<StationLiveFrame, Uint8Array>({
      transform(frame, controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      },
    }),
  );
}
