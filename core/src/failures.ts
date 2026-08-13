export const UPSTREAM_FAILURE_REASONS = [
  "upstream_error",
  "timeout",
  "rate_limited",
  "contract_break",
] as const;
export type UpstreamFailureReason = (typeof UPSTREAM_FAILURE_REASONS)[number];

/* The reasons an UpstreamError may be thrown with; contract_break is only ever the mapper's verdict, never thrown. */
export type UpstreamErrorReason = Exclude<UpstreamFailureReason, "contract_break">;

export class UpstreamError extends Error {
  readonly reason: UpstreamErrorReason;

  constructor(message: string, reason: UpstreamErrorReason = "upstream_error") {
    super(message);
    this.name = "UpstreamError";
    this.reason = reason;
  }
}

/* Maps any thrown value onto the wire's failure reason codes. */
export function unavailableReasonForError(error: unknown): UpstreamFailureReason {
  if (error instanceof UpstreamError) return error.reason;
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "timeout";
  }
  /* fetch rejects network refusals as TypeError. */
  if (error instanceof TypeError) return "upstream_error";
  return "contract_break";
}
