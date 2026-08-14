import { describe, expect, it } from "vitest";
import { sseEvents, type SseEvent } from "../src/sse.js";

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(
  body: ReadableStream<Uint8Array>,
  options?: { maxEventBytes?: number },
): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const event of sseEvents(body, options)) events.push(event);
  return events;
}

describe("sseEvents", () => {
  it("dispatches data events on blank lines", async () => {
    const events = await collect(streamOf('data: {"a":1}\n\ndata: {"b":2}\n\n'));
    expect(events).toEqual([
      { event: "message", data: '{"a":1}' },
      { event: "message", data: '{"b":2}' },
    ]);
  });

  it("reassembles events split across chunk boundaries", async () => {
    const events = await collect(streamOf('data: {"spl', 'it":tr', "ue}\n", "\n"));
    expect(events).toEqual([{ event: "message", data: '{"split":true}' }]);
  });

  it("handles CRLF line endings", async () => {
    const events = await collect(streamOf("event: ping\r\ndata: {}\r\n\r\n"));
    expect(events).toEqual([{ event: "ping", data: "{}" }]);
  });

  it("carries the event field and resets it after dispatch", async () => {
    const events = await collect(streamOf("event: ping\ndata: {}\n\ndata: plain\n\n"));
    expect(events).toEqual([
      { event: "ping", data: "{}" },
      { event: "message", data: "plain" },
    ]);
  });

  it("joins multiple data lines with newlines", async () => {
    const events = await collect(streamOf("data: first\ndata: second\n\n"));
    expect(events).toEqual([{ event: "message", data: "first\nsecond" }]);
  });

  it("ignores comments, id, and retry lines", async () => {
    const events = await collect(streamOf(": keepalive\nid: 7\nretry: 500\ndata: x\n\n"));
    expect(events).toEqual([{ event: "message", data: "x" }]);
  });

  it("treats a lone data field without a colon as empty", async () => {
    const events = await collect(streamOf("data\n\n"));
    expect(events).toEqual([{ event: "message", data: "" }]);
  });

  it("does not strip more than one leading space from a value", async () => {
    const events = await collect(streamOf("data:  padded\n\n"));
    expect(events).toEqual([{ event: "message", data: " padded" }]);
  });

  it("drops an un-dispatched trailing event at end of stream", async () => {
    const events = await collect(streamOf("data: complete\n\ndata: dangling\n"));
    expect(events).toEqual([{ event: "message", data: "complete" }]);
  });

  it("skips blank-line dispatch when no data accumulated", async () => {
    const events = await collect(streamOf("\n\nevent: ping\n\ndata: real\n\n"));
    expect(events).toEqual([{ event: "message", data: "real" }]);
  });

  it("throws when one event exceeds maxEventBytes", async () => {
    const body = streamOf(`data: ${"x".repeat(64)}\n\n`);
    await expect(collect(body, { maxEventBytes: 32 })).rejects.toThrow(
      "SSE event exceeded 32 bytes",
    );
  });

  it("throws when an unterminated line exceeds maxEventBytes", async () => {
    const body = streamOf("x".repeat(64));
    await expect(collect(body, { maxEventBytes: 32 })).rejects.toThrow(
      "SSE event exceeded 32 bytes",
    );
  });

  it("tears down a hung read when the signal aborts, even on an unwired body", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      /* Never produces — stands in for a quiet upstream whose body ignores
       * the fetch signal. */
      start: () => {},
      cancel() {
        cancelled = true;
      },
    });
    const controller = new AbortController();
    const events: SseEvent[] = [];
    const pending = (async () => {
      for await (const event of sseEvents(body, { signal: controller.signal })) {
        events.push(event);
      }
    })().catch((thrown: unknown) => thrown);
    controller.abort();
    const result = await pending;
    expect(result).toBeInstanceOf(DOMException);
    expect(events).toEqual([]);
    expect(cancelled).toBe(true);
  });

  it("cancels the reader when the consumer stops early", async () => {
    let cancelled = false;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: one\n\ndata: two\n\n"));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const event of sseEvents(body)) {
      expect(event.data).toBe("one");
      break;
    }
    expect(cancelled).toBe(true);
  });
});
