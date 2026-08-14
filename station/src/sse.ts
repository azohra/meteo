/* Minimal incremental Server-Sent-Events reader, shared by the server's
 * upstream consumers and the client's live store. Framing only — callers
 * interpret data payloads. */

export type SseEvent = {
  /* The event: field, or "message" when the stream never set one. */
  readonly event: string;
  /* All data: lines of the event, joined with newlines. */
  readonly data: string;
};

export type SseEventsOptions = {
  /* Upper bound on one event's accumulated bytes; the generator throws past it. */
  maxEventBytes?: number;
  /* Abort tears down the read mid-await, even when the body stream itself is
   * not wired to the fetch signal. */
  signal?: AbortSignal;
};

export const DEFAULT_MAX_EVENT_BYTES = 262_144;

/* Yields dispatched events from an SSE byte stream. Follows the WHATWG
 * dispatch rules for the fields we consume: data: accumulates, event: names,
 * blank line dispatches; comment, id:, and retry: lines are ignored. A final
 * un-dispatched event at end of stream is dropped, as the spec requires. */
export async function* sseEvents(
  body: ReadableStream<Uint8Array>,
  options: SseEventsOptions = {},
): AsyncGenerator<SseEvent> {
  const maxEventBytes = options.maxEventBytes ?? DEFAULT_MAX_EVENT_BYTES;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let dataLines: string[] = [];
  let eventName = "";
  let eventBytes = 0;

  const abortError = () => new DOMException("SSE read aborted", "AbortError");
  const aborted = options.signal
    ? new Promise<never>((_resolve, reject) => {
        if (options.signal?.aborted) reject(abortError());
        options.signal?.addEventListener("abort", () => reject(abortError()), { once: true });
      })
    : null;
  /* Mark handled so an abort with no read in flight never surfaces as an
   * unhandled rejection. */
  aborted?.catch(() => undefined);

  const fieldValue = (line: string, colon: number): string => {
    const value = line.slice(colon + 1);
    return value.startsWith(" ") ? value.slice(1) : value;
  };

  try {
    while (true) {
      const { done, value } = aborted
        ? await Promise.race([reader.read(), aborted])
        : await reader.read();
      buffered += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      let newline = buffered.indexOf("\n");
      while (newline !== -1) {
        let line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);

        if (line === "") {
          if (dataLines.length > 0) {
            yield { event: eventName === "" ? "message" : eventName, data: dataLines.join("\n") };
          }
          dataLines = [];
          eventName = "";
          eventBytes = 0;
        } else if (!line.startsWith(":")) {
          eventBytes += line.length;
          if (eventBytes > maxEventBytes) {
            throw new Error(`SSE event exceeded ${maxEventBytes} bytes`);
          }
          const colon = line.indexOf(":");
          const field = colon === -1 ? line : line.slice(0, colon);
          if (field === "data") {
            dataLines.push(colon === -1 ? "" : fieldValue(line, colon));
          } else if (field === "event") {
            eventName = colon === -1 ? "" : fieldValue(line, colon);
          }
          /* id: and retry: are ignored — upstream sends neither, and the
           * reconnect story is a fresh init frame, never a resume. */
        }
        newline = buffered.indexOf("\n");
      }
      if (buffered.length > maxEventBytes) {
        throw new Error(`SSE event exceeded ${maxEventBytes} bytes`);
      }
      if (done) return;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
