import { describe, expect, it } from "vitest";
import { UpstreamError, unavailableReasonForError } from "../src/failures.js";

describe("UpstreamError", () => {
  it("defaults to upstream_error and carries a given reason", () => {
    const plain = new UpstreamError("bucket said no");
    expect(plain.name).toBe("UpstreamError");
    expect(plain.reason).toBe("upstream_error");
    expect(new UpstreamError("too slow", "timeout").reason).toBe("timeout");
  });
});

describe("unavailableReasonForError", () => {
  it("passes an UpstreamError's own reason through", () => {
    expect(unavailableReasonForError(new UpstreamError("throttled", "rate_limited"))).toBe(
      "rate_limited",
    );
  });

  it("maps abort and timeout names onto timeout", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    const timeout = new Error("deadline");
    timeout.name = "TimeoutError";
    expect(unavailableReasonForError(abort)).toBe("timeout");
    expect(unavailableReasonForError(timeout)).toBe("timeout");
  });

  it("maps fetch's network TypeError onto upstream_error", () => {
    expect(unavailableReasonForError(new TypeError("fetch failed"))).toBe("upstream_error");
  });

  it("calls everything else a contract break — thrown Errors and bare values alike", () => {
    expect(unavailableReasonForError(new Error("unexpected shape"))).toBe("contract_break");
    expect(unavailableReasonForError("a string, thrown")).toBe("contract_break");
  });
});
